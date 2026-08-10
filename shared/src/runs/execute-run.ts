import type { Client } from "node-appwrite";

import { fetchFeeds } from "../pipeline/rss-fetcher";
import { scrapeAll } from "../pipeline/scraper";
import { tagArticles } from "../pipeline/tagger";
import { scoreArticles } from "../pipeline/scorer";
import { selectDiverse } from "../pipeline/mmr-selection";
import { suppressCrossRunTopics } from "../pipeline/cross-run-suppress";
import { NewsletterDrafter } from "../pipeline/drafter";
import { getCrossRunSimilarityThreshold } from "../pipeline/config";
import type { PipelineOptions } from "../pipeline/orchestrator";
import type {
  Article,
  TaggedArticle,
  ScoredArticle,
  SelectedArticle,
  SelectionFailure,
} from "../pipeline/types";
import type { RunPhase } from "../schema/declarations";
import type {
  ArticleJson,
  TaggedArticleJson,
  ScoredArticleJson,
  ScrapeSummaryJson,
  FetchCheckpoint,
  ScrapeCheckpoint,
  TagCheckpoint,
  ScoreCheckpoint,
  SelectionCheckpoint,
  SelectionFailureJson,
} from "./types";
import { RunRepositoryError } from "./types";
import {
  getRun,
  markRunning,
  markFailed,
  markCompleted,
  savePhaseCheckpoint,
  loadPhaseCheckpoint,
  saveSuppressSummary,
} from "./repository";
import { loadLookbackTopics } from "./lookback-topics";
import { PHASE_ORDER, resumeStartPhase } from "./phases";
import {
  buildEmptySelectionFailureMessage,
  buildFullSuppressFailureMessage,
  buildHaltFailureMessage,
  buildPhaseFailureSummary,
  FAILURE_MESSAGE_SAMPLE_MAX,
} from "./phase-failure-summary";
import { buildPipelineConfigForNewsletter } from "./start";
import { loadRunLlmResolution } from "./resolve-run-llm";
import { applyFeedFetchOutcomes } from "../feeds/health";
import { autoDeliverAfterSuccess } from "../delivery/auto-deliver";
import { sanitizeAppwriteMessageForLog, redactMessageForStorage } from "../util/log-redact";

const LLM_RESOLUTION_FAILURE_MESSAGE =
  "Could not load prompt templates or model settings";

const FAILURE_MESSAGE_MAX = 2000;
/** Bound for selection-failure `error` fields persisted on checkpoints. */
const SELECTION_FAILURE_ERROR_MAX = 2000;

export type ExecuteRunOptions = PipelineOptions & {
  suppress?: typeof suppressCrossRunTopics;
  /** Override auto-deliver after successful markCompleted (default: real orchestrator). */
  autoDeliver?: typeof autoDeliverAfterSuccess;
};

function toArticleJson(a: Article): ArticleJson {
  return {
    title: a.title,
    link: a.link,
    published: a.published.toISOString(),
    content: a.content,
    source: a.source,
  };
}

function toTaggedArticleJson(a: TaggedArticle): TaggedArticleJson {
  return { ...toArticleJson(a), tags: a.tags };
}

function toScoredArticleJson(a: ScoredArticle): ScoredArticleJson {
  return { ...toTaggedArticleJson(a), score: a.score };
}

/**
 * Map selection failures to the checkpoint wire shape with a bounded, redacted
 * `error` field. Preserves title/link/reason; never writes raw provider text.
 */
function toSelectionFailureJson(failure: SelectionFailure): SelectionFailureJson {
  const out: SelectionFailureJson = {
    articleTitle: failure.articleTitle,
    articleLink: failure.articleLink,
    reason: failure.reason,
  };
  if (typeof failure.error === "string" && failure.error.length > 0) {
    const error = redactMessageForStorage(failure.error, SELECTION_FAILURE_ERROR_MAX);
    if (error.length > 0) {
      out.error = error;
    }
  }
  return out;
}

