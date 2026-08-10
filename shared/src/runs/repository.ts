import { Client, Databases, ID, Query, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import {
  DATABASE_ID,
  EMAIL_DELIVERY_STATUSES,
  RSS_DELIVERY_STATUSES,
  RUNS_COLLECTION_ID,
  RUN_CHECKPOINTS_BUCKET_ID,
  RUN_TRIGGERS,
} from "../schema/declarations";
import type {
  EmailDeliveryStatus,
  RssDeliveryStatus,
  RunPhase,
  RunStatus,
  RunTrigger,
} from "../schema/declarations";
import {
  type ArticleJson,
  type CreateRunInput,
  type DraftCheckpointPayload,
  type FetchCheckpoint,
  type MarkCompletedInput,
  type MarkFailedInput,
  type PhaseArticleFailureJson,
  type PhaseCheckpointInput,
  type PhaseFailureSummaryJson,
  type Run,
  type SaveCheckpointOptions,
  type ScrapeCheckpoint,
  type ScoreCheckpoint,
  type ScoreCheckpointInput,
  type SelectionCheckpoint,
  type TagCheckpoint,
  type TagCheckpointInput,
  RunRepositoryError,
} from "./types";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import type { SuppressSummary } from "../pipeline/cross-run-suppress";
import { serializeSuppressSummary } from "./suppress-summary";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

const FAILURE_MESSAGE_MAX = 2000;

function coerceRunTrigger(value: unknown): RunTrigger {
  return (RUN_TRIGGERS as readonly string[]).includes(value as string)
    ? (value as RunTrigger)
    : "manual";
}

function coerceEmailDeliveryStatus(value: unknown): EmailDeliveryStatus {
  return (EMAIL_DELIVERY_STATUSES as readonly string[]).includes(value as string)
    ? (value as EmailDeliveryStatus)
    : "none";
}

function coerceRssDeliveryStatus(value: unknown): RssDeliveryStatus {
  return (RSS_DELIVERY_STATUSES as readonly string[]).includes(value as string)
    ? (value as RssDeliveryStatus)
    : "none";
}

interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

function describeError(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as AppwriteExceptionLike;
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}

function wrapAppwriteError(err: unknown, phase: string): never {
  const { message, code } = describeError(err);
  console.error({ phase, code, message: sanitizeAppwriteMessageForLog(message) });
  throw new RunRepositoryError("appwrite", APPWRITE_SAFE_MESSAGE);
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404;
}

function documentToRun(doc: Record<string, unknown>): Run {
  return {
    $id: doc.$id as string,
    newsletterId: doc.newsletterId as string,
    newsletterName: doc.newsletterName as string,
    status: doc.status as Run["status"],
    trigger: coerceRunTrigger(doc.trigger),
    currentPhase: (doc.currentPhase as string) ?? "",
    completedPhase: (doc.completedPhase as string) ?? "",
    failedPhase: (doc.failedPhase as string) ?? "",
    failureMessage: (doc.failureMessage as string) ?? "",
    startedAt: doc.startedAt as string,
    endedAt: (doc.endedAt as string | null) ?? null,
    topicSummary: (doc.topicSummary as string) ?? "",
    failedFeeds: (doc.failedFeeds as string) ?? "",
    suppressSummary: (doc.suppressSummary as string) ?? "",
    checkpointFetchId: (doc.checkpointFetchId as string) ?? "",
    checkpointScrapeId: (doc.checkpointScrapeId as string) ?? "",
    checkpointTagId: (doc.checkpointTagId as string) ?? "",
    checkpointScoreId: (doc.checkpointScoreId as string) ?? "",
    checkpointSelectionId: (doc.checkpointSelectionId as string) ?? "",
    checkpointDraftId: (doc.checkpointDraftId as string) ?? "",
    emailDeliveryStatus: coerceEmailDeliveryStatus(doc.emailDeliveryStatus),
    emailDeliveryAt: (doc.emailDeliveryAt as string | null) ?? null,
    emailDeliveryError: (doc.emailDeliveryError as string) ?? "",
    rssDeliveryStatus: coerceRssDeliveryStatus(doc.rssDeliveryStatus),
    rssDeliveryAt: (doc.rssDeliveryAt as string | null) ?? null,
    rssDeliveryError: (doc.rssDeliveryError as string) ?? "",
  };
}

export async function createRun(client: Client, input: CreateRunInput): Promise<Run> {
  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    newsletterId: input.newsletterId,
    newsletterName: input.newsletterName,
    status: "pending" as const,
    trigger: input.trigger ?? ("manual" as const),
    currentPhase: "",
    completedPhase: "",
    failedPhase: "",
    failureMessage: "",
    startedAt: now,
    endedAt: null,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "",
    emailDeliveryStatus: "none" as const,
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none" as const,
    rssDeliveryAt: null,
    rssDeliveryError: "",
  };

  try {
    const doc = await databases.createDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: ID.unique(),
      data,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    wrapAppwriteError(err, "create-run");
  }
}

