import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ArticleTagger,
  tagArticles,
  TAGGER_PROMPT_TEMPLATE,
  DEFAULT_MAX_TAGS,
  CONSECUTIVE_ERROR_THRESHOLD,
} from "../tagger";
import type { LLMClient } from "../llm-client";
import type { ChatCompletionResult } from "../llm-client";
import { LLMNetworkError } from "../llm-client";
import type { Article } from "../types";

// ---------------------------------------------------------------------------
// Legacy prompt (tagger.py:66-77) — byte-identical reference
// ---------------------------------------------------------------------------

const LEGACY_TAGGER_PROMPT = `Role: Helpful assistant for SEO tag generation
Goal: Label content using general, broad tags
Rules:
- Avoid names of people or devices
- Use general tags to label topics
- Provide up to 10 tags, comma-separated
- Avoid similar tags (e.g., don't use both "AI" and "Machine Learning")

Title: {title}
Article: {truncated_content}

Output: CSV tags only`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: "Default Title",
    link: "https://example.com/default",
    published: new Date("2025-01-01T00:00:00Z"),
    content: "Default article body content.",
    source: "example",
    ...overrides,
  };
}

type ChatFn = (options: {
  model: string;
  messages: { role: string; content: string }[];
}) => Promise<ChatCompletionResult>;

function makeMockClient(chat: ChatFn): LLMClient {
  return { chatCompletion: vi.fn(chat) } as unknown as LLMClient;
}

function okContent(content: string): ChatCompletionResult {
  return { content, raw: { choices: [{ message: { content } }] } };
}

/**
 * Drive an async operation to completion under fake timers. The tagger's
 * `withRetry` backoff (1s + 2s per failed article) uses `setTimeout`, so any
 * test that exercises retry-exhaustion must advance fake timers until the
 * underlying `tagArticles` promise settles. Mirrors the fake-timer idiom in
 * `llm-client.test.ts` (the withRetry suite) but generalized into a loop so
 * the multi-article tagger pipeline resolves regardless of how many sleeps
 * pile up across articles.
 */
async function runWithFakeTimers<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const tracked = p.then((r) => {
    done = true;
    return r;
  });
  let guard = 0;
  while (!done && guard < 1000) {
    await vi.advanceTimersByTimeAsync(1000);
    guard += 1;
  }
  if (!done) {
    throw new Error("promise never resolved under fake timers");
  }
  return tracked;
}

/**
 * Extract the `Title: <title>` line from a tagger prompt, so a mock client can
 * decide success/failure per-article rather than per-call. This decouples the
 * test's intended article-level sequence from `withRetry`'s per-article
 * attempt count.
 */
