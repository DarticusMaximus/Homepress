/**
 * Scorer phase: LLM-driven 0–10 relevance scoring with retry + consecutive-
 * error halt.
 *
 * Ports the legacy Python `scorer.py` faithfully: the byte-identical prompt
 * template, the numeric parse + clamp to [0, 10], the per-article retry via
 * the shared `withRetry` helper for LLM-call exceptions (parse failures do NOT
 * retry), and the consecutive-error-threshold halt. Unlike the tag phase,
 * failed articles are NOT retained in `scoredArticles` — a parse/exception
 * failure is loud and the article is dropped from the success list (recorded
 * only in `failures`). Parse failures count toward the consecutive-error
 * counter (a deliberate strengthening over the legacy benign-parse behavior).
 */

import type { TaggedArticle, ScoredArticle, ScoreResult, ScoreFailure } from "./types";
import type { LLMClient } from "./llm-client";
import { LLMClient as DefaultLLMClient, withRetry } from "./llm-client";
import { DEFAULT_TIMEOUT_MS, getModelName } from "./config";
import { truncateForHaltReason } from "./util";
import { SHIPPED_SCORER_PROMPT } from "../prompts/defaults";
import { renderPromptTemplate } from "../prompts/contract";

// ---------------------------------------------------------------------------
// Verbatim prompt — byte-identical to legacy scorer.py
// ---------------------------------------------------------------------------

/** Arguments for {@link SCORER_PROMPT_TEMPLATE}. */
export interface ScorerPromptArgs {
  topics: string[];
  dislikedTopics: string[];
  tags: string[];
  title: string;
}

/**
 * Prepare the scorer prompt substitution values: join `topics` with `", "`,
 * fall empty `dislikedTopics`/`tags` to `"None"`, pass `title` through. Single
 * source of truth shared by {@link SCORER_PROMPT_TEMPLATE} (shipped default)
 * and {@link ArticleScorer.formatPrompt}'s custom-template branch, so the two
 * paths cannot silently diverge.
 */
function prepareScorerValues(
  topics: string[],
  dislikedTopics: string[],
  tags: string[],
  title: string,
): Record<"topics" | "disliked_topics" | "tags" | "title", string> {
  return {
    topics: topics.join(", "),
    disliked_topics: dislikedTopics.length > 0 ? dislikedTopics.join(", ") : "None",
    tags: tags.length > 0 ? tags.join(", ") : "None",
    title,
  };
}

/**
 * Scorer prompt, ported verbatim from legacy `scorer.py`. A function (not a
 * constant) so the legacy substitutions (topics/disliked join, title, tags)
 * compose at call time. The prompt body OMITS the article content — legacy
 * parity.
 */
export function SCORER_PROMPT_TEMPLATE(args: ScorerPromptArgs): string {
  return renderPromptTemplate(
    SHIPPED_SCORER_PROMPT,
    prepareScorerValues(args.topics, args.dislikedTopics, args.tags, args.title),
  );
}

/**
 * Consecutive-failure count that triggers a halt. Fixed — not env-overridable
 * here (stage 06 may surface it).
 */
export const CONSECUTIVE_ERROR_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// ScoreParseError (internal)
// ---------------------------------------------------------------------------

/**
 * Thrown when the scorer LLM returns a non-numeric response. Carries the raw
 * response string. Thrown AFTER `withRetry` returns (a successful LLM call),
 * so it is NOT retried — it propagates out of `calculateScore` and is caught
 * by `scoreArticles`'s per-article failure handler as a `reason: 'parse'`.
 */
export class ScoreParseError extends Error {
  readonly raw: string;

  constructor(raw: string, message?: string) {
    super(message ?? `Scorer returned a non-numeric response: ${raw}`);
    this.name = "ScoreParseError";
    this.raw = raw;
  }
}

// ---------------------------------------------------------------------------
// Strict parse helper (C1-20260630)
// ---------------------------------------------------------------------------

