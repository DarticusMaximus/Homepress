/**
 * Newsletter drafter (feature 07, task 2).
 *
 * Ports the legacy Python `drafter.py` verbatim: the byte-identical prompt
 * template (lines 51-86), the `"technology news"` topics fallback, the
 * embedding-stripped 5-key article payload, the `withRetry`-wrapped first
 * `chatCompletion`, and the best-effort one-shot empty-content retry. Fail-loud
 * `DraftResult` on empty input or empty-after-retry so the orchestrator can
 * treat `empty === true` as a fatal draft-phase condition.
 */

import type { SelectedArticle, DraftResult } from "./types";
import { LLMClient as DefaultLLMClient, withRetry } from "./llm-client";
import type { LLMClient, ChatCompletionResult } from "./llm-client";
import { getModelName, DRAFTER_TIMEOUT_MS } from "./config";
import { SHIPPED_DRAFTER_PROMPT } from "../prompts/defaults";
import { renderPromptTemplate } from "../prompts/contract";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * `max_completion_tokens` for the drafter. Raised from the legacy 15k so
 * high-reasoning models retain enough budget for a full multi-article draft
 * (reasoning tokens count against this cap; 15k was truncating mid-issue).
 */
export const DRAFTER_MAX_COMPLETION_TOKENS = 32000 as const;

/** Legacy `reasoning_effort` for the drafter (drafter.py). */
export const DRAFTER_REASONING_EFFORT = "high" as const;

// ---------------------------------------------------------------------------
// Prompt template — byte-identical to legacy drafter.py:51-86
// ---------------------------------------------------------------------------

/**
 * Build the drafter prompt from {@link SHIPPED_DRAFTER_PROMPT}. Substitutes
 * `{newsletter_name}`, `{topics}`, `{articles_json}`, `{count}`, and
 * `{audience}` (defaults to `""` when omitted).
 */
export function DRAFTER_PROMPT_TEMPLATE(args: {
  newsletterName: string;
  topicsStr: string;
  articlesJson: string;
  count: number;
  audience?: string;
}): string {
  return renderPromptTemplate(SHIPPED_DRAFTER_PROMPT, {
    newsletter_name: args.newsletterName,
    topics: args.topicsStr,
    articles_json: args.articlesJson,
    count: String(args.count),
    audience: args.audience ?? "",
  });
}

// ---------------------------------------------------------------------------
// normalizeContent — ports drafter.py:96-98
// ---------------------------------------------------------------------------

/**
 * Coerce a model response `content` value to a string. Some models return a
 * list (e.g. `["a", "b"]`) — coerce via `String(value)` so it becomes
 * `"a,b"`. Otherwise `String(value ?? '')`. Always returns a string; never
 * throws.
 */
function normalizeContent(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value);
  }
  return String(value ?? "");
}

// ---------------------------------------------------------------------------
// NewsletterDrafter
// ---------------------------------------------------------------------------

export interface NewsletterDrafterOptions {
  client?: LLMClient;
  /** Override model id; when unset, uses {@link getModelName}("drafter"). */
  model?: string;
  /** Override prompt body; when unset, uses {@link DRAFTER_PROMPT_TEMPLATE}. */
  promptTemplate?: string;
  /** Audience string injected into `{audience}`; defaults to `""`. */
  audience?: string;
}

/**
 * Newsletter drafter. Construct with `{ client? }` (inject a mock in tests);
 * `client` defaults to `new LLMClient()`. {@link NewsletterDrafter.draft} runs
 * the full draft phase: empty-input fail-loud → topics fallback →
 * embedding-stripped payload → prompt → `withRetry`-wrapped first call →
 * best-effort one-shot empty retry → fail-loud or success `DraftResult`.
 */
export class NewsletterDrafter {
  private readonly client: LLMClient;
  private readonly model: string | undefined;
  private readonly promptTemplate: string | undefined;

  constructor(options?: NewsletterDrafterOptions) {
    this.client = options?.client ?? new DefaultLLMClient();
    this.model = options?.model;
    this.promptTemplate = options?.promptTemplate;
  }

