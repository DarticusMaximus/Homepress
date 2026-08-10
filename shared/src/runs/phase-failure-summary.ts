/**
 * Builders for tag/score halt `phaseFailure` checkpoints and enriched
 * `failureMessage` strings (halt, empty selection, full suppress).
 *
 * Keeps execute-run thin: format here, persist/wire there.
 */

import type { SuppressSummary } from "../pipeline/cross-run-suppress";
import type {
  ScoreFailure,
  ScoreResult,
  SelectionFailure,
  TagFailure,
  TagResult,
} from "../pipeline/types";
import { redactMessageForStorage } from "../util/log-redact";
import type { PhaseArticleFailureJson, PhaseFailureSummaryJson } from "./types";

/** First N per-article failures persisted on a halt checkpoint. */
export const PHASE_FAILURE_SAMPLE_MAX = 10;

/** First N snippets embedded in `failureMessage` / stdout samples. */
export const FAILURE_MESSAGE_SAMPLE_MAX = 3;

/** Matches `markFailed` / execute-run `FAILURE_MESSAGE_MAX`. */
export const FAILURE_MESSAGE_MAX = 2000;

/** Per-error bound — same idea as selection-failure `error` persistence. */
export const PHASE_FAILURE_ERROR_MAX = 2000;

type PhaseFailureSource = Pick<
  TagResult | ScoreResult,
  "haltReason" | "consecutiveErrors" | "totalArticles" | "failures"
>;

function toPhaseArticleFailure(
  failure: TagFailure | ScoreFailure,
): PhaseArticleFailureJson {
  const out: PhaseArticleFailureJson = {
    articleTitle: failure.articleTitle,
    articleLink: failure.articleLink,
    error: redactMessageForStorage(failure.error, PHASE_FAILURE_ERROR_MAX),
    attempts: failure.attempts,
  };
  if ("reason" in failure && (failure.reason === "exception" || failure.reason === "parse")) {
    out.reason = failure.reason;
  }
  return out;
}

/**
 * Build a halt `phaseFailure` wire payload from a tag or score result.
 * Caps `failures` at {@link PHASE_FAILURE_SAMPLE_MAX}; `failureCount` is the
 * full `failures.length`. Non-null `haltReason` is redacted + bounded before
 * persist / Inspect / stdout (same bound as per-article errors).
 */
export function buildPhaseFailureSummary(result: PhaseFailureSource): PhaseFailureSummaryJson {
  return {
    halted: true,
    haltReason:
      result.haltReason != null
        ? redactMessageForStorage(result.haltReason, PHASE_FAILURE_ERROR_MAX)
        : null,
    consecutiveErrors: result.consecutiveErrors,
    totalArticles: result.totalArticles,
    failureCount: result.failures.length,
    failures: result.failures.slice(0, PHASE_FAILURE_SAMPLE_MAX).map(toPhaseArticleFailure),
  };
}

function phaseLabel(phase: "tag" | "score"): string {
  return phase === "tag" ? "Tagging halted" : "Scoring halted";
}

function formatSampleSnippet(title: string, detail: string): string {
  const safeTitle = title.replace(/"/g, "'");
  const safeDetail = detail.replace(/"/g, "'");
  return `"${safeTitle}": ${safeDetail}`;
}

/**
 * Enriched halt `failureMessage` from a {@link PhaseFailureSummaryJson}.
 * Includes phase label, optional haltReason, consecutiveErrors, failureCount,
 * and up to {@link FAILURE_MESSAGE_SAMPLE_MAX} title+error samples. Redacted
 * and capped at {@link FAILURE_MESSAGE_MAX}.
 */
export function buildHaltFailureMessage(
  phase: "tag" | "score",
  summary: PhaseFailureSummaryJson,
): string {
  const parts: string[] = [];
  if (summary.haltReason != null && summary.haltReason.length > 0) {
    parts.push(`${phaseLabel(phase)}: ${summary.haltReason}`);
  } else {
    parts.push(phaseLabel(phase));
  }
  parts.push(`Consecutive errors: ${summary.consecutiveErrors}`);
  parts.push(`Failures: ${summary.failureCount}/${summary.totalArticles}`);

  const samples = summary.failures.slice(0, FAILURE_MESSAGE_SAMPLE_MAX);
  if (samples.length > 0) {
    const snippets = samples.map((f) => formatSampleSnippet(f.articleTitle, f.error));
    parts.push(`Sample: ${snippets.join("; ")}`);
  }

  return redactMessageForStorage(parts.join(". "), FAILURE_MESSAGE_MAX);
}

/**
 * Replace bare `"No articles selected"` for an MMR-empty selection with drop
 * count and up to {@link FAILURE_MESSAGE_SAMPLE_MAX} title+reason samples.
 */
export function buildEmptySelectionFailureMessage(failures: SelectionFailure[]): string {
  const parts = [`No articles selected. Drops: ${failures.length}`];
  const samples = failures.slice(0, FAILURE_MESSAGE_SAMPLE_MAX);
  if (samples.length > 0) {
    const snippets = samples.map((f) => {
      const safeTitle = f.articleTitle.replace(/"/g, "'");
      return `"${safeTitle}" (${f.reason})`;
    });
    parts.push(`Sample: ${snippets.join("; ")}`);
  }
  return redactMessageForStorage(parts.join(". "), FAILURE_MESSAGE_MAX);
}

/**
 * Replace bare `"No articles selected"` for a full cross-run suppress with
 * suppress count and up to {@link FAILURE_MESSAGE_SAMPLE_MAX} titles.
 */
export function buildFullSuppressFailureMessage(summary: SuppressSummary): string {
  const parts = [`No articles selected. Suppressed: ${summary.count}`];
  const samples = summary.items.slice(0, FAILURE_MESSAGE_SAMPLE_MAX);
  if (samples.length > 0) {
    const snippets = samples.map((item) => {
      const safeTitle = item.title.replace(/"/g, "'");
      return `"${safeTitle}"`;
    });
    parts.push(`Sample: ${snippets.join("; ")}`);
  }
  return redactMessageForStorage(parts.join(". "), FAILURE_MESSAGE_MAX);
}