/**
 * Strict parse of a scorer LLM response into a finite decimal number, then
 * clamp to [0, 10]. Throws {@link ScoreParseError} for empty/whitespace, hex
 * (e.g. `"0x10"`), non-finite (`"Infinity"`, `"NaN"`), or any non-decimal
 * string — matching the legacy Python `float()` guard more faithfully than
 * `Number()` (which accepts `""`→0 and `"0x10"`→16).
 *
 * PINNED approach: a strict decimal regex gate BEFORE `parseFloat`. `parseFloat`
 * alone is too lenient in two ways — `parseFloat("0x10")===0` (parses the
 * leading `0`, stops at `x`) and `parseFloat("Infinity")===Infinity` — so we
 * reject any trimmed string that isn't a plain decimal (optionally signed,
 * with optional fraction and scientific exponent) first, then keep the
 * `!Number.isFinite` guard as belt-and-suspenders.
 */
const STRICT_DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseScoreContent(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "" || !STRICT_DECIMAL.test(trimmed)) {
    throw new ScoreParseError(raw);
  }
  const n = parseFloat(trimmed);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    throw new ScoreParseError(raw);
  }
  return Math.max(0, Math.min(10, n));
}

// ---------------------------------------------------------------------------
// ArticleScorer
// ---------------------------------------------------------------------------

/** Constructor options for {@link ArticleScorer}. */
export interface ArticleScorerOptions {
  /** Injected LLM client (mock in tests). Defaults to `new LLMClient()`. */
  client?: LLMClient;
  /** Override model id; when unset, uses {@link getModelName}("scorer"). */
  model?: string;
  /** Override prompt body; when unset, uses {@link SCORER_PROMPT_TEMPLATE}. */
  promptTemplate?: string;
}

/** Discriminated outcome of a single article's score attempt. */
interface ScoreAttempt {
  ok: boolean;
  score: number;
  reason: "exception" | "parse";
  /** How many times the wrapped client call was invoked. */
  attempts: number;
  error: string;
}

/**
 * Score-phase processor. Sequential `scoreArticles` with per-instance
 * `consecutiveErrors` counter reset on every success; halts (returns
 * `halted: true`) after {@link CONSECUTIVE_ERROR_THRESHOLD} consecutive
 * failures. Failed articles are NOT added to `scoredArticles`. Inject a mock
 * `LLMClient` for unit tests.
 */
export class ArticleScorer {
  private readonly client: LLMClient;
  private readonly model: string | undefined;
  private readonly promptTemplate: string | undefined;
  private consecutiveErrors = 0;

  constructor(options?: ArticleScorerOptions) {
    this.client = options?.client ?? new DefaultLLMClient();
    this.model = options?.model;
    this.promptTemplate = options?.promptTemplate;
  }

  /**
   * Process `articles` sequentially. On each article:
   * - success → push a `ScoredArticle` (`{ ...article, score }`), reset
   *   `consecutiveErrors`.
   * - failure (LLM-call exception after all retries, OR a parse failure) →
   *   record a `ScoreFailure` (article NOT pushed to `scoredArticles`),
   *   increment `consecutiveErrors`; if it reaches
   *   {@link CONSECUTIVE_ERROR_THRESHOLD}, halt and return the partial result.
   *
   * Order matters (the counter is order-dependent); never parallelize.
   */
  async scoreArticles(
    articles: TaggedArticle[],
    topics: string[],
    dislikedTopics: string[],
  ): Promise<ScoreResult> {
    const scoredArticles: ScoredArticle[] = [];
    const failures: ScoreFailure[] = [];
    let halted = false;
    let haltReason: string | null = null;

    for (const article of articles) {
      const attempt = await this.tryCalculateScore(
        article.title,
        article.content,
        article.tags,
        topics,
        dislikedTopics,
      );

      if (attempt.ok) {
        scoredArticles.push({ ...article, score: attempt.score });
        this.consecutiveErrors = 0;
        continue;
      }

      failures.push({
        articleTitle: article.title,
        articleLink: article.link,
        error: attempt.error,
        reason: attempt.reason,
        attempts: attempt.attempts,
      });
      this.consecutiveErrors += 1;

      if (this.consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD) {
        halted = true;
        haltReason = truncateForHaltReason(
          `Score phase halted: ${CONSECUTIVE_ERROR_THRESHOLD} consecutive article failures (last error: ${attempt.error})`,
        );
        break;
      }
    }

    return {
      scoredArticles,
      failures,
      halted,
      haltReason,
      consecutiveErrors: this.consecutiveErrors,
      totalArticles: articles.length,
    };
  }