export async function getRun(client: Client, runId: string): Promise<Run> {
  const databases = new Databases(client);
  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (isNotFound(err)) {
      throw new RunRepositoryError("not_found", "Run not found");
    }
    wrapAppwriteError(err, "get-run");
  }
}

/**
 * List all active (pending or running) runs for a newsletter, sorted
 * oldest-first by `startedAt` ascending, then `$id` ascending. Limited to 5
 * matches. Returns an empty array when none are active. Source of truth for
 * race cleanup and the pre-create guard.
 */
export async function listActiveRunsForNewsletter(
  client: Client,
  newsletterId: string,
): Promise<Run[]> {
  const databases = new Databases(client);
  try {
    const res = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      queries: [
        Query.equal("newsletterId", newsletterId),
        Query.equal("status", ["pending", "running"]),
        Query.limit(5),
      ],
    });
    const runs = (res.documents as unknown as Record<string, unknown>[]).map(documentToRun);
    runs.sort((a, b) => {
      const byStarted = a.startedAt.localeCompare(b.startedAt);
      if (byStarted !== 0) return byStarted;
      return a.$id.localeCompare(b.$id);
    });
    return runs;
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    wrapAppwriteError(err, "list-active-runs");
  }
}

/**
 * Convenience over {@link listActiveRunsForNewsletter}: returns the first
 * (oldest) active run, or `null` when none are active. Used by the GUI active
 * map and the simple pre-create guard.
 */
export async function findActiveRunForNewsletter(
  client: Client,
  newsletterId: string,
): Promise<Run | null> {
  const runs = await listActiveRunsForNewsletter(client, newsletterId);
  return runs[0] ?? null;
}

/**
 * List pending runs oldest-first (FIFO claim order) using
 * `Query.orderAsc("startedAt")`. An in-memory sort is applied after mapping so
 * order is guaranteed even if Appwrite silently ignores `orderAsc` due to a
 * missing index. Defaults to a limit of 10.
 */
export async function listPendingRuns(client: Client, opts?: { limit?: number }): Promise<Run[]> {
  const databases = new Databases(client);
  const limit = opts?.limit ?? 10;
  try {
    const res = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      queries: [Query.equal("status", "pending"), Query.orderAsc("startedAt"), Query.limit(limit)],
    });
    const runs = (res.documents as unknown as Record<string, unknown>[]).map(documentToRun);
    runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return runs;
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    wrapAppwriteError(err, "list-pending-runs");
  }
}

/**
 * List runs newest-first by `startedAt` (then `$id` descending for stability),
 * with optional `newsletterId` and `status` filters. Defaults to a limit of
 * 100. Sorting is always in-memory — `Query.orderDesc("startedAt")` is not used
 * because there is no index on `startedAt` (same anti-index pattern as
 * Feeds/Newsletters). If Appwrite rejects a filter query, falls back to a
 * broader limit-only fetch and filters in memory.
 */
