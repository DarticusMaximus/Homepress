/**
 * Pipeline core data types.
 *
 * Pure types + pure factory/guard helpers. No LLM calls, no network, no
 * Appwrite, no persistence. Field names mirror the legacy Python pipeline's
 * semantics (snake_case → camelCase); no legacy field is dropped or added.
 */

import type { DateRange } from "./config";

// ---------------------------------------------------------------------------
// Article progression: Article → TaggedArticle → ScoredArticle → SelectedArticle
// Each extends the prior so the structural assignability chain holds.
// ---------------------------------------------------------------------------

export interface Article {
  title: string;
  link: string;
  /** Publication timestamp. Carried as a `Date`; RSS-date parsing happens in the fetcher. */
  published: Date;
  content: string;
  source: string;
}

export interface TaggedArticle extends Article {
  tags: string[];
}

export interface ScoredArticle extends TaggedArticle {
  score: number;
  /** Optional dense vector used by the scorer/selection (MMR) phase. */
  embedding?: number[];
}

/**
 * A `ScoredArticle` chosen by the MMR selection phase. Structurally identical
 * to `ScoredArticle` (it is simply a scored article that survived selection),
 * declared as its own name so stage-03 run records can speak precisely.
 */
export type SelectedArticle = ScoredArticle;

// ---------------------------------------------------------------------------
// Newsletter configuration
// ---------------------------------------------------------------------------

export interface NewsletterConfig {
  name: string;
  topics: string[];
  dislikedTopics: string[];
  audience: string;
  newsItems: number;
  feeds: string[];
  dateRange: DateRange;
  interPhaseDelaySeconds: number;
}

/** Input shape for {@link createNewsletterConfig}: only the required fields. */
export interface NewsletterConfigInput {
  name: string;
  topics: string[];
  feeds: string[];
  dislikedTopics?: string[];
  audience?: string;
  newsItems?: number;
  dateRange?: DateRange;
  interPhaseDelaySeconds?: number;
}

// ---------------------------------------------------------------------------
// Phase results & structured failures
// ---------------------------------------------------------------------------

/**
 * Short stable codes identifying the failure mode of a feed fetch. Consumed by
 * stage-03 run records and feed-health monitoring to classify outages without
 * parsing free-text messages.
 */
export type FeedErrorType =
  "HttpError" | "NetworkError" | "TimeoutError" | "ParseError" | "BlockedError";

/**
 * Structured per-feed failure (used by the fetch phase and stage-03 health).
 * `feedUrl` is the feed that failed; `errorType` is a short stable code;
 * `errorMessage` is the human-readable detail; `statusCode` is present ONLY for
 * HTTP errors (`HttpError`).
 */
export interface FeedFailure {
  feedUrl: string;
  errorType: FeedErrorType;
  errorMessage: string;
  /** Present only when `errorType === 'HttpError'`. */
  statusCode?: number;
}

/**
 * Structured per-article failure for the tag phase (feature 04). Mirrors the
 * legacy per-article error: which article (title + link), the error message,
 * and how many attempts `withRetry` made before giving up.
 */
export interface TagFailure {
  articleTitle: string;
  articleLink: string;
  error: string;
  attempts: number;
}

/**
 * Result of the tag phase (feature 04 pins the exact fields, following the
 * feature-03 amendment pattern). `taggedArticles` includes failed articles
 * (with `tags: []`) — no article is silently dropped; `failures` carries the
 * per-article errors; `halted`/`haltReason` flag a consecutive-error-threshold
 * halt (the TS port returns structured state instead of raising the legacy
 * `TaggingError`, preserving partial output for stage-03 resume).
 */
export interface TagResult {
  taggedArticles: TaggedArticle[];
  failures: TagFailure[];
  halted: boolean;
  haltReason: string | null;
  consecutiveErrors: number;
  totalArticles: number;
}

/**
 * Structured per-article failure for the score phase (feature 05). Mirrors the
 * legacy per-article error: which article (title + link), the error message,
 * the failure `reason` ('exception' from the LLM call path or 'parse' from a
 * non-numeric scorer response), and how many attempts were made before giving
 * up (LLM-call exceptions go through `withRetry`; parse failures do NOT retry,
 * so `attempts` is `1` for `reason: 'parse'`).
 */
export interface ScoreFailure {
  articleTitle: string;
  articleLink: string;
  error: string;
  reason: "exception" | "parse";
  attempts: number;
}

/**
 * Result of the score phase (feature 05 pins the exact fields). `scoredArticles`
 * holds the successfully-scored articles; `failures` carries the per-article
 * errors; `halted`/`haltReason` flag a consecutive-error-threshold halt; the
 * failed article is NOT added to `scoredArticles` (unlike the tag phase, which
 * retains failed items with empty tags).
 */
export interface ScoreResult {
  scoredArticles: ScoredArticle[];
  failures: ScoreFailure[];
  halted: boolean;
  haltReason: string | null;
  consecutiveErrors: number;
  totalArticles: number;
}

