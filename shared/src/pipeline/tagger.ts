/**
 * Article tagger phase: LLM-driven SEO tag generation with retry + consecutive-
 * error halt.
 *
 * Ports the legacy Python `tagger.py` faithfully: the byte-identical prompt
 * template, the comma-split/trim/drop-empty/slice parse, the per-article retry
 * via the shared `withRetry` helper, and the consecutive-error-threshold halt
 * (legacy raised `TaggingError`; this port returns a structured `TagResult`
 * with `halted: true` so partial state is preserved for stage-03 resume — same
 * loud-fail contract, testable, no silent degradation).
 */

import type { Article, TaggedArticle, TagResult, TagFailure } from "./types";
import type { LLMClient } from "./llm-client";
import { LLMClient as DefaultLLMClient, withRetry } from "./llm-client";
import { DEFAULT_MAX_CONTENT_LENGTH, DEFAULT_TIMEOUT_MS, getModelName } from "./config";
import { truncateForHaltReason } from "./util";
import { SHIPPED_TAGGER_PROMPT } from "../prompts/defaults";
import { renderPromptTemplate } from "../prompts/contract";

// ---------------------------------------------------------------------------
// Verbatim prompt — byte-identical to legacy tagger.py:66-77
// ---------------------------------------------------------------------------

/**
 * SEO-tag generation prompt, ported verbatim from legacy `tagger.py:66-77`.
 * The literal `{title}` and `{truncated_content}` tokens are substituted by
 * {@link ArticleTagger.generateTags} at format time.
 */
export const TAGGER_PROMPT_TEMPLATE = SHIPPED_TAGGER_PROMPT;

/** Maximum tags per article (legacy `tags[:10]`). */
export const DEFAULT_MAX_TAGS = 10;

/**
 * Consecutive-failure count that triggers a halt (legacy `tagger.py:19`).
 * Fixed — not env-overridable here (stage 06 may surface it).
 */
export const CONSECUTIVE_ERROR_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// ArticleTagger
// ---------------------------------------------------------------------------

/** Constructor options for {@link ArticleTagger}. */
export interface ArticleTaggerOptions {
  /** Injected LLM client (mock in tests). Defaults to `new LLMClient()`. */
  client?: LLMClient;
  /** Max tags per article. Defaults to {@link DEFAULT_MAX_TAGS}. */
  maxTags?: number;
  /** Max content chars fed into the prompt. Defaults to {@link DEFAULT_MAX_CONTENT_LENGTH}. */
  maxContentLength?: number;
  /** Override model id; when unset, uses {@link getModelName}("tagger"). */
  model?: string;
  /** Override prompt body; when unset, uses {@link TAGGER_PROMPT_TEMPLATE}. */
  promptTemplate?: string;
}

/** Discriminated outcome of a single article's tag attempt. */
interface TagAttempt {
  ok: boolean;
  tags: string[];
  /** How many times the wrapped client call was invoked (== withRetry attempts). */
  attempts: number;
  error: string;
}

/**
 * Tag-phase processor. Sequential `tagArticles` with per-instance
 * `consecutiveErrors` counter reset on every success; halts (returns
 * `halted: true`) after {@link CONSECUTIVE_ERROR_THRESHOLD} consecutive
 * failures. No real network in unit tests — inject a mock `LLMClient`.
 */
export class ArticleTagger {
  private readonly client: LLMClient;
  private readonly maxTags: number;
  private readonly maxContentLength: number;
  private readonly model: string | undefined;
  private readonly promptTemplate: string | undefined;
  private consecutiveErrors = 0;

  constructor(options?: ArticleTaggerOptions) {
    this.client = options?.client ?? new DefaultLLMClient();
    this.maxTags = options?.maxTags ?? DEFAULT_MAX_TAGS;
    this.maxContentLength = options?.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
    this.model = options?.model;
    this.promptTemplate = options?.promptTemplate;
  }