export async function listRuns(
  client: Client,
  opts?: {
    newsletterId?: string;
    status?: RunStatus | RunStatus[];
    limit?: number;
  },
): Promise<Run[]> {
  const databases = new Databases(client);
  const limit = opts?.limit ?? 100;
  const queries: string[] = [Query.limit(limit)];
  if (opts?.newsletterId) {
    queries.push(Query.equal("newsletterId", opts.newsletterId));
  }
  if (opts?.status) {
    queries.push(Query.equal("status", opts.status));
  }

  let docsList: Record<string, unknown>[] = [];
  let filterInMemory = false;
  try {
    const res = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      queries,
    });
    docsList = res.documents as unknown as Record<string, unknown>[];
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    // Fallback: if a filter query was rejected by Appwrite, retry with a
    // broader limit-only fetch and filter in memory.
    if (!opts?.newsletterId && !opts?.status) {
      wrapAppwriteError(err, "list-runs");
    }
    try {
      const res = await databases.listDocuments({
        databaseId: DATABASE_ID,
        collectionId: RUNS_COLLECTION_ID,
        queries: [Query.limit(limit)],
      });
      docsList = res.documents as unknown as Record<string, unknown>[];
      filterInMemory = true;
    } catch (err2) {
      if (err2 instanceof RunRepositoryError) throw err2;
      wrapAppwriteError(err2, "list-runs");
    }
  }

  let runs = docsList.map(documentToRun);

  if (filterInMemory) {
    if (opts?.newsletterId) {
      const nlId = opts.newsletterId;
      runs = runs.filter((r) => r.newsletterId === nlId);
    }
    if (opts?.status) {
      const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
      runs = runs.filter((r) => statuses.includes(r.status));
    }
  }

  runs.sort((a, b) => {
    const byStarted = b.startedAt.localeCompare(a.startedAt);
    if (byStarted !== 0) return byStarted;
    return b.$id.localeCompare(a.$id);
  });

  return runs;
}

export async function markRunning(
  client: Client,
  runId: string,
  currentPhase: string,
): Promise<Run> {
  const databases = new Databases(client);
  const data = {
    status: "running",
    currentPhase,
    failedPhase: "",
    failureMessage: "",
    endedAt: null,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new RunRepositoryError("not_found", "Run not found");
    }
    wrapAppwriteError(err, "mark-running");
  }
}

export async function requeueFailedRun(client: Client, runId: string): Promise<Run> {
  const run = await getRun(client, runId);
  if (run.status !== "failed") {
    throw new RunRepositoryError(
      "validation",
      `Cannot requeue run ${runId}: status is "${run.status}", expected "failed"`,
    );
  }

  const databases = new Databases(client);
  const data = {
    status: "pending",
    trigger: "manual" as const,
    failedPhase: "",
    failureMessage: "",
    endedAt: null,
    currentPhase: "",
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new RunRepositoryError("not_found", "Run not found");
    }
    wrapAppwriteError(err, "requeue-failed-run");
  }
}

export async function markFailed(
  client: Client,
  runId: string,
  input: MarkFailedInput,
): Promise<Run> {
  const databases = new Databases(client);
  const now = new Date().toISOString();
  const truncatedMessage = input.failureMessage.slice(0, FAILURE_MESSAGE_MAX);
  const data: Record<string, unknown> = {
    status: "failed",
    failedPhase: input.failedPhase,
    failureMessage: truncatedMessage,
    endedAt: now,
  };
  if (input.completedPhase !== undefined) {
    data.completedPhase = input.completedPhase;
  }
  if (input.failedFeeds !== undefined) {
    data.failedFeeds = JSON.stringify(input.failedFeeds);
  }

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new RunRepositoryError("not_found", "Run not found");
    }
    wrapAppwriteError(err, "mark-failed");
  }
}

function validateTopicSummary(
  topicSummary: unknown,
): asserts topicSummary is MarkCompletedInput["topicSummary"] {
  if (!Array.isArray(topicSummary)) {
    throw new RunRepositoryError("validation", "topicSummary must be an array");
  }
  for (const item of topicSummary) {
    if (!item || typeof item !== "object") {
      throw new RunRepositoryError("validation", "topicSummary items must be objects");
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== "string") {
      throw new RunRepositoryError("validation", "topicSummary items must have a string title");
    }
    if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) {
      throw new RunRepositoryError("validation", "topicSummary items must have a string[] tags");
    }
  }
}

export async function markCompleted(
  client: Client,
  runId: string,
  input: MarkCompletedInput,
): Promise<Run> {
  validateTopicSummary(input.topicSummary);

  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    status: "completed",
    topicSummary: JSON.stringify(input.topicSummary),
    endedAt: now,
    failedPhase: "",
    failureMessage: "",
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new RunRepositoryError("not_found", "Run not found");
    }
    wrapAppwriteError(err, "mark-completed");
  }
}