  async draft(
    articles: SelectedArticle[],
    newsletterName: string,
    topics: string[],
    count: number,
    audience = "",
  ): Promise<DraftResult> {
    // 1. Empty input → fail loudly (no LLM call).
    if (articles.length === 0) {
      return {
        markdown: "",
        articleCount: 0,
        empty: true,
        reason: "no-articles",
        attempts: 0,
        raw: undefined,
      };
    }

    // 2. Topics fallback — verbatim legacy (drafter.py:47).
    const topicsStr = topics.length > 0 ? topics.join(", ") : "technology news";

    // 3. Article payload — strip the embedding (5 keys only).
    const payload = articles.map((a) => ({
      title: a.title,
      link: a.link,
      content: a.content,
      score: a.score,
      tags: a.tags,
    }));
    const articlesJson = JSON.stringify(payload, null, 2);

    // 4. Prompt.
    const prompt =
      this.promptTemplate !== undefined
        ? renderPromptTemplate(this.promptTemplate, {
            newsletter_name: newsletterName,
            topics: topicsStr,
            articles_json: articlesJson,
            count: String(count),
            audience,
          })
        : DRAFTER_PROMPT_TEMPLATE({
            newsletterName,
            topicsStr,
            articlesJson,
            count,
            audience,
          });

    // Shared chatCompletion arguments (identical for first call and one-shot
    // retry — legacy passes the same payload both times).
    const chatArgs = {
      model: this.model ?? getModelName("drafter"),
      messages: [{ role: "user", content: prompt }],
      timeoutMs: DRAFTER_TIMEOUT_MS,
      extraBody: {
        max_completion_tokens: DRAFTER_MAX_COMPLETION_TOKENS,
        reasoning_effort: DRAFTER_REASONING_EFFORT,
      },
    };

    // 5. First call — retry-on-exception via withRetry.
    const first: ChatCompletionResult = await withRetry(() => this.client.chatCompletion(chatArgs));
    let content = normalizeContent(first.content);
    let attempts = 1;

    // 6. Empty-content one-shot retry (drafter.py:100-118). Best-effort:
    //    swallow a thrown error and treat the result as empty. NOT wrapped in
    //    withRetry. Identical arguments. (O2-20260630: the throw is still
    //    swallowed — drafter proceeds to empty-after-retry unchanged — but the
    //    error is captured into `retryError` so it is recoverable downstream
    //    rather than silently erased.)
    let second: ChatCompletionResult | undefined;
    let retryError: unknown;
    if (content.length === 0) {
      attempts = 2;
      try {
        second = await this.client.chatCompletion(chatArgs);
        content = normalizeContent(second.content);
      } catch (e) {
        retryError = e;
      }
    }

    // 7. Empty after retry → fail loudly.
    if (content.length === 0) {
      return {
        markdown: "",
        articleCount: articles.length,
        empty: true,
        reason: "empty-after-retry",
        attempts,
        raw: (second ?? first).raw,
        retryError:
          retryError !== undefined
            ? retryError instanceof Error
              ? retryError.message
              : String(retryError)
            : undefined,
      };
    }

    // 8. Success.
    return {
      markdown: content,
      articleCount: articles.length,
      empty: false,
      reason: null,
      attempts,
      raw: first.raw,
    };
  }
}

// ---------------------------------------------------------------------------
// Standalone helper
// ---------------------------------------------------------------------------

/**
 * Standalone helper wrapping `new NewsletterDrafter(options).draft(...)`. Useful
 * for one-off calls without retaining a drafter instance.
 */
export async function draftNewsletter(
  articles: SelectedArticle[],
  newsletterName: string,
  topics: string[],
  count: number,
  options?: NewsletterDrafterOptions,
): Promise<DraftResult> {
  return new NewsletterDrafter(options).draft(
    articles,
    newsletterName,
    topics,
    count,
    options?.audience ?? "",
  );
}