function extractTitle(prompt: string): string {
  const m = /^Title: (.+)$/m.exec(prompt);
  return m?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// Prompt parity
// ===========================================================================

describe("TAGGER_PROMPT_TEMPLATE — parity with legacy tagger.py:66-77", () => {
  it("is byte-identical to the legacy prompt literal", () => {
    expect(TAGGER_PROMPT_TEMPLATE).toBe(LEGACY_TAGGER_PROMPT);
  });

  it("DEFAULT_MAX_TAGS is 10 and CONSECUTIVE_ERROR_THRESHOLD is 3", () => {
    expect(DEFAULT_MAX_TAGS).toBe(10);
    expect(CONSECUTIVE_ERROR_THRESHOLD).toBe(3);
  });
});

// ===========================================================================
// Happy tagging + prompt formatting
// ===========================================================================

describe("tagArticles — happy path", () => {
  it("produces tags from the LLM response and includes title/content in the prompt", async () => {
    let capturedPrompt = "";
    const client = makeMockClient(async (opts) => {
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("AI, Cloud, Kubernetes");
    });

    const article = makeArticle({
      title: "My Title",
      content: "The article body text.",
    });

    const result = await new ArticleTagger({ client }).tagArticles([article]);

    expect(result.taggedArticles).toHaveLength(1);
    expect(result.taggedArticles[0]?.tags).toEqual(["AI", "Cloud", "Kubernetes"]);
    // The prompt sent to the client contains the title and the content.
    expect(capturedPrompt).toContain("My Title");
    expect(capturedPrompt).toContain("The article body text.");
  });
});

// ===========================================================================
// Parse edge cases
// ===========================================================================

describe("tagArticles — parse edge cases", () => {
  it("trims, drops empties from a messy comma-separated response", async () => {
    const client = makeMockClient(async () => okContent("  , spaced , ,empty, "));
    const result = await new ArticleTagger({ client }).tagArticles([makeArticle()]);
    expect(result.taggedArticles[0]?.tags).toEqual(["spaced", "empty"]);
  });

  it("slices tags to maxTags (10) when the LLM returns more", async () => {
    const many = Array.from({ length: 15 }, (_, i) => `tag${i}`).join(", ");
    const client = makeMockClient(async () => okContent(many));
    const result = await new ArticleTagger({ client }).tagArticles([makeArticle()]);
    expect(result.taggedArticles[0]?.tags).toHaveLength(10);
    expect(result.taggedArticles[0]?.tags?.[0]).toBe("tag0");
  });

  it("honours a custom maxTags override", async () => {
    const many = Array.from({ length: 15 }, (_, i) => `tag${i}`).join(", ");
    const client = makeMockClient(async () => okContent(many));
    const result = await new ArticleTagger({
      client,
      maxTags: 3,
    }).tagArticles([makeArticle()]);
    expect(result.taggedArticles[0]?.tags).toHaveLength(3);
  });
});

// ===========================================================================
// Content truncation
// ===========================================================================

describe("tagArticles — content truncation", () => {
  it("truncates content to maxContentLength before formatting the prompt", async () => {
    let capturedPrompt = "";
    const maxContentLength = 50;
    const client = makeMockClient(async (opts) => {
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("tag");
    });

    const longBody = "x".repeat(500);
    await new ArticleTagger({ client, maxContentLength }).tagArticles([
      makeArticle({ title: "T", content: longBody }),
    ]);

    // The content body within the prompt is exactly maxContentLength chars.
    // The prompt contains a run of 50 'x' chars, but NOT 500.
    const xs = "x".repeat(maxContentLength);
    expect(capturedPrompt).toContain(xs);
    expect(capturedPrompt).not.toContain("x".repeat(maxContentLength + 1));
  });
});

// ===========================================================================
// Consecutive-error reset
// ===========================================================================

describe("tagArticles — consecutive reset on success", () => {
  it("a success between failures resets the counter; not halted; 2 failures", async () => {
    // Article-aware mock: key success/failure on the article TITLE embedded in
    // the prompt, NOT on a global call counter. `withRetry` invokes the client
    // up to 3 times per article, so a call-number-keyed mock would conflate
    // per-call and per-article sequencing and yield the wrong article-level
    // sequence. Here B always succeeds; A and C always fail.
    const SUCCESS_TITLE = "B";
    const client = makeMockClient(async (opts) => {
      const prompt = opts.messages[0]?.content ?? "";
      const title = extractTitle(prompt);
      if (title === SUCCESS_TITLE) {
        return okContent("tag");
      }
      throw new Error("fail");
    });

    const result = await runWithFakeTimers(
      new ArticleTagger({ client }).tagArticles([
        makeArticle({ title: "A" }),
        makeArticle({ title: "B" }),
        makeArticle({ title: "C" }),
      ]),
    );

    expect(result.halted).toBe(false);
    expect(result.consecutiveErrors).toBe(1); // reset after B, then C failed once
    expect(result.failures).toHaveLength(2);
    expect(result.taggedArticles).toHaveLength(3);
    // The middle article got real tags; the failed ones got [].
    const tagged = result.taggedArticles;
    expect(tagged[1]?.tags).toEqual(["tag"]);
    expect(tagged[0]?.tags).toEqual([]);
    expect(tagged[2]?.tags).toEqual([]);
  });
});

// ===========================================================================
// Halt at 3 consecutive failures
// ===========================================================================

describe("tagArticles — halt at 3 consecutive failures", () => {
  it("halts after 3 consecutive failures, leaving later articles unprocessed", async () => {
    const client = makeMockClient(async () => {
      throw new Error("always fails");
    });

    const articles = Array.from({ length: 5 }, (_, i) =>
      makeArticle({ title: `A${i}`, link: `https://example.com/${i}` }),
    );

    const result = await runWithFakeTimers(new ArticleTagger({ client }).tagArticles(articles));

    expect(result.halted).toBe(true);
    expect(result.haltReason).toBeTruthy();
    expect(result.consecutiveErrors).toBeGreaterThanOrEqual(3);
    // Only 3 articles processed.
    expect(result.taggedArticles).toHaveLength(3);
    // Each processed article retained with empty tags and recorded in failures.
    expect(result.failures).toHaveLength(3);
    for (const t of result.taggedArticles) {
      expect(t.tags).toEqual([]);
    }
    // Articles 4 and 5 (index 3, 4) are NOT present.
    expect(result.taggedArticles.some((t) => t.title === "A3")).toBe(false);
    expect(result.taggedArticles.some((t) => t.title === "A4")).toBe(false);
    expect(result.totalArticles).toBe(5);
  });
});

// ===========================================================================
// Per-article retry exhaustion counts once
// ===========================================================================

describe("tagArticles — per-article retry exhaustion counts once", () => {
  it("one failed article produces one TagFailure and attempts reflects withRetry", async () => {
    const chatFn = vi.fn(async () => {
      throw new LLMNetworkError("nope");
    });
    const client = { chatCompletion: chatFn } as unknown as LLMClient;

    const result = await runWithFakeTimers(
      new ArticleTagger({ client }).tagArticles([
        makeArticle({ title: "Only", link: "https://example.com/only" }),
      ]),
    );

    // Only one TagFailure recorded.
    expect(result.failures).toHaveLength(1);
    const f = result.failures[0];
    expect(f?.articleTitle).toBe("Only");
    expect(f?.articleLink).toBe("https://example.com/only");
    expect(f?.error).toBeTruthy();
    // withRetry made DEFAULT_MAX_RETRIES (3) attempts for this one article.
    expect(f?.attempts).toBe(3);
    expect(chatFn).toHaveBeenCalledTimes(3);
  });
});

// ===========================================================================
// Shape / totalArticles
// ===========================================================================

describe("tagArticles — totalArticles and shape", () => {
  it("totalArticles equals input length; not halted processes all", async () => {
    const client = makeMockClient(async () => okContent("a,b"));
    const articles = [makeArticle({ title: "X" }), makeArticle({ title: "Y" })];
    const result = await new ArticleTagger({ client }).tagArticles(articles);

    expect(result.totalArticles).toBe(2);
    expect(result.halted).toBe(false);
    expect(result.haltReason).toBeNull();
    expect(result.taggedArticles).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
    expect(result.consecutiveErrors).toBe(0);
  });
});

// ===========================================================================
// Empty input
// ===========================================================================

describe("tagArticles — empty input", () => {
  it("returns a well-formed empty TagResult", async () => {
    const client = makeMockClient(async () => okContent("x"));
    const result = await new ArticleTagger({ client }).tagArticles([]);
    expect(result).toEqual({
      taggedArticles: [],
      failures: [],
      halted: false,
      haltReason: null,
      consecutiveErrors: 0,
      totalArticles: 0,
    });
  });
});

// ===========================================================================
// Empty-response fallback (N3-20260630): tagger retains article with tags: []
// ===========================================================================

describe("tagArticles — empty response yields tags [] (N3)", () => {
  it("okContent('') → taggedArticles[0].tags === [] and the article is NOT in failures", async () => {
    const client = makeMockClient(async () => okContent(""));
    const article = makeArticle({ title: "Blank", link: "https://example.com/blank" });

    const result = await new ArticleTagger({ client }).tagArticles([article]);

    // Intentional empty-fallback: the tagger keeps the article with no tags.
    expect(result.taggedArticles).toHaveLength(1);
    expect(result.taggedArticles[0]?.tags).toEqual([]);
    expect(result.taggedArticles[0]?.title).toBe("Blank");
    // Not recorded as a failure.
    expect(result.failures).toHaveLength(0);
    expect(result.failures.some((f) => f.articleTitle === "Blank")).toBe(false);
  });
});

// ===========================================================================
// Prompt parity (C6-20260630): single-article and halt-loop paths share
// callLLM, so they must produce byte-identical prompts for the same input.
// ===========================================================================

describe("ArticleTagger — prompt parity between generateTags and tryGenerateTags (C6)", () => {
  it("the single-article path and the halt-loop path send byte-identical prompts", async () => {
    const prompts: string[] = [];
    const client = makeMockClient(async (opts) => {
      prompts.push(opts.messages[0]?.content ?? "");
      return okContent("alpha,beta");
    });

    const tagger = new ArticleTagger({ client });
    const title = "Parity Title";
    const content = "Parity article body content here.";

    // Single-article path (generateTags → callLLM).
    await tagger.generateTags(title, content);
    // Halt-loop path (tagArticles → tryGenerateTags → callLLM).
    await tagger.tagArticles([makeArticle({ title, content })]);

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe(prompts[1]);
  });
});

// ===========================================================================
// Standalone tagArticles helper
// ===========================================================================

describe("standalone tagArticles helper", () => {
  it("wraps new ArticleTagger(options).tagArticles(articles)", async () => {
    const client = makeMockClient(async () => okContent("alpha,beta"));
    const result = await tagArticles([makeArticle()], { client });
    expect(result.totalArticles).toBe(1);
    expect(result.taggedArticles[0]?.tags).toEqual(["alpha", "beta"]);
  });
});

// ===========================================================================
// Option injection (model / promptTemplate)
// ===========================================================================

describe("ArticleTagger — model and promptTemplate injection", () => {
  it("uses injected model and rendered promptTemplate for chatCompletion", async () => {
    let capturedModel = "";
    let capturedPrompt = "";
    const client = makeMockClient(async (opts) => {
      capturedModel = opts.model;
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("AI, Cloud");
    });

    const article = makeArticle({ title: "Injected Title", content: "body" });
    await new ArticleTagger({
      client,
      model: "x/y",
      promptTemplate: "Title:{title}",
    }).tagArticles([article]);

    expect(capturedModel).toBe("x/y");
    expect(capturedPrompt).toBe("Title:Injected Title");
  });
});

// ===========================================================================
// O1-20260630: haltReason truncation + newline stripping
// ===========================================================================

describe("ArticleTagger — haltReason truncation (O1-20260630)", () => {
  it("haltReason is bounded to <=200 chars and contains no newlines when the error message is long with embedded newlines", async () => {
    // 500-char message with embedded newlines.
    const longMsg =
      "x".repeat(100) + "\nbroken\n" + "y".repeat(100) + "\r\nmore\r" + "z".repeat(290);
    expect(longMsg.length).toBeGreaterThan(500);
    expect(longMsg).toContain("\n");

    const client = makeMockClient(async () => {
      throw new Error(longMsg);
    });

    const articles = Array.from({ length: 5 }, (_, i) =>
      makeArticle({ title: `A${i}`, link: `https://example.com/${i}` }),
    );

    const result = await runWithFakeTimers(new ArticleTagger({ client }).tagArticles(articles));

    expect(result.halted).toBe(true);
    expect(result.haltReason).not.toBeNull();
    expect(result.haltReason!.length).toBeLessThanOrEqual(200);
    expect(result.haltReason).not.toContain("\n");
    expect(result.haltReason).not.toContain("\r");
  });
});