/**
 * Persist the cross-run suppress summary JSON onto the run document's
 * `suppressSummary` field. `count === 0` serializes to `""` (empty string).
 */
export async function saveSuppressSummary(
  client: Client,
  runId: string,
  summary: SuppressSummary,
): Promise<void> {
  const databases = new Databases(client);
  const data = {
    suppressSummary: serializeSuppressSummary(summary),
  };

  try {
    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new RunRepositoryError("not_found", "Run not found");
    }
    wrapAppwriteError(err, "save-suppress-summary");
  }
}

// ---------------------------------------------------------------------------
// Phase checkpoints (Storage JSON files)
// ---------------------------------------------------------------------------

/** Maps a completed phase to its run-document checkpoint-id field. */
const CHECKPOINT_FIELD: Record<RunPhase, keyof Run> = {
  fetch: "checkpointFetchId",
  scrape: "checkpointScrapeId",
  tag: "checkpointTagId",
  score: "checkpointScoreId",
  selection: "checkpointSelectionId",
  draft: "checkpointDraftId",
};

/** Removes a possibly-present `embedding` vector from an article before persist. */
function stripEmbedding<T>(article: T): Omit<T, "embedding"> {
  const { embedding: _embedding, ...rest } = article as T & {
    embedding?: unknown;
  };
  void _embedding;
  return rest as Omit<T, "embedding">;
}

/** Serializes a phase checkpoint payload to UTF-8 JSON per the wire contract. */
function serializeCheckpoint(phase: RunPhase, payload: PhaseCheckpointInput): string {
  switch (phase) {
    case "fetch":
      return JSON.stringify({
        articles: (payload as { articles: unknown[] }).articles,
      });
    case "scrape":
      return JSON.stringify({
        articles: (payload as { articles: unknown[] }).articles,
        summary: (payload as { summary: unknown }).summary,
      });
    case "tag": {
      const tag = payload as TagCheckpointInput;
      const out: {
        taggedArticles: TagCheckpointInput["taggedArticles"];
        phaseFailure?: PhaseFailureSummaryJson;
      } = {
        taggedArticles: tag.taggedArticles,
      };
      // Halt writes emit phaseFailure; success / legacy omit the key.
      if (tag.phaseFailure !== undefined) {
        out.phaseFailure = tag.phaseFailure;
      }
      return JSON.stringify(out);
    }
    case "score": {
      const score = payload as ScoreCheckpointInput;
      const out: {
        scoredArticles: ReturnType<typeof stripEmbedding>[];
        phaseFailure?: PhaseFailureSummaryJson;
      } = {
        scoredArticles: score.scoredArticles.map((a) => stripEmbedding(a)),
      };
      if (score.phaseFailure !== undefined) {
        out.phaseFailure = score.phaseFailure;
      }
      return JSON.stringify(out);
    }
    case "selection": {
      const sel = payload as {
        selectedArticles: unknown[];
        failures: unknown[];
      };
      // Always emit `failures` (including `[]`). Omission is reserved for legacy files.
      return JSON.stringify({
        selectedArticles: sel.selectedArticles.map((a) => stripEmbedding(a)),
        failures: sel.failures,
      });
    }
    case "draft": {
      const d = payload as DraftCheckpointPayload;
      return JSON.stringify({
        markdown: d.markdown,
        empty: d.empty,
        reason: d.reason,
        articleCount: d.articleCount,
        attempts: d.attempts,
      });
    }
  }
}

type DatedArticle = { published: string };

/** Converts an ISO `published` string into a `Date` on an article-shaped object. */
function reviveArticleDate<T extends DatedArticle>(
  article: T,
): Omit<T, "published"> & { published: Date } {
  const { published, ...rest } = article;
  return { ...rest, published: new Date(published) };
}

/** Finite, non-negative number (rejects NaN, ±Infinity, negatives). */
function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Runtime guard for draft checkpoint JSON at the revive boundary.
 * Throws on malformed values so downloadReviveCheckpoint maps them to
 * `checkpoint_missing` (same path as corrupt / unreadable files).
 */
