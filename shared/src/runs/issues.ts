import type { Client } from "node-appwrite";
import type { DraftCheckpointPayload, Run } from "./types";
import { RunRepositoryError } from "./types";
import { getRun, listRuns, loadPhaseCheckpoint } from "./repository";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

/** Distinguishes issue-reader load failures for page UI mapping. */
export type IssueLoadErrorCode = "not_found" | "not_eligible" | "checkpoint_missing" | "appwrite";

export class IssueLoadError extends Error {
  readonly code: IssueLoadErrorCode;

  constructor(code: IssueLoadErrorCode, message: string) {
    super(message);
    this.name = "IssueLoadError";
    this.code = code;
  }
}

/**
 * A run is an eligible Issue when it is completed and has a non-empty draft
 * checkpoint id (same rule as {@link listIssues}).
 */
export function isEligibleIssue(run: Run): boolean {
  return run.status === "completed" && run.checkpointDraftId.trim() !== "";
}

function mapRepositoryError(err: unknown): never {
  if (err instanceof IssueLoadError) throw err;
  if (err instanceof RunRepositoryError) {
    if (err.code === "not_found" || err.code === "checkpoint_missing" || err.code === "appwrite") {
      throw new IssueLoadError(err.code, err.message);
    }
  }
  throw new IssueLoadError("appwrite", "Something went wrong loading this issue");
}

/**
 * Load an eligible issue's draft markdown: getRun → eligibility → draft checkpoint.
 * Does not download when the run is missing or not eligible.
 */
export async function loadIssueDraft(
  client: Client,
  runId: string,
): Promise<{ run: Run; markdown: string }> {
  let run: Run;
  try {
    run = await getRun(client, runId);
  } catch (err) {
    mapRepositoryError(err);
  }

  if (!isEligibleIssue(run)) {
    throw new IssueLoadError("not_eligible", "Run is not an eligible issue");
  }

  let payload: DraftCheckpointPayload;
  try {
    payload = (await loadPhaseCheckpoint(client, runId, "draft")) as DraftCheckpointPayload;
  } catch (err) {
    mapRepositoryError(err);
  }

  return { run, markdown: payload.markdown };
}

/**
 * Lists completed runs that have a draft checkpoint (eligible Issues).
 * Does not download draft Storage files.
 */
export async function listIssues(
  client: Client,
  opts?: {
    newsletterId?: string;
    limit?: number; // default 100
  },
): Promise<Run[]> {
  const runs = await listRuns(client, {
    status: "completed",
    newsletterId: opts?.newsletterId,
    limit: opts?.limit ?? 100,
  });

  const eligible = runs.filter(isEligibleIssue);

  eligible.sort((a, b) => {
    const aKey = a.endedAt ?? a.startedAt;
    const bKey = b.endedAt ?? b.startedAt;
    const byDate = bKey.localeCompare(aKey);
    if (byDate !== 0) return byDate;
    return b.$id.localeCompare(a.$id);
  });

  return eligible;
}

/**
 * Fallback display title when a draft has no explicit title:
 * `{newsletterName} — {short locale date}`.
 */
export function formatIssueFallbackTitle(newsletterName: string, dateIso: string): string {
  const datePortion = new Date(dateIso).toLocaleDateString(undefined, { dateStyle: "short" });
  return `${newsletterName} — ${datePortion}`;
}

const ATX_HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const SETEXT_UNDERLINE_RE = /^(?:=+|-+)[ \t]*$/;
const FENCE_LINE_RE = /^(```+|~~~+)(.*)$/;

function cleanInlineHeadingText(raw: string): string {
  let s = raw;
  // 1. Links: [label](url) → label
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 2. Bold/italic markers (pairs, then leftover wrappers)
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/__(.+?)__/g, "$1");
  s = s.replace(/\*(.+?)\*/g, "$1");
  s = s.replace(/_(.+?)_/g, "$1");
  s = s.replace(/^[*_]+|[*_]+$/g, "");
  // 3. Inline code: `code` → code
  s = s.replace(/`([^`]+)`/g, "$1");
  // 4. Trim; collapse internal whitespace
  s = s.trim().replace(/[ \t\f\v]+/g, " ");
  return s;
}

function isEmptyOrPunctuationOnly(text: string): boolean {
  if (text.length === 0) return true;
  return !/[\p{L}\p{N}]/u.test(text);
}

function finalizeHeadingText(raw: string): string | null {
  const cleaned = cleanInlineHeadingText(raw);
  if (isEmptyOrPunctuationOnly(cleaned)) return null;
  return cleaned;
}

/**
 * First markdown heading in `markdown` (ATX preferred, then setext), or null.
 * Line-oriented scanner — skips fenced code; no markdown-parser dependency.
 */
export function extractFirstMarkdownHeading(markdown: string): string | null {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  let inFence = false;
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = FENCE_LINE_RE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const char = marker[0] as "`" | "~";
      const len = marker.length;
      const rest = (fence[2] ?? "").trim();

      if (!inFence) {
        inFence = true;
        fenceChar = char;
        fenceLen = len;
        continue;
      }

      if (char === fenceChar && len >= fenceLen && rest === "") {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    if (inFence) continue;

    const atx = ATX_HEADING_RE.exec(line);
    if (atx) {
      return finalizeHeadingText(atx[1] ?? "");
    }

    // Setext: content line + underline on the next line
    if (line.trim() !== "" && i + 1 < lines.length) {
      const next = lines[i + 1]!;
      if (SETEXT_UNDERLINE_RE.test(next) && !FENCE_LINE_RE.test(next)) {
        return finalizeHeadingText(line.trim());
      }
    }
  }

  return null;
}

/**
 * Prefer the draft’s first markdown heading; otherwise the Feature 01 fallback.
 */
export function resolveIssueDisplayTitle(opts: {
  markdown: string | null | undefined;
  newsletterName: string;
  dateIso: string;
}): string {
  const heading =
    opts.markdown != null && opts.markdown !== ""
      ? extractFirstMarkdownHeading(opts.markdown)
      : null;
  if (heading != null && heading !== "") {
    return heading;
  }
  return formatIssueFallbackTitle(opts.newsletterName, opts.dateIso);
}

function describeErrorForLog(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown };
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}

/**
 * Resolve display titles for a page of issue runs via concurrent draft loads.
 * Per-row load failure → {@link formatIssueFallbackTitle}; never throws for a
 * single bad row. Caller must pass only the current page (≤ 20) — this helper
 * does not paginate.
 */
export async function resolveIssueDisplayTitlesForRuns(
  client: Client,
  runs: Run[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    runs.map(async (run) => {
      const dateIso = run.endedAt ?? run.startedAt;
      const fallback = formatIssueFallbackTitle(run.newsletterName, dateIso);

      try {
        const payload = (await loadPhaseCheckpoint(
          client,
          run.$id,
          "draft",
        )) as DraftCheckpointPayload;
        const title = resolveIssueDisplayTitle({
          markdown: payload.markdown,
          newsletterName: run.newsletterName,
          dateIso,
        });
        return [run.$id, title] as const;
      } catch (err) {
        const { message, code } = describeErrorForLog(err);
        console.error({
          phase: "resolve-issue-display-title",
          runId: run.$id,
          code,
          message: sanitizeAppwriteMessageForLog(message),
        });
        return [run.$id, fallback] as const;
      }
    }),
  );

  return new Map(entries);
}