  /**
   * Process `articles` sequentially. On each article:
   * - success → `TaggedArticle` with the parsed tags, reset `consecutiveErrors`.
   * - failure (all retries exhausted) → `TaggedArticle` with `tags: []` plus a
   *   `TagFailure`, increment `consecutiveErrors`; if it reaches
   *   {@link CONSECUTIVE_ERROR_THRESHOLD}, halt and return the partial result.
   *
   * Order matters (the counter is order-dependent); never parallelize.
   */
  async tagArticles(articles: Article[]): Promise<TagResult> {
    const taggedArticles: TaggedArticle[] = [];
    const failures: TagFailure[] = [];
    let halted = false;
    let haltReason: string | null = null;

    for (const article of articles) {
      const attempt = await this.tryGenerateTags(article.title, article.content);

      if (attempt.ok) {
        taggedArticles.push({ ...article, tags: attempt.tags });
        this.consecutiveErrors = 0;
        continue;
      }

      taggedArticles.push({ ...article, tags: [] });
      failures.push({
        articleTitle: article.title,
        articleLink: article.link,
        error: attempt.error,
        attempts: attempt.attempts,
      });
      this.consecutiveErrors += 1;

      if (this.consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD) {
        halted = true;
        haltReason = truncateForHaltReason(
          `Tag phase halted: ${CONSECUTIVE_ERROR_THRESHOLD} consecutive article failures (last error: ${attempt.error})`,
        );
        break;
      }
    }

    return {
      taggedArticles,
      failures,
      halted,
      haltReason,
      consecutiveErrors: this.consecutiveErrors,
      totalArticles: articles.length,
    };
  }

  /**
   * Run {@link generateTags} inside `withRetry`, capturing the number of
   * attempts. Resolves to a {@link TagAttempt} (never throws): `ok: true` with
   * the parsed tags, or `ok: false` with the error string and attempt count.
   */
  private async tryGenerateTags(title: string, content: string): Promise<TagAttempt> {
    let attempts = 0;
    try {
      const raw = await this.callLLM(title, content, () => {
        attempts += 1;
      });
      return {
        ok: true,
        tags: this.parseTags(raw),
        attempts,
        error: "",
      };
    } catch (error) {
      return {
        ok: false,
        tags: [],
        attempts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Truncate content, then substitute `{title}` / `{truncated_content}` into
   * {@link TAGGER_PROMPT_TEMPLATE}. Shared by {@link callLLM}.
   */
  private formatPrompt(title: string, content: string): string {
    const truncatedContent = content.slice(0, this.maxContentLength);
    return renderPromptTemplate(this.promptTemplate ?? TAGGER_PROMPT_TEMPLATE, {
      title,
      truncated_content: truncatedContent,
    });
  }

  /**
   * The single format-prompt + `withRetry(client.chatCompletion)` + return-raw-
   * content sequence. Shared by {@link tryGenerateTags} (halt loop) and
   * {@link generateTags} (single article) so the format+call pair exists in
   * exactly one place. The optional `onAttempt` hook fires once per wrapped
   * client invocation so callers that track attempts (the halt loop) can count
   * them without re-implementing `withRetry`.
   */
  private async callLLM(title: string, content: string, onAttempt?: () => void): Promise<string> {
    const prompt = this.formatPrompt(title, content);
    const result = await withRetry(async () => {
      onAttempt?.();
      return this.client.chatCompletion({
        model: this.model ?? getModelName("tagger"),
        messages: [{ role: "user", content: prompt }],
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    });
    return result.content;
  }

  /**
   * Truncate content, format the verbatim prompt, call the LLM via `withRetry`,
   * and parse the comma-separated response. Mirrors legacy `tagger.py:63-86`.
   * Public entry point for a single article (no halt/counter logic). Delegates
   * the format+call sequence to {@link callLLM}.
   */
  async generateTags(title: string, content: string): Promise<string[]> {
    const raw = await this.callLLM(title, content);
    return this.parseTags(raw);
  }

  /**
   * Legacy tag parse (`tagger.py:84-86`): split on `,`, trim each, drop
   * empties, slice to `maxTags`.
   */
  private parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .slice(0, this.maxTags);
  }
}

// ---------------------------------------------------------------------------
// Standalone helper
// ---------------------------------------------------------------------------

/**
 * One-shot tag-phase entry point: wraps
 * `new ArticleTagger(options).tagArticles(articles)`.
 */
export async function tagArticles(
  articles: Article[],
  options?: ArticleTaggerOptions,
): Promise<TagResult> {
  return new ArticleTagger(options).tagArticles(articles);
}

// Re-exported so the tagger test can reference the phase's output shapes
// without a second import hop.
export type { TaggedArticle };