function assertDraftCheckpointPayload(parsed: unknown): DraftCheckpointPayload {
  if (parsed === null || typeof parsed !== "object") {
    throw new SyntaxError("Draft checkpoint payload is not an object");
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.markdown !== "string") {
    throw new SyntaxError("Draft checkpoint markdown must be a string");
  }
  if (typeof p.empty !== "boolean") {
    throw new SyntaxError("Draft checkpoint empty must be a boolean");
  }
  if (!(p.reason === null || typeof p.reason === "string")) {
    throw new SyntaxError("Draft checkpoint reason must be null or a string");
  }
  if (!isNonNegativeFiniteNumber(p.articleCount)) {
    throw new SyntaxError("Draft checkpoint articleCount must be a non-negative finite number");
  }
  if (!isNonNegativeFiniteNumber(p.attempts)) {
    throw new SyntaxError("Draft checkpoint attempts must be a non-negative finite number");
  }
  return {
    markdown: p.markdown,
    empty: p.empty,
    reason: p.reason as DraftCheckpointPayload["reason"],
    articleCount: p.articleCount,
    attempts: p.attempts,
  };
}

/**
 * Runtime guard for tag/score `phaseFailure` at the revive boundary.
 * Throws on malformed values so downloadReviveCheckpoint maps them to
 * `checkpoint_missing` (same path as corrupt draft / unreadable files).
 */
function assertPhaseFailureSummary(value: unknown): PhaseFailureSummaryJson {
  if (value === null || typeof value !== "object") {
    throw new SyntaxError("phaseFailure must be a non-null object");
  }
  const p = value as Record<string, unknown>;
  if (p.halted !== true) {
    throw new SyntaxError("phaseFailure.halted must be true");
  }
  if (!(p.haltReason === null || typeof p.haltReason === "string")) {
    throw new SyntaxError("phaseFailure.haltReason must be null or a string");
  }
  if (!isNonNegativeFiniteNumber(p.consecutiveErrors)) {
    throw new SyntaxError(
      "phaseFailure.consecutiveErrors must be a non-negative finite number",
    );
  }
  if (!isNonNegativeFiniteNumber(p.totalArticles)) {
    throw new SyntaxError("phaseFailure.totalArticles must be a non-negative finite number");
  }
  if (!isNonNegativeFiniteNumber(p.failureCount)) {
    throw new SyntaxError("phaseFailure.failureCount must be a non-negative finite number");
  }
  if (!Array.isArray(p.failures)) {
    throw new SyntaxError("phaseFailure.failures must be an array");
  }

  const failures: PhaseArticleFailureJson[] = p.failures.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new SyntaxError(`phaseFailure.failures[${index}] must be an object`);
    }
    const f = item as Record<string, unknown>;
    if (typeof f.articleTitle !== "string") {
      throw new SyntaxError(`phaseFailure.failures[${index}].articleTitle must be a string`);
    }
    if (typeof f.articleLink !== "string") {
      throw new SyntaxError(`phaseFailure.failures[${index}].articleLink must be a string`);
    }
    if (typeof f.error !== "string") {
      throw new SyntaxError(`phaseFailure.failures[${index}].error must be a string`);
    }
    if (!isNonNegativeFiniteNumber(f.attempts)) {
      throw new SyntaxError(
        `phaseFailure.failures[${index}].attempts must be a non-negative finite number`,
      );
    }

    const out: PhaseArticleFailureJson = {
      articleTitle: f.articleTitle,
      articleLink: f.articleLink,
      error: f.error,
      attempts: f.attempts,
    };

    if ("reason" in f && f.reason !== undefined) {
      if (f.reason !== "exception" && f.reason !== "parse") {
        throw new SyntaxError(
          `phaseFailure.failures[${index}].reason must be "exception" or "parse"`,
        );
      }
      out.reason = f.reason;
    }

    return out;
  });

  return {
    halted: true,
    haltReason: p.haltReason,
    consecutiveErrors: p.consecutiveErrors,
    totalArticles: p.totalArticles,
    failureCount: p.failureCount,
    failures,
  };
}