function sanitizeSelectionFailures(failures: SelectionFailure[]): SelectionFailureJson[] {
  return failures.map(toSelectionFailureJson);
}

/**
 * Execute a newsletter generation run — fresh start or resume from checkpoint.
 *
 * Loads the run, re-builds the pipeline config at claim time (so edits after
 * enqueue are honored), then drives each phase in order
 * (fetch → scrape → tag → score → selection → draft) with:
 *
 * - `markRunning` before each phase.
 * - `savePhaseCheckpoint` after each successful phase (durable JSON in Storage).
 * - `markFailed` on any fatal phase outcome (zero articles, tag/score halt,
 *   zero selected, empty draft) or unexpected thrown error.
 * - `markCompleted` with a `topicSummary` after the draft checkpoint.
 *
 * **Fresh start** (`completedPhase` empty): all six phases run.
 * **Resume** (`completedPhase` set): phases before `resumeStartPhase` are
 * skipped — their outputs are hydrated from durable checkpoints, so prior
 * website fetches and LLM work are never repeated.
 *
 * The run must be `pending`. Phase functions are injectable via
 * {@link PipelineOptions} (same defaults as `runPipeline`). Unexpected thrown
 * errors are marked failed with the current phase and rethrown so the worker
 * can log without crashing.
 */