  /**
   * Run {@link calculateScore} inside `withRetry`, then parse + clamp. Captures
   * the number of attempts and discriminates `exception` (withRetry exhausted)
   * from `parse` (non-numeric response after a successful LLM call). Resolves
   * to a {@link ScoreAttempt} (never throws).
   */
  private async tryCalculateScore(
    title: string,
    content: string,
    tags: string[],
    topics: string[],
    dislikedTopics: string[],
  ): Promise<ScoreAttempt> {
    let attempts = 0;
    try {
      const raw = await this.callLLM(title, content, tags, topics, dislikedTopics, () => {
        attempts += 1;
      });

      // Parse happens AFTER withRetry returns — a ScoreParseError thrown here
      // is NOT retried; it propagates to the catch below as reason 'parse'.
      // Strict parse (C1-20260630): rejects empty/whitespace/hex/non-finite.
      const score = parseScoreContent(raw);
      return {
        ok: true,
        score,
        reason: "parse",
        attempts: 1,
        error: "",
      };
    } catch (error) {
      if (error instanceof ScoreParseError) {
        return {
          ok: false,
          score: 0,
          reason: "parse",
          attempts: 1,
          error: error.message,
        };
      }
      return {
        ok: false,
        score: 0,
        reason: "exception",
        attempts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Format the prompt via {@link SCORER_PROMPT_TEMPLATE}. The scorer prompt
   * omits article content by design (legacy parity), so `content` is accepted
   * but unused here.
   */
  private formatPrompt(
    title: string,
    _content: string,
    tags: string[],
    topics: string[],
    dislikedTopics: string[],
  ): string {
    if (this.promptTemplate !== undefined) {
      return renderPromptTemplate(
        this.promptTemplate,
        prepareScorerValues(topics, dislikedTopics, tags, title),
      );
    }
    return SCORER_PROMPT_TEMPLATE({
      topics,
      dislikedTopics,
      tags,
      title,
    });
  }

  /**
   * The single format-prompt + `withRetry(client.chatCompletion)` + return-raw-
   * content sequence. Shared by {@link tryCalculateScore} (halt loop) and
   * {@link calculateScore} (single article) so the format+call pair exists in
   * exactly one place. Returns the RAW LLM content string; parse + clamp stays
   * in the callers. The optional `onAttempt` hook fires once per wrapped client
   * invocation so callers that track attempts (the halt loop) can count them
   * without re-implementing `withRetry`.
   */
  private async callLLM(
    title: string,
    _content: string,
    tags: string[],
    topics: string[],
    dislikedTopics: string[],
    onAttempt?: () => void,
  ): Promise<string> {
    const prompt = this.formatPrompt(title, _content, tags, topics, dislikedTopics);
    const result = await withRetry(async () => {
      onAttempt?.();
      return this.client.chatCompletion({
        model: this.model ?? getModelName("scorer"),
        messages: [{ role: "user", content: prompt }],
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    });
    return result.content;
  }

  /**
   * Format the verbatim prompt, call the LLM via `withRetry`, then strict-parse
   * + clamp the numeric response. A non-numeric response throws
   * {@link ScoreParseError} (which is NOT retried — it escapes this method).
   * Public entry point for a single article (no halt/counter logic). Delegates
   * the format+call sequence to {@link callLLM}. The scorer prompt omits
   * content by design, so `content` is accepted but unused.
   */
  async calculateScore(
    title: string,
    _content: string,
    tags: string[],
    topics: string[],
    dislikedTopics: string[],
  ): Promise<number> {
    const raw = await this.callLLM(title, _content, tags, topics, dislikedTopics);
    // Strict parse (C1-20260630).
    return parseScoreContent(raw);
  }
}

// ---------------------------------------------------------------------------
// Standalone helper
// ---------------------------------------------------------------------------

/**
 * One-shot score-phase entry point: wraps
 * `new ArticleScorer(options).scoreArticles(...)`.
 */
export async function scoreArticles(
  articles: TaggedArticle[],
  topics: string[],
  dislikedTopics: string[],
  options?: ArticleScorerOptions,
): Promise<ScoreResult> {
  return new ArticleScorer(options).scoreArticles(articles, topics, dislikedTopics);
}

// Re-exported so the scorer test can reference the phase's output shapes.
export type { TaggedArticle, ScoredArticle, ScoreResult, ScoreFailure };