/** Parses + revives a downloaded checkpoint body into its in-memory shape. */
function reviveCheckpoint(
  phase: RunPhase,
  parsed: unknown,
):
  | FetchCheckpoint
  | ScrapeCheckpoint
  | TagCheckpoint
  | ScoreCheckpoint
  | SelectionCheckpoint
  | DraftCheckpointPayload {
  switch (phase) {
    case "fetch": {
      const p = parsed as { articles: ArticleJson[] };
      return { articles: p.articles.map((a) => reviveArticleDate(a)) };
    }
    case "scrape": {
      const p = parsed as { articles: ArticleJson[]; summary: ScrapeCheckpoint["summary"] };
      return {
        articles: p.articles.map((a) => reviveArticleDate(a)),
        summary: p.summary,
      };
    }
    case "tag": {
      const p = parsed as {
        taggedArticles: (ArticleJson & { tags: string[] })[];
        phaseFailure?: unknown;
      };
      const checkpoint: TagCheckpoint = {
        taggedArticles: p.taggedArticles.map((a) => reviveArticleDate(a)),
      };
      // Key present → halt recorded; key missing → success / legacy.
      // Assert shape so poison phaseFailure never reaches Inspect.
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "phaseFailure" in parsed &&
        p.phaseFailure !== undefined
      ) {
        checkpoint.phaseFailure = assertPhaseFailureSummary(p.phaseFailure);
      }
      return checkpoint;
    }
    case "score": {
      const p = parsed as {
        scoredArticles: (ArticleJson & { tags: string[]; score: number })[];
        phaseFailure?: unknown;
      };
      const checkpoint: ScoreCheckpoint = {
        scoredArticles: p.scoredArticles.map((a) => reviveArticleDate(a)),
      };
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "phaseFailure" in parsed &&
        p.phaseFailure !== undefined
      ) {
        checkpoint.phaseFailure = assertPhaseFailureSummary(p.phaseFailure);
      }
      return checkpoint;
    }
    case "selection": {
      const p = parsed as {
        selectedArticles: (ArticleJson & { tags: string[]; score: number })[];
        failures?: SelectionCheckpoint["failures"];
      };
      const checkpoint: SelectionCheckpoint = {
        selectedArticles: p.selectedArticles.map((a) => reviveArticleDate(a)),
      };
      // Key present (including `[]`) → failures recorded; key missing → legacy.
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "failures" in parsed &&
        Array.isArray(p.failures)
      ) {
        checkpoint.failures = p.failures;
      }
      return checkpoint;
    }
    case "draft":
      return assertDraftCheckpointPayload(parsed);
  }
}

/**
 * Upload a phase checkpoint as a JSON file to the `run_checkpoints` bucket and
 * record its file id on the run document, advancing `completedPhase`. For the
 * `fetch` phase, `opts.failedFeeds` (default `[]`) is JSON-stringified into the
 * run's `failedFeeds` field.
 *
 * A phase is considered complete only when both the Storage upload and the
 * run-document update succeed. On any failure after the phase was notionally
 * done: the orphan file is best-effort deleted (if the upload succeeded but the
 * doc update failed), the run is marked `failed` with `failedPhase` set to the
 * phase being saved (best-effort), `completedPhase` is NOT advanced, and a
 * `RunRepositoryError("appwrite")` is rethrown.
 */
export async function savePhaseCheckpoint(
  client: Client,
  runId: string,
  phase: RunPhase,
  payload: PhaseCheckpointInput,
  opts?: SaveCheckpointOptions,
): Promise<Run> {
  const json = serializeCheckpoint(phase, payload);
  const storage = new Storage(client);

  let uploadedFileId: string | null = null;
  try {
    const fileId = ID.unique();
    await storage.createFile({
      bucketId: RUN_CHECKPOINTS_BUCKET_ID,
      fileId,
      file: InputFile.fromPlainText(json, `${runId}-${phase}.json`),
    });
    uploadedFileId = fileId;

    const data: Record<string, unknown> = {
      [CHECKPOINT_FIELD[phase]]: fileId,
      completedPhase: phase,
    };
    if (phase === "fetch") {
      data.failedFeeds = JSON.stringify(opts?.failedFeeds ?? []);
    }

    const databases = new Databases(client);
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
    return documentToRun(doc as unknown as Record<string, unknown>);
  } catch (error) {
    const { message, code } = describeError(error);
    console.error({
      phase: `save-checkpoint-${phase}`,
      code,
      message: sanitizeAppwriteMessageForLog(message),
    });

    // Best-effort orphan cleanup: only if the upload committed a file id.
    if (uploadedFileId !== null) {
      try {
        await storage.deleteFile({
          bucketId: RUN_CHECKPOINTS_BUCKET_ID,
          fileId: uploadedFileId,
        });
      } catch {
        // Best-effort — don't mask the original failure.
      }
    }

    // Best-effort mark-failed: the phase is NOT complete.
    try {
      await markFailed(client, runId, {
        failedPhase: phase,
        failureMessage: `Failed to save ${phase} checkpoint`,
      });
    } catch {
      // Best-effort — don't mask the original failure.
    }

    throw new RunRepositoryError("appwrite", APPWRITE_SAFE_MESSAGE);
  }
}

