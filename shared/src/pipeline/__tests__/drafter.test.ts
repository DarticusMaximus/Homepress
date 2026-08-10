import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { NewsletterDrafter, draftNewsletter, DRAFTER_PROMPT_TEMPLATE } from "../drafter";
import type { LLMClient } from "../llm-client";
import { LLMNetworkError } from "../llm-client";
import type { SelectedArticle, DraftResult } from "../types";
import { createArticle } from "../types";
import { DRAFTER_TIMEOUT_MS, DEFAULT_MAX_RETRIES, getModelName } from "../config";

// ---------------------------------------------------------------------------
// Shipped drafter prompt reference — built via DRAFTER_PROMPT_TEMPLATE so the
// parity test stays locked to the Feature 03 pinned SHIPPED_DRAFTER_PROMPT.
// ---------------------------------------------------------------------------

function shippedDrafterPrompt(
  newsletterName: string,
  topicsStr: string,
  count: number,
  articlesJson: string,
  audience = "",
): string {
  return DRAFTER_PROMPT_TEMPLATE({
    newsletterName,
    topicsStr,
    articlesJson,
    count,
    audience,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSelectedArticle(overrides: Partial<SelectedArticle> = {}): SelectedArticle {
  return {
    title: "Default Title",
    link: "https://example.com/default",
    published: new Date("2025-01-01T00:00:00Z"),
    content: "Default article body content.",
    source: "feed",
    tags: ["default-tag"],
    score: 7.5,
    ...overrides,
  };
}

function sampleArticles(): SelectedArticle[] {
  return [
    makeSelectedArticle({
      title: "AI Breakthrough",
      link: "https://example.com/ai",
      content: "AI content body.",
      tags: ["AI"],
      score: 9,
    }),
    makeSelectedArticle({
      title: "Cloud Scaling",
      link: "https://example.com/cloud",
      content: "Cloud content body.",
      tags: ["Cloud"],
      score: 8,
    }),
  ];
}

type ChatOpts = {
  model: string;
  messages: { role: string; content: string }[];
  timeoutMs?: number;
  temperature?: number;
  extraBody?: Record<string, unknown>;
};

/**
 * Mock client factory. `responses` may be either an array (consumed in order)
 * or a function (called per invocation, returning `{ content }` or throwing).
 */
function makeMockClient(
  responses:
    Array<{ content: unknown } | Error> | ((opts: ChatOpts) => { content: unknown } | never),
): { client: LLMClient; calls: ChatOpts[] } {
  const calls: ChatOpts[] = [];
  let i = 0;
  const chatCompletion = vi.fn(async (opts: ChatOpts) => {
    calls.push(opts);
    let r: { content: unknown } | Error;
    if (typeof responses === "function") {
      r = responses(opts);
    } else {
      r = responses[i++] ?? responses[responses.length - 1];
    }
    if (r instanceof Error) throw r;
    return { content: r.content as string, raw: { mocked: true } };
  });
  return { client: { chatCompletion } as unknown as LLMClient, calls };
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
// 1. Prompt parity
// ===========================================================================

describe("NewsletterDrafter — prompt parity with shipped SHIPPED_DRAFTER_PROMPT", () => {
  it("sends the byte-identical shipped prompt for the sample input", async () => {
    const { client, calls } = makeMockClient([{ content: "# Featured" }]);
    const articles = sampleArticles();
    const articlesJson = JSON.stringify(
      articles.map((a) => ({
        title: a.title,
        link: a.link,
        content: a.content,
        score: a.score,
        tags: a.tags,
      })),
      null,
      2,
    );
    const expected = shippedDrafterPrompt("Tech Trench", "AI, Cloud", 3, articlesJson);

    await new NewsletterDrafter({ client }).draft(articles, "Tech Trench", ["AI", "Cloud"], 3);

    expect(calls[0]?.messages).toEqual([{ role: "user", content: expected }]);
  });
});

// ===========================================================================
// 2. Topics fallback
// ===========================================================================

describe("NewsletterDrafter — topics fallback", () => {
  it("uses 'technology news' when topics is empty", async () => {
    const { client, calls } = makeMockClient([{ content: "# Draft" }]);
    await new NewsletterDrafter({ client }).draft(sampleArticles(), "Blog", [], 2);
    expect(calls[0]?.messages[0]?.content).toContain("Prioritize: technology news");
  });
});

// ===========================================================================
// 3. extraBody / model / timeoutMs
// ===========================================================================

describe("NewsletterDrafter — chatCompletion options", () => {
  it("sends extraBody, model, single user message, and timeoutMs", async () => {
    const { client, calls } = makeMockClient([{ content: "# Draft" }]);
    await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Tech Trench",
      ["AI", "Cloud"],
      3,
    );
    const opts = calls[0];
    expect(opts?.extraBody).toEqual({
      max_completion_tokens: 32000,
      reasoning_effort: "high",
    });
    expect(opts?.model).toBe(getModelName("drafter"));
    expect(opts?.messages).toHaveLength(1);
    expect(opts?.messages[0]?.role).toBe("user");
    expect(opts?.timeoutMs).toBe(DRAFTER_TIMEOUT_MS);
  });
});

// ===========================================================================
// 4. Embedding stripped
// ===========================================================================

describe("NewsletterDrafter — embedding stripped from payload", () => {
  it("each article object's keys are exactly title/link/content/score/tags", async () => {
    const { client, calls } = makeMockClient([{ content: "# Draft" }]);
    const articles: SelectedArticle[] = [
      {
        ...createArticle({
          title: "With Embedding",
          link: "https://example.com/e",
          published: new Date(),
          content: "body",
          source: "feed",
        }),
        tags: ["AI"],
        score: 9,
        embedding: [0.1, 0.2, 0.3],
      },
    ];
    await new NewsletterDrafter({ client }).draft(articles, "Blog", ["AI"], 1);

    const prompt = calls[0]?.messages[0]?.content ?? "";
    // Extract the articlesJson block between the `---` separators.
    const m = /---\n\n([\s\S]*?)\n\n---/.exec(prompt);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    const keys = Object.keys(parsed[0]!).sort();
    expect(keys).toEqual(["content", "link", "score", "tags", "title"]);
  });
});

// ===========================================================================
// 5. Happy draft
// ===========================================================================

describe("NewsletterDrafter — happy draft", () => {
  it("returns the markdown with correct metadata", async () => {
    const markdown = "# Featured\n\n...";
    const { client } = makeMockClient([{ content: markdown }]);
    const articles = sampleArticles();
    const result = await new NewsletterDrafter({ client }).draft(
      articles,
      "Tech Trench",
      ["AI", "Cloud"],
      2,
    );
    expect(result.markdown).toBe(markdown);
    expect(result.empty).toBe(false);
    expect(result.articleCount).toBe(articles.length);
    expect(result.attempts).toBe(1);
    expect(result.reason).toBeNull();
  });
});

// ===========================================================================
// 6. Array-content coercion
// ===========================================================================

describe("NewsletterDrafter — array content coercion", () => {
  it("coerces an array content to its String() form", async () => {
    const { client } = makeMockClient([{ content: ["a", "b"] }]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.markdown).toBe("a,b");
  });
});

// ===========================================================================
// 7. Empty-input fail-loud
// ===========================================================================

describe("NewsletterDrafter — empty input fail-loud", () => {
  it("returns the no-articles sentinel without calling the client", async () => {
    const { client, calls } = makeMockClient([{ content: "# Draft" }]);
    const result = await new NewsletterDrafter({ client }).draft([], "Blog", ["AI"], 0);
    expect(result).toEqual({
      markdown: "",
      articleCount: 0,
      empty: true,
      reason: "no-articles",
      attempts: 0,
    });
    expect(calls).toHaveLength(0);
  });
});

// ===========================================================================
// 8. One-shot empty retry succeeds
// ===========================================================================

describe("NewsletterDrafter — one-shot empty retry succeeds", () => {
  it("returns the second non-empty response with attempts=2 and identical args", async () => {
    const { client, calls } = makeMockClient([{ content: "" }, { content: "# Draft" }]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.markdown).toBe("# Draft");
    expect(result.attempts).toBe(2);
    expect(result.empty).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });
});

// ===========================================================================
// 9. Empty-after-retry
// ===========================================================================

describe("NewsletterDrafter — empty after retry", () => {
  it("both empty → empty:true, reason:'empty-after-retry', attempts:2", async () => {
    const { client } = makeMockClient([{ content: "" }, { content: "" }]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result).toEqual({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: "empty-after-retry",
      attempts: 2,
      raw: { mocked: true },
    });
  });
});

// ===========================================================================
// 10. One-shot retry swallows throw
// ===========================================================================

describe("NewsletterDrafter — one-shot retry swallows throw", () => {
  it("empty first, reject second → resolves empty-after-retry (no rejection)", async () => {
    const { client } = makeMockClient([{ content: "" }, new Error("boom")]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.empty).toBe(true);
    expect(result.reason).toBe("empty-after-retry");
    expect(result.markdown).toBe("");
  });
});

// ===========================================================================
// 11. withRetry exhaustion propagates
// ===========================================================================

describe("NewsletterDrafter — withRetry exhaustion propagates", () => {
  it("every call rejects → draft rejects; called DEFAULT_MAX_RETRIES times; one-shot not reached", async () => {
    // Real timers: withRetry's exponential backoff (1s + 2s ≈ 3s wall time) is
    // driven by real setTimeout here, so the rejection always has an `await`
    // consumer attached. This avoids the fake-timer microtask race where the
    // tracked promise rejects during the timer flush before `.rejects` can
    // attach its handler (which surfaced as an unhandled rejection under
    // vitest 4). The behavioral assertions are unchanged.
    vi.useRealTimers();
    const { client, calls } = makeMockClient(() => {
      throw new LLMNetworkError("always");
    });
    const draftP = new NewsletterDrafter({ client }).draft(sampleArticles(), "Blog", ["AI"], 2);
    await expect(draftP).rejects.toThrow("always");
    // withRetry exhausted after DEFAULT_MAX_RETRIES (3) calls; the one-shot
    // empty retry path is never reached (it would require a 4th call).
    expect(calls).toHaveLength(DEFAULT_MAX_RETRIES);
  });
});

// ===========================================================================
// Standalone draftNewsletter helper
// ===========================================================================

describe("standalone draftNewsletter helper", () => {
  it("wraps new NewsletterDrafter(options).draft(...)", async () => {
    const { client } = makeMockClient([{ content: "# Standalone" }]);
    const result = await draftNewsletter(sampleArticles(), "Blog", ["AI"], 2, { client });
    expect(result.markdown).toBe("# Standalone");
    expect(result.empty).toBe(false);
    expect(result.attempts).toBe(1);
    // Type-narrow to satisfy the compiler — the placeholder exports nothing.
    void (result as DraftResult);
  });
});

// ===========================================================================
// O2-20260630: one-shot retry error capture (swallow semantics preserved)
// ===========================================================================

describe("NewsletterDrafter — one-shot retry error capture (O2-20260630)", () => {
  it("empty first, throws second → reason 'empty-after-retry' AND retryError carries the thrown message", async () => {
    const { client } = makeMockClient([{ content: "" }, new Error("timeout 60s")]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.empty).toBe(true);
    expect(result.reason).toBe("empty-after-retry");
    expect(result.markdown).toBe("");
    expect(result.retryError).toBe("timeout 60s");
  });

  it("swallow semantics preserved: retryError populated but the drafter still proceeds to empty-after-retry (no rejection)", async () => {
    const { client } = makeMockClient([
      { content: "" },
      new Error("boom-with-special <chars> & stuff"),
    ]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.reason).toBe("empty-after-retry");
    expect(result.retryError).toBe("boom-with-special <chars> & stuff");
    expect(result.attempts).toBe(2);
  });

  it("both empty (no throw) → retryError is undefined; empty-after-retry unchanged", async () => {
    const { client } = makeMockClient([{ content: "" }, { content: "" }]);
    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.reason).toBe("empty-after-retry");
    expect(result.retryError).toBeUndefined();
  });

  it("non-Error thrown → retryError falls back to String(value)", async () => {
    // Custom mock: first call returns empty content, second throws a string.
    let call = 0;
    const chatCompletion = vi.fn(async () => {
      call += 1;
      if (call === 1) return { content: "", raw: { mocked: true } };
      throw "string-thrown";
    });
    const client = { chatCompletion } as unknown as LLMClient;

    const result = await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "Blog",
      ["AI"],
      2,
    );
    expect(result.reason).toBe("empty-after-retry");
    expect(result.retryError).toBe("string-thrown");
  });
});

// ===========================================================================
// Option injection (model / promptTemplate)
// ===========================================================================

describe("NewsletterDrafter — model and promptTemplate injection", () => {
  it("uses injected model and rendered promptTemplate for chatCompletion", async () => {
    const { client, calls } = makeMockClient([{ content: "# Featured" }]);

    await new NewsletterDrafter({
      client,
      model: "x/y",
      promptTemplate: "Name:{newsletter_name}|Topics:{topics}|Count:{count}",
    }).draft(sampleArticles(), "My Blog", ["AI", "Cloud"], 2);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("x/y");
    expect(calls[0]?.messages[0]?.content).toBe("Name:My Blog|Topics:AI, Cloud|Count:2");
  });
});

// ===========================================================================
// Feature 03 Task 1 — audience substitution (items 5–7)
// ===========================================================================

describe("NewsletterDrafter — audience placeholder substitution", () => {
  it("substitutes {audience} from the 5th draft argument into promptTemplate", async () => {
    const { client, calls } = makeMockClient([{ content: "# Title" }]);

    await new NewsletterDrafter({
      client,
      promptTemplate:
        "Name:{newsletter_name}|Audience:{audience}|Topics:{topics}|Count:{count}|Articles:{articles_json}",
    }).draft(sampleArticles(), "My Blog", ["AI", "Cloud"], 2, "Senior engineers");

    expect(calls).toHaveLength(1);
    const content = calls[0]?.messages[0]?.content as string;
    expect(content).toContain("Audience:Senior engineers");
    expect(content).not.toContain("{audience}");
  });

  it("replaces {audience} with empty string when audience is empty (token not left literal)", async () => {
    const { client, calls } = makeMockClient([{ content: "# Title" }]);

    await new NewsletterDrafter({
      client,
      promptTemplate: "Audience:[{audience}]|Name:{newsletter_name}",
    }).draft(sampleArticles(), "My Blog", ["AI"], 2, "");

    expect(calls).toHaveLength(1);
    const content = calls[0]?.messages[0]?.content as string;
    expect(content).toContain("Audience:[]");
    expect(content).not.toContain("{audience}");
  });

  it("DRAFTER_PROMPT_TEMPLATE / shipped path substitutes audience when provided", async () => {
    const rendered = DRAFTER_PROMPT_TEMPLATE({
      newsletterName: "My Blog",
      topicsStr: "AI, Cloud",
      articlesJson: "[]",
      count: 2,
      audience: "Devs",
    });
    expect(rendered).toContain("Devs");
    expect(rendered).not.toContain("{audience}");

    const { client, calls } = makeMockClient([{ content: "# Title" }]);
    await new NewsletterDrafter({ client }).draft(
      sampleArticles(),
      "My Blog",
      ["AI", "Cloud"],
      2,
      "Devs",
    );
    const content = calls[0]?.messages[0]?.content as string;
    expect(content).toContain("Devs");
    expect(content).not.toContain("{audience}");
  });
});

