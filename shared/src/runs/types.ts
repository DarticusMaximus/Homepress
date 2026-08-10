import type {
  EmailDeliveryStatus,
  RssDeliveryStatus,
  RunPhase,
  RunStatus,
  RunTrigger,
} from "../schema/declarations";
import type { FeedFailure, SelectionFailure } from "../pipeline/types";

export type { EmailDeliveryStatus, RssDeliveryStatus, RunTrigger };

export type RunRepositoryErrorCode = "validation" | "not_found" | "appwrite" | "checkpoint_missing";

export class RunRepositoryError extends Error {
  readonly code: RunRepositoryErrorCode;

  constructor(code: RunRepositoryErrorCode, message: string) {
    super(message);
    this.name = "RunRepositoryError";
    this.code = code;
  }
}

/** In-memory run record. Optional fields default to "" / null per Appwrite rules. */
export interface Run {
  $id: string;
  newsletterId: string;
  newsletterName: string;
  status: RunStatus;
  /** Always coerced on read — missing/null/empty/unknown → `"manual"`. */
  trigger: RunTrigger;
  currentPhase: string;
  completedPhase: string;
  failedPhase: string;
  failureMessage: string;
  startedAt: string;
  endedAt: string | null;
  topicSummary: string;
  failedFeeds: string;
  suppressSummary: string;
  checkpointFetchId: string;
  checkpointScrapeId: string;
  checkpointTagId: string;
  checkpointScoreId: string;
  checkpointSelectionId: string;
  checkpointDraftId: string;
  /** Always coerced on read — missing/unknown → `"none"`. */
  emailDeliveryStatus: EmailDeliveryStatus;
  emailDeliveryAt: string | null;
  /** Always coerced on read — missing → `""`. */
  emailDeliveryError: string;
  /** Always coerced on read — missing/unknown → `"none"`. */
  rssDeliveryStatus: RssDeliveryStatus;
  rssDeliveryAt: string | null;
  /** Always coerced on read — missing → `""`. */
  rssDeliveryError: string;
}

// ---------------------------------------------------------------------------
// Checkpoint JSON wire types (on-disk / Storage shape)
// ---------------------------------------------------------------------------

/** On-disk / Storage JSON shape. `published` is ISO-8601. */
export type ArticleJson = {
  title: string;
  link: string;
  published: string;
  content: string;
  source: string;
};

export type TaggedArticleJson = ArticleJson & { tags: string[] };

/** Score checkpoint: never persist `embedding`. */
export type ScoredArticleJson = TaggedArticleJson & { score: number };

/** Selection checkpoint: same fields as scored; never persist `embedding`. */
export type SelectedArticleJson = ScoredArticleJson;

/**
 * Wire shape for selection drops persisted on the selection checkpoint.
 * Same fields as {@link SelectionFailure}; never includes embeddings.
 */
export type SelectionFailureJson = SelectionFailure;

/**
 * Per-article failure sample on a tag/score halt checkpoint.
 * `error` is redacted + bounded before persist; `reason` is score-only.
 */
export type PhaseArticleFailureJson = {
  articleTitle: string;
  articleLink: string;
  error: string;
  attempts: number;
  /** Score failures only; omit for tag. */
  reason?: "exception" | "parse";
};

/**
 * Halt summary persisted as optional `phaseFailure` on tag/score checkpoints.
 * Legacy / successful writes omit the key entirely.
 */
export type PhaseFailureSummaryJson = {
  halted: true;
  haltReason: string | null;
  consecutiveErrors: number;
  totalArticles: number;
  /** Full count from TagResult/ScoreResult.failures.length (not sample length). */
  failureCount: number;
  /** First 10 per-article failures only. */
  failures: PhaseArticleFailureJson[];
};

export type ScrapeSummaryJson = {
  total: number;
  extracted: number;
  fallback: number;
};

export type DraftCheckpointPayload = {
  markdown: string;
  empty: boolean;
  reason: "no-articles" | "empty-after-retry" | null;
  articleCount: number;
  attempts: number;
};

// ---------------------------------------------------------------------------
// Input types for savePhaseCheckpoint
// ---------------------------------------------------------------------------

export type FetchCheckpointInput = { articles: ArticleJson[] };
export type ScrapeCheckpointInput = {
  articles: ArticleJson[];
  summary: ScrapeSummaryJson;
};
export type TagCheckpointInput = {
  taggedArticles: TaggedArticleJson[];
  /** Present only on tag halt writes; omit for success / legacy. */
  phaseFailure?: PhaseFailureSummaryJson;
};
export type ScoreCheckpointInput = {
  scoredArticles: ScoredArticleJson[];
  /** Present only on score halt writes; omit for success / legacy. */
  phaseFailure?: PhaseFailureSummaryJson;
};
export type SelectionCheckpointInput = {
  selectedArticles: SelectedArticleJson[];
  /** Always passed on write (may be `[]`). Serialize always emits the key. */
  failures: SelectionFailureJson[];
};

export type PhaseCheckpointInput =
  | FetchCheckpointInput
  | ScrapeCheckpointInput
  | TagCheckpointInput
  | ScoreCheckpointInput
  | SelectionCheckpointInput
  | DraftCheckpointPayload;

// ---------------------------------------------------------------------------
// Checkpoint output types (what loadPhaseCheckpoint returns after reviving Dates)
// ---------------------------------------------------------------------------

export type CheckpointArticle = Omit<ArticleJson, "published"> & {
  published: Date;
};
export type CheckpointTaggedArticle = CheckpointArticle & { tags: string[] };
export type CheckpointScoredArticle = CheckpointTaggedArticle & {
  score: number;
};
export type CheckpointSelectedArticle = CheckpointScoredArticle;

export type FetchCheckpoint = { articles: CheckpointArticle[] };
export type ScrapeCheckpoint = {
  articles: CheckpointArticle[];
  summary: ScrapeSummaryJson;
};
/**
 * Revived tag checkpoint.
 * - `phaseFailure` present → tag halt was recorded for this run.
 * - `phaseFailure` absent/`undefined` → success or legacy pre-feature checkpoint.
 */
export type TagCheckpoint = {
  taggedArticles: CheckpointTaggedArticle[];
  phaseFailure?: PhaseFailureSummaryJson;
};
/**
 * Revived score checkpoint.
 * - `phaseFailure` present → score halt was recorded for this run.
 * - `phaseFailure` absent/`undefined` → success or legacy pre-feature checkpoint.
 */
export type ScoreCheckpoint = {
  scoredArticles: CheckpointScoredArticle[];
  phaseFailure?: PhaseFailureSummaryJson;
};
/**
 * Revived selection checkpoint.
 * - `failures` present (including `[]`) → drops were recorded for this run.
 * - `failures` absent/`undefined` → legacy pre-feature checkpoint (drops unrecorded).
 */
export type SelectionCheckpoint = {
  selectedArticles: CheckpointSelectedArticle[];
  failures?: SelectionFailureJson[];
};

// ---------------------------------------------------------------------------
// Input types for lifecycle functions
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  newsletterId: string;
  newsletterName: string;
  /** Defaults to `"manual"` when omitted. */
  trigger?: RunTrigger;
}

export interface MarkFailedInput {
  failedPhase: RunPhase;
  failureMessage: string;
  completedPhase?: string;
  failedFeeds?: FeedFailure[];
}

export interface MarkCompletedInput {
  topicSummary: { title: string; tags: string[] }[];
}

export interface SaveCheckpointOptions {
  failedFeeds?: unknown[];
}