/**
 * Normalize a Storage download into a parsed JSON value.
 *
 * `node-appwrite`'s `Client.call` prefers JSON parsing whenever the response
 * `Content-Type` is `application/json` — even for `getFileDownload` (requested
 * as `arrayBuffer`). Checkpoint files are stored as `application/json`, so the
 * live SDK returns an already-parsed object. Unit mocks and non-JSON responses
 * still return `ArrayBuffer` / `Uint8Array` / string bytes.
 */
function parseCheckpointDownload(data: unknown): unknown {
  if (typeof data === "string") {
    return JSON.parse(data) as unknown;
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  }
  if (data !== null && typeof data === "object") {
    return data;
  }
  throw new SyntaxError("Checkpoint download is not JSON-compatible");
}

/** Phases whose checkpoints are article lists (Inspect candidate surface). */
export type PhaseArticleListPhase = "fetch" | "scrape" | "tag" | "score";

/**
 * Phases loadable via {@link loadPhaseCheckpointFromRun} (Feature 05 article
 * lists + Feature 06 selection + Feature 07 draft).
 */
export type PhaseCheckpointFromRunPhase = PhaseArticleListPhase | "selection" | "draft";

/**
 * Download + parse + revive a phase checkpoint using the file id already on
 * `run`. Does not call `getRun`. A missing id or missing/corrupt file yields
 * `RunRepositoryError("checkpoint_missing")`.
 */
async function downloadReviveCheckpoint(
  client: Client,
  run: Run,
  phase: RunPhase,
): Promise<
  | FetchCheckpoint
  | ScrapeCheckpoint
  | TagCheckpoint
  | ScoreCheckpoint
  | SelectionCheckpoint
  | DraftCheckpointPayload
> {
  const fileId = run[CHECKPOINT_FIELD[phase]] as string;
  if (!fileId) {
    throw new RunRepositoryError("checkpoint_missing", `No checkpoint stored for phase ${phase}`);
  }

  const storage = new Storage(client);
  let downloaded: unknown;
  try {
    downloaded = await storage.getFileDownload({
      bucketId: RUN_CHECKPOINTS_BUCKET_ID,
      fileId,
    });
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new RunRepositoryError(
        "checkpoint_missing",
        `Checkpoint file not found for phase ${phase}`,
      );
    }
    wrapAppwriteError(err, `load-checkpoint-${phase}-download`);
  }

  try {
    const parsed = parseCheckpointDownload(downloaded);
    return reviveCheckpoint(phase, parsed);
  } catch {
    throw new RunRepositoryError(
      "checkpoint_missing",
      `Checkpoint file for phase ${phase} is corrupted or unreadable`,
    );
  }
}

/**
 * Load a fetch/scrape/tag/score/selection/draft checkpoint from an in-memory
 * `Run` without a second document fetch. Resolves the file id via the same
 * `CHECKPOINT_FIELD` map as `loadPhaseCheckpoint`, then downloads, parses, and
 * revives.
 */