/**
 * Structured per-article failure for the selection phase (feature 06). Mirrors
 * the legacy per-article drop telemetry: which article (title + link), the
 * failure `reason` ('below-threshold' for articles filtered out by the score
 * threshold, 'embedding-failed' for articles lost in an atomic batch embedding
 * failure, 'not-selected' for candidates that passed the threshold and were
 * embedded but were not chosen by MMR because `target < candidateCount`), and
 * `error` carrying the LLM/embedding (or not-selected rationale) message when
 * present.
 */
export interface SelectionFailure {
  articleTitle: string;
  articleLink: string;
  reason: "below-threshold" | "embedding-failed" | "not-selected";
  /**
   * Present when `reason === 'embedding-failed'` (the LLM/embedding error
   * message) or `reason === 'not-selected'` (a short rationale, e.g.
   * `"not selected by MMR (target=N, candidates=M)"`).
   */
  error?: string;
}

/**
 * Result of the selection phase (feature 06 pins the exact fields, following
 * the feature-03/04/05 amendment pattern). `selectedArticles` holds the
 * MMR-chosen set (embeddings filled); `failures` carries the below-threshold
 * and embedding-failed articles; `candidateCount` is the count that passed the
 * threshold filter; `targetCount` is the requested N; `lambda`/`minScore`
 * echo the selector configuration. Unlike the tag/score phases, selection has
 * no consecutive-error halt — a failed embedding batch fails the phase
 * atomically (every candidate recorded as `reason: 'embedding-failed'`).
 */
export interface SelectionResult {
  selectedArticles: SelectedArticle[];
  failures: SelectionFailure[];
  totalArticles: number;
  candidateCount: number;
  targetCount: number;
  lambda: number;
  minScore: number;
}

/**
 * Result of the draft phase (feature 07 pins the exact fields). `markdown` is
 * the finished newsletter (empty unless the draft succeeded); `articleCount`
 * is the number of articles handed to the drafter; `empty` is the fatal flag
 * (true when `markdown` is empty); `reason` classifies the empty case
 * (`'no-articles'` for empty input, `'empty-after-retry'` when the LLM returned
 * an empty response after the one-shot retry); `attempts` counts the
 * `chatCompletion` calls made (0, 1, or 2); `raw` carries the last raw
 * OpenRouter response.
 */
export interface DraftResult {
  markdown: string;
  articleCount: number;
  empty: boolean;
  reason: "no-articles" | "empty-after-retry" | null;
  attempts: number;
  raw?: unknown;
  /**
   * Recoverable one-shot retry error message (O2-20260630). Populated ONLY on
   * the `empty-after-retry` path when the best-effort one-shot retry threw —
   * the throw is still swallowed (the drafter proceeds to `empty-after-retry`
   * unchanged), but the error message is captured here so callers/dashboards
   * can recover it. Absent (`undefined`) when the one-shot retry was not
   * reached, did not throw, or when the draft succeeded. Additive — backward
   * compatible.
   */
  retryError?: string;
}

/** Ordered names of the pipeline phases (fetch → draft). */
export type PipelinePhase = "fetch" | "scrape" | "tag" | "score" | "selection" | "draft";

/** Top-level pipeline outcome: ok (newsletter drafted) or failed. */
export type PipelineStatus = "ok" | "failed";

/**
 * Aggregated summary of the scrape phase: total URLs attempted, how many were
 * `extracted` (Mozilla Readability success), and how many fell back to the RSS
 * summary (`fallback`).
 */
export interface ScrapeSummary {
  total: number;
  extracted: number;
  fallback: number;
}

/**
 * Final result of {@link runPipeline}. Carries the finished newsletter
 * (`markdown` when `status === 'ok'`), the structured outcome of every phase,
 * the failure classification (`failedPhase` + `failureReason`) when the run
 * aborted, the newsletter config echo, and the per-stage counts.
 */
export interface PipelineResult {
  status: PipelineStatus;
  markdown: string;
  failedPhase: PipelinePhase | null;
  failureReason: string | null;
  newsletter: { name: string; newsItems: number; dateRange: string };
  phases: {
    fetch: FetchResult;
    scrape: ScrapeSummary;
    tag: TagResult;
    score: ScoreResult;
    selection: SelectionResult;
    draft: DraftResult;
  };
  totals: {
    fetched: number;
    scraped: number;
    tagged: number;
    scored: number;
    selected: number;
  };
}

/**
 * Result of the fetch phase. The concrete fetch-result shape:
 * `articles` are the successfully-ingested items across all
 * feeds (deduplicated and date-filtered by the caller), `failedFeeds` carries
 * one {@link FeedFailure} per feed that errored, and `totalFeeds` is the input
 * feed count (so failure rate is derivable without re-counting inputs).
 */
export interface FetchResult {
  articles: Article[];
  failedFeeds: FeedFailure[];
  totalFeeds: number;
}

// ---------------------------------------------------------------------------
// Article scraper result
// ---------------------------------------------------------------------------

/**
 * Result of scraping a single article URL. On success (`source: 'extracted'`)
 * `content` is the cleaned-markdown main body extracted by Mozilla Readability.
 * On any failure path (`source: 'fallback'`) `content` is the cleaned fallback
 * (RSS summary) and `error` carries a short diagnostic (`'timeout'` for an
 * AbortError, otherwise a status code / error name). The scraper NEVER throws;
 * every path yields a usable ScrapeResult.
 */