export async function executeRun(
  client: Client,
  runId: string,
  options?: ExecuteRunOptions,
): Promise<void> {
  const { fetcher = fetchFeeds, scraper = scrapeAll } = options ?? {};

  const run = await getRun(client, runId);
  if (run.status !== "pending") {
    throw new RunRepositoryError(
      "validation",
      `Run ${runId} is not pending (current status: ${run.status})`,
    );
  }

  const startPhase = resumeStartPhase(run.completedPhase as RunPhase | "");

  if (startPhase === null) {
    await markFailed(client, runId, {
      failedPhase: "draft",
      failureMessage: "This run cannot be resumed; start a new run instead",
    });
    return;
  }

  let currentPhase: RunPhase = startPhase;

  try {
    const buildResult = await buildPipelineConfigForNewsletter(
      client,
      run.newsletterId,
      startPhase === "fetch" ? undefined : { requireOkFeeds: false },
    );
    if (!buildResult.ok) {
      await markFailed(client, runId, {
        failedPhase: startPhase,
        failureMessage: buildResult.error,
      });
      return;
    }
    const { config, newsletter } = buildResult;

    // Claim-time freeze: load prompts + resolve models once; inject into defaults.
    let resolution;
    try {
      resolution = await loadRunLlmResolution(client, newsletter);
    } catch (loadErr) {
      const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      console.error({
        phase: "llm-resolution",
        runId,
        message: sanitizeAppwriteMessageForLog(errMsg),
      });
      await markFailed(client, runId, {
        failedPhase: startPhase,
        failureMessage: LLM_RESOLUTION_FAILURE_MESSAGE,
      });
      return;
    }

    console.log({
      action: "llm-resolution",
      runId,
      models: {
        tagger: resolution.models.tagger,
        scorer: resolution.models.scorer,
        drafter: resolution.models.drafter,
        embedder: resolution.models.embedder,
      },
      promptLengths: {
        tagger: resolution.prompts.tagger.length,
        scorer: resolution.prompts.scorer.length,
        drafter: resolution.prompts.drafter.length,
      },
    });

    const tagger =
      options?.tagger ??
      ((articles) =>
        tagArticles(articles, {
          model: resolution.models.tagger,
          promptTemplate: resolution.prompts.tagger,
        }));
    const scorer =
      options?.scorer ??
      ((articles, topics, dislikedTopics) =>
        scoreArticles(articles, topics, dislikedTopics, {
          model: resolution.models.scorer,
          promptTemplate: resolution.prompts.scorer,
        }));
    const selector =
      options?.selector ??
      ((articles, target) =>
        selectDiverse(articles, target, {
          model: resolution.models.embedder,
        }));
    const drafter =
      options?.drafter ??
      new NewsletterDrafter({
        model: resolution.models.drafter,
        promptTemplate: resolution.prompts.drafter,
      });
    const suppress =
      options?.suppress ??
      ((candidates, lookbackTopics, suppressOptions) =>
        suppressCrossRunTopics(candidates, lookbackTopics, {
          ...suppressOptions,
          model: resolution.models.embedder,
        }));

    let fetchedArticles: Article[] = [];
    let scrapedArticles: Article[] = [];
    let taggedArticles: TaggedArticle[] = [];
    let scoredArticles: ScoredArticle[] = [];
    let selectedArticles: SelectedArticle[] = [];

    if (run.completedPhase) {
      try {
        const checkpoint = await loadPhaseCheckpoint(client, runId, run.completedPhase as RunPhase);
        if (startPhase === "scrape") {
          fetchedArticles = (checkpoint as FetchCheckpoint).articles;
        } else if (startPhase === "tag") {
          scrapedArticles = (checkpoint as ScrapeCheckpoint).articles;
        } else if (startPhase === "score") {
          taggedArticles = (checkpoint as TagCheckpoint).taggedArticles;
        } else if (startPhase === "selection") {
          scoredArticles = (checkpoint as ScoreCheckpoint).scoredArticles;
        } else if (startPhase === "draft") {
          selectedArticles = (checkpoint as SelectionCheckpoint).selectedArticles;
        }
        console.log({
          action: "resume-hydrate",
          runId,
          completedPhase: run.completedPhase,
          startPhase,
        });
      } catch (checkpointErr) {
        const isCheckpointMissing =
          checkpointErr instanceof RunRepositoryError &&
          checkpointErr.code === "checkpoint_missing";
        const errMsg =
          checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr);
        console.error({
          phase: `resume-checkpoint-${run.completedPhase}`,
          runId,
          code: isCheckpointMissing ? "checkpoint_missing" : "appwrite",
          message: sanitizeAppwriteMessageForLog(errMsg),
        });
        await markFailed(client, runId, {
          failedPhase: startPhase,
          failureMessage: isCheckpointMissing
            ? "Cannot retry: checkpoint data is missing. Start a new run instead."
            : "Could not load checkpoint due to a database error. Try again.",
        });
        return;
      }
    }

    const startIdx = PHASE_ORDER.indexOf(startPhase);

    if (startIdx <= 0) {
      currentPhase = "fetch";
      console.log({ action: "phase-start", runId, phase: "fetch" });
      await markRunning(client, runId, "fetch");
      const fetchResult = await fetcher(config.feeds, {
        dateRange: config.dateRange,
      });
      try {
        await applyFeedFetchOutcomes(client, {
          attemptedFeedUrls: config.feeds,
          failedFeeds: fetchResult.failedFeeds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error({
          phase: "feed-health-update",
          message: sanitizeAppwriteMessageForLog(message),
        });
      }
      if (fetchResult.articles.length === 0) {
        console.log({
          action: "fatal-outcome",
          runId,
          phase: "fetch",
          reason: "No articles fetched",
        });
        await markFailed(client, runId, {
          failedPhase: "fetch",
          failureMessage: "No articles fetched",
          failedFeeds: fetchResult.failedFeeds,
        });
        return;
      }
      await savePhaseCheckpoint(
        client,
        runId,
        "fetch",
        { articles: fetchResult.articles.map(toArticleJson) },
        { failedFeeds: fetchResult.failedFeeds },
      );
      console.log({
        action: "checkpoint-saved",
        runId,
        phase: "fetch",
        articleCount: fetchResult.articles.length,
      });
      fetchedArticles = fetchResult.articles;
    }

    if (startIdx <= 1) {
      currentPhase = "scrape";
      console.log({ action: "phase-start", runId, phase: "scrape" });
      await markRunning(client, runId, "scrape");
      const scrapeResults = await scraper(
        fetchedArticles.map((a) => ({
          url: a.link,
          fallbackContent: a.content,
        })),
      );
      scrapedArticles = fetchedArticles.map((a, i) => ({
        ...a,
        content: scrapeResults[i].content,
      }));
      const scrapeSummary: ScrapeSummaryJson = {
        total: scrapeResults.length,
        extracted: scrapeResults.filter((s) => s.source === "extracted").length,
        fallback: scrapeResults.filter((s) => s.source === "fallback").length,
      };
      await savePhaseCheckpoint(client, runId, "scrape", {
        articles: scrapedArticles.map(toArticleJson),
        summary: scrapeSummary,
      });
      console.log({
        action: "checkpoint-saved",
        runId,
        phase: "scrape",
        articleCount: scrapedArticles.length,
      });
    }

    if (startIdx <= 2) {
      currentPhase = "tag";
      console.log({ action: "phase-start", runId, phase: "tag" });
      await markRunning(client, runId, "tag");
      const tagResult = await tagger(scrapedArticles);
      if (tagResult.halted) {
        // Persist successes + phaseFailure so Inspect can explain the halt.
        // completedPhase: "scrape" so Retry re-enters tag (not score).
        // Checkpoint save advances completedPhase to "tag"; markFailed must
        // override back to "scrape". Retry the status update locally so a
        // transient rejection cannot fall through to the outer catch.
        const phaseFailure = buildPhaseFailureSummary(tagResult);
        const failureMessage = buildHaltFailureMessage("tag", phaseFailure);
        try {
          await savePhaseCheckpoint(client, runId, "tag", {
            taggedArticles: tagResult.taggedArticles
              .filter((a) => a.tags.length > 0)
              .map(toTaggedArticleJson),
            phaseFailure,
          });
        } catch (checkpointErr) {
          const cpe =
            checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr);
          console.error({
            phase: "save-checkpoint-tag-halt",
            runId,
            message: sanitizeAppwriteMessageForLog(cpe),
          });
        }
        console.log({
          action: "fatal-outcome",
          runId,
          phase: "tag",
          reason: failureMessage,
          haltReason: phaseFailure.haltReason,
          consecutiveErrors: phaseFailure.consecutiveErrors,
          failureCount: phaseFailure.failureCount,
          sample: phaseFailure.failures.slice(0, FAILURE_MESSAGE_SAMPLE_MAX),
        });
        const tagHaltFailure = {
          failedPhase: "tag" as const,
          failureMessage,
          completedPhase: "scrape" as const,
        };
        try {
          await markFailed(client, runId, tagHaltFailure);
        } catch (markFailedErr) {
          const mfe =
            markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr);
          console.error({
            phase: "mark-failed-tag-halt-retry",
            runId,
            message: sanitizeAppwriteMessageForLog(mfe),
          });
          await markFailed(client, runId, tagHaltFailure);
        }
        return;
      }
      taggedArticles = tagResult.taggedArticles;
      await savePhaseCheckpoint(client, runId, "tag", {
        taggedArticles: tagResult.taggedArticles.map(toTaggedArticleJson),
      });
      console.log({
        action: "checkpoint-saved",
        runId,
        phase: "tag",
        articleCount: taggedArticles.length,
      });
    }

    if (startIdx <= 3) {
      currentPhase = "score";
      console.log({ action: "phase-start", runId, phase: "score" });
      await markRunning(client, runId, "score");
      const scoreResult = await scorer(taggedArticles, config.topics, config.dislikedTopics);
      if (scoreResult.halted) {
        // Persist successes + phaseFailure so Inspect can explain the halt.
        // completedPhase: "tag" so Retry re-enters score (not selection).
        // Checkpoint save advances completedPhase to "score"; markFailed must
        // override back to "tag". Retry the status update locally so a
        // transient rejection cannot fall through to the outer catch.
        const phaseFailure = buildPhaseFailureSummary(scoreResult);
        const failureMessage = buildHaltFailureMessage("score", phaseFailure);
        try {
          await savePhaseCheckpoint(client, runId, "score", {
            scoredArticles: scoreResult.scoredArticles.map(toScoredArticleJson),
            phaseFailure,
          });
        } catch (checkpointErr) {
          const cpe =
            checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr);
          console.error({
            phase: "save-checkpoint-score-halt",
            runId,
            message: sanitizeAppwriteMessageForLog(cpe),
          });
        }
        console.log({
          action: "fatal-outcome",
          runId,
          phase: "score",
          reason: failureMessage,
          haltReason: phaseFailure.haltReason,
          consecutiveErrors: phaseFailure.consecutiveErrors,
          failureCount: phaseFailure.failureCount,
          sample: phaseFailure.failures.slice(0, FAILURE_MESSAGE_SAMPLE_MAX),
        });
        const scoreHaltFailure = {
          failedPhase: "score" as const,
          failureMessage,
          completedPhase: "tag" as const,
        };
        try {
          await markFailed(client, runId, scoreHaltFailure);
        } catch (markFailedErr) {
          const mfe =
            markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr);
          console.error({
            phase: "mark-failed-score-halt-retry",
            runId,
            message: sanitizeAppwriteMessageForLog(mfe),
          });
          await markFailed(client, runId, scoreHaltFailure);
        }
        return;
      }
      scoredArticles = scoreResult.scoredArticles;
      await savePhaseCheckpoint(client, runId, "score", {
        scoredArticles: scoreResult.scoredArticles.map(toScoredArticleJson),
      });
      console.log({
        action: "checkpoint-saved",
        runId,
        phase: "score",
        articleCount: scoredArticles.length,
      });
    }

    if (startIdx <= 4) {
      currentPhase = "selection";
      console.log({ action: "phase-start", runId, phase: "selection" });
      await markRunning(client, runId, "selection");
      const lookback = await loadLookbackTopics(client, {
        newsletterId: run.newsletterId,
        lookback: newsletter.lookback,
      });
      const suppressResult = await suppress(scoredArticles, lookback.topics, {
        threshold: getCrossRunSimilarityThreshold(),
      });
      await saveSuppressSummary(client, runId, suppressResult.summary);
      if (suppressResult.remaining.length === 0 && suppressResult.summary.count > 0) {
        const failureMessage = buildFullSuppressFailureMessage(suppressResult.summary);
        console.log({
          action: "fatal-outcome",
          runId,
          phase: "selection",
          reason: failureMessage,
          suppressCount: suppressResult.summary.count,
          sample: suppressResult.summary.items
            .slice(0, FAILURE_MESSAGE_SAMPLE_MAX)
            .map((item) => item.title),
        });
        await markFailed(client, runId, {
          failedPhase: "selection",
          failureMessage,
        });
        return;
      }
      const selectionResult = await selector(suppressResult.remaining, config.newsItems);
      if (selectionResult.selectedArticles.length === 0) {
        // Persist empty selection + failures so Inspect can explain the drop before fail.
        // completedPhase: "score" so Retry re-enters selection (not draft).
        // Checkpoint save advances completedPhase to "selection"; markFailed must
        // override back to "score". Retry the status update locally so a transient
        // rejection cannot fall through to the outer catch (which omits the override).
        const failureMessage = buildEmptySelectionFailureMessage(selectionResult.failures);
        await savePhaseCheckpoint(client, runId, "selection", {
          selectedArticles: [],
          failures: sanitizeSelectionFailures(selectionResult.failures),
        });
        console.log({
          action: "fatal-outcome",
          runId,
          phase: "selection",
          reason: failureMessage,
          dropCount: selectionResult.failures.length,
          sample: selectionResult.failures
            .slice(0, FAILURE_MESSAGE_SAMPLE_MAX)
            .map((f) => ({ articleTitle: f.articleTitle, reason: f.reason })),
        });
        const emptySelectionFailure = {
          failedPhase: "selection" as const,
          failureMessage,
          completedPhase: "score" as const,
        };
        try {
          await markFailed(client, runId, emptySelectionFailure);
        } catch (markFailedErr) {
          const mfe =
            markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr);
          console.error({
            phase: "mark-failed-empty-selection-retry",
            runId,
            message: sanitizeAppwriteMessageForLog(mfe),
          });
          await markFailed(client, runId, emptySelectionFailure);
        }
        return;
      }
      selectedArticles = selectionResult.selectedArticles;
      await savePhaseCheckpoint(client, runId, "selection", {
        selectedArticles: selectionResult.selectedArticles.map(toScoredArticleJson),
        failures: sanitizeSelectionFailures(selectionResult.failures),
      });
      console.log({
        action: "checkpoint-saved",
        runId,
        phase: "selection",
        articleCount: selectedArticles.length,
      });
    }

    currentPhase = "draft";
    console.log({ action: "phase-start", runId, phase: "draft" });
    await markRunning(client, runId, "draft");
    const draftResult = await drafter.draft(
      selectedArticles,
      config.name,
      config.topics,
      selectedArticles.length,
      config.audience,
    );
    if (draftResult.empty) {
      console.log({
        action: "fatal-outcome",
        runId,
        phase: "draft",
        reason: draftResult.reason ?? "Empty draft",
      });
      await markFailed(client, runId, {
        failedPhase: "draft",
        failureMessage: draftResult.reason ?? "Empty draft",
      });
      return;
    }
    await savePhaseCheckpoint(client, runId, "draft", {
      markdown: draftResult.markdown,
      empty: draftResult.empty,
      reason: draftResult.reason,
      articleCount: draftResult.articleCount,
      attempts: draftResult.attempts,
    });
    console.log({
      action: "checkpoint-saved",
      runId,
      phase: "draft",
      articleCount: draftResult.articleCount,
    });

    try {
      await markCompleted(client, runId, {
        topicSummary: selectedArticles.map((a) => ({
          title: a.title,
          tags: a.tags,
        })),
      });
    } catch (completionErr) {
      const completionMessage =
        completionErr instanceof Error ? completionErr.message : String(completionErr);
      console.error({
        phase: "mark-completed-retry",
        runId,
        message: sanitizeAppwriteMessageForLog(completionMessage),
      });
      try {
        await markCompleted(client, runId, {
          topicSummary: selectedArticles.map((a) => ({
            title: a.title,
            tags: a.tags,
          })),
        });
      } catch (retryErr) {
        // markCompleted failed twice after the draft checkpoint saved
        // (completedPhase: "draft"). Marking failedPhase: "draft" would make
        // the run non-resumable (resumeStartPhase("draft") → null). Instead,
        // reset completedPhase to "selection" and set failedPhase: "selection"
        // so the run remains resumable from draft.
        const reMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error({
          phase: "mark-completed-failed",
          runId,
          message: sanitizeAppwriteMessageForLog(reMsg),
        });
        await markFailed(client, runId, {
          failedPhase: "selection",
          failureMessage: "Draft completed but could not finalize run; retry from draft",
          completedPhase: "selection",
        });
        return;
      }
    }
    console.log({
      action: "run-completed",
      runId,
      selectedCount: selectedArticles.length,
    });

    // Honor newsletter auto-email / auto-RSS toggles. Delivery must never fail the run.
    const deliver = options?.autoDeliver ?? autoDeliverAfterSuccess;
    try {
      await deliver(client, runId);
    } catch (deliveryErr) {
      // Must not happen if orchestrator contract holds — log and continue.
      const deliveryMessage =
        deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr);
      console.error({
        phase: "auto-deliver",
        runId,
        message: sanitizeAppwriteMessageForLog(deliveryMessage),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error during execution";
    try {
      await markFailed(client, runId, {
        failedPhase: currentPhase,
        failureMessage: redactMessageForStorage(message, FAILURE_MESSAGE_MAX),
      });
    } catch (markFailedErr) {
      // If markFailed itself fails, the run stays 'running' and blocks all
      // future Generate/Retry for this newsletter. A stale-run sweep is a
      // future improvement. Log so operators can diagnose the orphan.
      const mfe = markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr);
      console.error({
        phase: `mark-failed-fallback-${currentPhase}`,
        runId,
        failedPhase: currentPhase,
        message: sanitizeAppwriteMessageForLog(mfe),
      });
    }
    throw err;
  }
}