export async function loadPhaseCheckpointFromRun(
  client: Client,
  run: Run,
  phase: PhaseArticleListPhase,
): Promise<FetchCheckpoint | ScrapeCheckpoint | TagCheckpoint | ScoreCheckpoint>;
export async function loadPhaseCheckpointFromRun(
  client: Client,
  run: Run,
  phase: "selection",
): Promise<SelectionCheckpoint>;
export async function loadPhaseCheckpointFromRun(
  client: Client,
  run: Run,
  phase: "draft",
): Promise<DraftCheckpointPayload>;
export async function loadPhaseCheckpointFromRun(
  client: Client,
  run: Run,
  phase: PhaseCheckpointFromRunPhase,
): Promise<
  | FetchCheckpoint
  | ScrapeCheckpoint
  | TagCheckpoint
  | ScoreCheckpoint
  | SelectionCheckpoint
  | DraftCheckpointPayload
> {
  return downloadReviveCheckpoint(client, run, phase) as Promise<
    | FetchCheckpoint
    | ScrapeCheckpoint
    | TagCheckpoint
    | ScoreCheckpoint
    | SelectionCheckpoint
    | DraftCheckpointPayload
  >;
}

/**
 * Load a phase checkpoint: read the file id from the run document, download the
 * JSON file, parse it, and revive `published` ISO strings into `Date` objects
 * for article-bearing payloads (draft is returned as-is). A missing id or a
 * missing file yields `RunRepositoryError("checkpoint_missing")`.
 */
export async function loadPhaseCheckpoint(
  client: Client,
  runId: string,
  phase: RunPhase,
): Promise<
  | FetchCheckpoint
  | ScrapeCheckpoint
  | TagCheckpoint
  | ScoreCheckpoint
  | SelectionCheckpoint
  | DraftCheckpointPayload
> {
  const run = await getRun(client, runId);
  return downloadReviveCheckpoint(client, run, phase);
}

/**
 * Delete a run and its associated checkpoint files from Storage. Fetches the
 * run first (404 → `not_found`), best-effort deletes each non-empty checkpoint
 * file id from the `run_checkpoints` bucket (catching and logging sanitized
 * errors — missing files are treated as success), then deletes the run
 * document. Rethrows only if the document delete fails (`appwrite`).
 */
export async function deleteRun(client: Client, runId: string): Promise<void> {
  const run = await getRun(client, runId);

  const storage = new Storage(client);
  const checkpointIds = (
    [
      run.checkpointFetchId,
      run.checkpointScrapeId,
      run.checkpointTagId,
      run.checkpointScoreId,
      run.checkpointSelectionId,
      run.checkpointDraftId,
    ] as string[]
  ).filter((id) => id.length > 0);

  for (const fileId of checkpointIds) {
    try {
      await storage.deleteFile({
        bucketId: RUN_CHECKPOINTS_BUCKET_ID,
        fileId,
      });
    } catch (err) {
      const { message, code } = describeError(err);
      console.error({
        phase: "delete-run-checkpoint",
        code,
        message: sanitizeAppwriteMessageForLog(message),
      });
    }
  }

  const databases = new Databases(client);
  try {
    await databases.deleteDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
    });
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    wrapAppwriteError(err, "delete-run");
  }
}

/**
 * Page through the entire `runs` collection until exhausted. Default page size
 * 100. Uses `Query.limit(pageSize)` on every request and
 * `Query.cursorAfter(lastId)` for subsequent pages. Maps each page via
 * `documentToRun`. Returns the full concatenated array. NOT for the `/runs` UI
 * (Feature 03 stays at limit 100); intended for retention sweeps and other
 * full-collection scans.
 */
export async function listAllRuns(client: Client, opts?: { pageSize?: number }): Promise<Run[]> {
  const databases = new Databases(client);
  const pageSize = opts?.pageSize ?? 100;
  const all: Run[] = [];
  let cursorId: string | null = null;

  try {
    for (;;) {
      const queries: string[] = [Query.limit(pageSize)];
      if (cursorId) {
        queries.push(Query.cursorAfter(cursorId));
      }
      const res = await databases.listDocuments({
        databaseId: DATABASE_ID,
        collectionId: RUNS_COLLECTION_ID,
        queries,
      });
      const docs = res.documents as unknown as Record<string, unknown>[];
      const pageRuns = docs.map(documentToRun);
      all.push(...pageRuns);

      if (pageRuns.length < pageSize) break;
      cursorId = String(docs[docs.length - 1]!.$id);
    }
    return all;
  } catch (err) {
    if (err instanceof RunRepositoryError) throw err;
    wrapAppwriteError(err, "list-all-runs");
  }
}
