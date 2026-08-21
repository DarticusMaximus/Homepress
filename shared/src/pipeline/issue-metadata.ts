/**
 * Cheap-model issue title / dek pass (Stage 15 Feature 02).
 *
 * After Feature 01 extracts title/dek from the draft, two sequential OpenRouter
 * calls overlay honest magazine copy onto those fields. This module renders the
 * claim-time template, calls the LLM with tagger-class retry, then parse/clamps
 * a plain string. Failures return `null` — they must never fail the run.
 */

import { ISSUE_DEK_ATTR_SIZE, ISSUE_TITLE_ATTR_SIZE } from "../schema/declarations";
import { renderPromptTemplate } from "../prompts/contract";
import { isEmptyOrPunctuationOnly } from "../runs/issues";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { DEFAULT_TIMEOUT_MS } from "./config";
import { withRetry } from "./llm-client";
import type { LLMClient } from "./llm-client";

/**
 * `max_completion_tokens` for title and dek calls. Cheap models spend this
 * budget thinking; 4000 is still a fraction of a cent per call.
 */
export const TITLE_DEK_MAX_COMPLETION_TOKENS = 4000 as const;

const FENCE_MARKER_RE = /```|~~~/;
const MULTILINE_FENCE_RE = /^(```+|~~~+)[^\n]*\n([\s\S]*?)\n\1[ \t]*$/;
const INLINE_FENCE_RE = /^(```+|~~~+)[ \t]*([\s\S]*?)[ \t]*\1[ \t]*$/;
const WRAP_CHARS = new Set(['"', "'", "`"]);
const ATX_ONE_HASH_RE = /^#[ \t]+/;

export interface GenerateIssueMetadataArgs {
  llm: LLMClient;
  model: string;
  promptTemplate: string;
  draft: string;
  newsletterName: string;
  audience: string;
}

function hasFenceMarker(text: string): boolean {
  return FENCE_MARKER_RE.test(text);
}

function unwrapSingleFencedBlock(text: string): string | null {
  const multiline = MULTILINE_FENCE_RE.exec(text);
  if (multiline) {
    return multiline[2] ?? "";
  }
  const inline = INLINE_FENCE_RE.exec(text);
  if (inline && (inline[1]?.length ?? 0) >= 3) {
    return inline[2] ?? "";
  }
  return null;
}

function unwrapMatchingWrap(text: string): string {
  if (text.length < 2) return text;
  const first = text[0]!;
  const last = text[text.length - 1]!;
  if (first === last && WRAP_CHARS.has(first)) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Parse a model completion into a plain string, or `null` if unusable.
 * Trim; unwrap one matching wrap of `"`, `'`, `` ` ``, or a single fenced
 * block; leftover fence → fail; strip one leading ATX `#` prefix; collapse
 * whitespace; punctuation-only / empty → fail. Does not clamp.
 */
export function parseGeneratedIssueField(raw: string): string | null {
  let s = raw.trim();

  const fenced = unwrapSingleFencedBlock(s);
  if (fenced !== null) {
    s = fenced.trim();
  } else if (hasFenceMarker(s)) {
    return null;
  } else {
    s = unwrapMatchingWrap(s).trim();
  }

  if (hasFenceMarker(s)) return null;

  s = s.replace(ATX_ONE_HASH_RE, "");
  s = s.replace(/\s+/g, " ").trim();

  if (isEmptyOrPunctuationOnly(s)) return null;
  return s;
}

function hardSlice(text: string, size: number): string {
  return text.length > size ? text.slice(0, size) : text;
}

/** Parse then hard-slice to {@link ISSUE_TITLE_ATTR_SIZE}. */
export function parseGeneratedIssueTitle(raw: string): string | null {
  const parsed = parseGeneratedIssueField(raw);
  if (parsed === null) return null;
  return hardSlice(parsed, ISSUE_TITLE_ATTR_SIZE);
}

/** Parse then hard-slice to {@link ISSUE_DEK_ATTR_SIZE}. No 160-char ellipsis. */
export function parseGeneratedIssueDek(raw: string): string | null {
  const parsed = parseGeneratedIssueField(raw);
  if (parsed === null) return null;
  return hardSlice(parsed, ISSUE_DEK_ATTR_SIZE);
}

function logGenerateFailure(phase: string, message: string): void {
  console.error({
    phase,
    message: sanitizeAppwriteMessageForLog(message),
  });
}

async function generateIssueMetadataField(
  args: GenerateIssueMetadataArgs,
  phase: "generate-issue-title" | "generate-issue-dek",
  parse: (raw: string) => string | null,
): Promise<string | null> {
  try {
    const rendered = renderPromptTemplate(args.promptTemplate, {
      draft: args.draft,
      newsletter_name: args.newsletterName,
      audience: args.audience,
    });

    const result = await withRetry(async () => {
      return args.llm.chatCompletion({
        model: args.model,
        messages: [{ role: "user", content: rendered }],
        timeoutMs: DEFAULT_TIMEOUT_MS,
        extraBody: {
          max_completion_tokens: TITLE_DEK_MAX_COMPLETION_TOKENS,
        },
      });
    });

    const parsed = parse(result.content);
    if (parsed === null) {
      logGenerateFailure(phase, "unusable generated issue metadata");
      return null;
    }
    return parsed;
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    logGenerateFailure(phase, rawMessage);
    return null;
  }
}

export async function generateIssueTitle(
  args: GenerateIssueMetadataArgs,
): Promise<string | null> {
  return generateIssueMetadataField(args, "generate-issue-title", parseGeneratedIssueTitle);
}

export async function generateIssueDek(
  args: GenerateIssueMetadataArgs,
): Promise<string | null> {
  return generateIssueMetadataField(args, "generate-issue-dek", parseGeneratedIssueDek);
}