export interface ScrapeResult {
  url: string;
  content: string;
  source: "extracted" | "fallback";
  /** Present only when `source === 'fallback'`. `'timeout'` for AbortError. */
  error?: string;
}

/**
 * Error thrown by pipeline factories (e.g. {@link createNewsletterConfig}) when
 * an input violates a validation invariant. Carries a stable `name` so callers
 * (parity-run, future Appwrite persistence) can branch on it without parsing
 * the human-readable `message`.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ---------------------------------------------------------------------------
// Factory: createArticle
// ---------------------------------------------------------------------------

/** Input shape for {@link createArticle}. */
export interface ArticleInput {
  title: string;
  link: string;
  /** Publication timestamp. Carried as a `Date`; RSS-date parsing happens in the fetcher. */
  published: Date;
  content: string;
  source: string;
}

/**
 * Construct an {@link Article}, rejecting inputs where `title` or `link` is
 * missing or empty. Mirrors the legacy invariant that every article must carry
 * a non-empty title and link.
 */
export function createArticle(input: ArticleInput): Article {
  if (!isNonEmptyString(input.title)) {
    throw new Error("createArticle: title must be a non-empty string");
  }
  if (!isNonEmptyString(input.link)) {
    throw new Error("createArticle: link must be a non-empty string");
  }
  return {
    title: input.title,
    link: input.link,
    published: input.published,
    content: input.content,
    source: input.source,
  };
}

// ---------------------------------------------------------------------------
// Factory: createNewsletterConfig
// ---------------------------------------------------------------------------

/**
 * Construct a {@link NewsletterConfig}, rejecting empty/missing `feeds` or
 * `topics` and filling the legacy defaults for any omitted optional field:
 * `dislikedTopics: []`, `audience: ''`, `newsItems: 16`, `dateRange: 'yesterday'`,
 * `interPhaseDelaySeconds: 3`.
 *
 * `name` is sanitized for downstream safety: it MUST NOT contain path
 * separators (`/`, `\`), traversal sequences (`..`), or null bytes (`\0`),
 * because it is used verbatim as a filename by `worker/src/parity-run.ts` and
 * may later key Appwrite documents. A name containing any of these is rejected
 * with a {@link ValidationError}. This is the pinned behavior (REJECT, not
 * sanitize-to-basename) so misconfigured inputs surface loudly rather than
 * silently writing to an unexpected path.
 */
export function createNewsletterConfig(input: NewsletterConfigInput): NewsletterConfig {
  if (!Array.isArray(input.topics) || input.topics.length === 0) {
    throw new ValidationError("createNewsletterConfig: topics must be a non-empty array");
  }
  if (!Array.isArray(input.feeds) || input.feeds.length === 0) {
    throw new ValidationError("createNewsletterConfig: feeds must be a non-empty array");
  }
  if (typeof input.name !== "string" || containsUnsafeNameChars(input.name)) {
    throw new ValidationError(
      "createNewsletterConfig: name must be a non-empty string without path separators ('/', '\\'), traversal sequences ('..'), or null bytes",
    );
  }

  return {
    name: input.name,
    topics: input.topics,
    dislikedTopics: input.dislikedTopics ?? [],
    audience: input.audience ?? "",
    newsItems: input.newsItems ?? 16,
    feeds: input.feeds,
    dateRange: input.dateRange ?? "yesterday",
    interPhaseDelaySeconds: input.interPhaseDelaySeconds ?? 3,
  };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Narrows `unknown` to {@link TaggedArticle}. Validates the full `Article`
 * shape plus a `tags: string[]` field. Rejects non-objects, arrays, null, and
 * non-string-array `tags`.
 */
export function isTaggedArticle(value: unknown): value is TaggedArticle {
  if (!isPlainObject(value)) return false;
  if (!isString(value.title)) return false;
  if (!isString(value.link)) return false;
  if (!isDate(value.published)) return false;
  if (!isString(value.content)) return false;
  if (!isString(value.source)) return false;
  if (!Array.isArray(value.tags)) return false;
  if (!value.tags.every((t) => typeof t === "string")) return false;
  return true;
}

/**
 * Narrows `unknown` to {@link ScoredArticle}. Requires the value to be a
 * {@link TaggedArticle} with a finite numeric `score` (NaN rejected).
 */
export function isScoredArticle(value: unknown): value is ScoredArticle {
  if (!isTaggedArticle(value)) return false;
  const score = (value as unknown as Record<string, unknown>).score;
  if (typeof score !== "number") return false;
  if (!Number.isFinite(score)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Rejects a newsletter `name` that could escape the output directory when used
 * as a filename (parity-run) or as a document key (Appwrite). True = unsafe.
 * Catches: empty, path separators (`/`, `\`), traversal (`..`), null bytes.
 */
function containsUnsafeNameChars(name: string): boolean {
  if (name.length === 0) return true;
  if (name.includes("/") || name.includes("\\")) return true;
  if (name.includes("..")) return true;
  if (name.includes("\0")) return true;
  return false;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return true;
}
