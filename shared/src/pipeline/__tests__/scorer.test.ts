import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ArticleScorer,
  scoreArticles,
  SCORER_PROMPT_TEMPLATE,
  CONSECUTIVE_ERROR_THRESHOLD,
  ScoreParseError,
} from "../scorer";
import type { LLMClient } from "../llm-client";
import type { ChatCompletionResult } from "../llm-client";
import { LLMNetworkError } from "../llm-client";
import type { TaggedArticle } from "../types";
import { SHIPPED_SCORER_PROMPT } from "../../prompts/defaults";

// ---------------------------------------------------------------------------
// Legacy scorer prompt (scorer.py) — byte-identical reference for the sample
// input: topics=["AI","Cloud"], dislikedTopics=["Crypto"],
// tags=["Kubernetes"], title="K8s 1.30 released".
// ---------------------------------------------------------------------------

const LEGACY_SCORER_PROMPT_SAMPLE = `Positive Topics: AI, Cloud

Negative Topics: Crypto

Newsletter focus: AI, Cloud

---
Article Tags: Kubernetes
Article Title: K8s 1.30 released

Analyze alignment with preferences. Score 0-10 (10 = best alignment).
Return ONLY the number.`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTaggedArticle(overrides: Partial<TaggedArticle> = {}): TaggedArticle {
  return {
    title: "Default Title",
    link: "https://example.com/default",
    published: new Date("2025-01-01T00:00:00Z"),
    content: "Default article body content.",
    source: "example",
    tags: ["default-tag"],
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
 * Drive an async operation to completion under fake timers. The scorer's
 * `withRetry` backoff (1s + 2s per failed article) uses `setTimeout`, so any
 * test that exercises retry-exhaustion must advance fake timers until the
 * underlying `scoreArticles` promise settles. Mirrors the tagger test idiom.
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
 * Extract the `Article Title: <title>` line from a scorer prompt so a mock
 * client can decide success/failure per-article rather than per-call. This
 * decouples the intended article-level sequence from `withRetry`'s per-article
 * attempt count.
 */
function extractTitle(prompt: string): string {
  const m = /^Article Title: (.+)$/m.exec(prompt);
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

describe("SCORER_PROMPT_TEMPLATE — parity with legacy scorer.py", () => {
  it("produces the byte-identical legacy output for the sample input", () => {
    const prompt = SCORER_PROMPT_TEMPLATE({
      topics: ["AI", "Cloud"],
      dislikedTopics: ["Crypto"],
      tags: ["Kubernetes"],
      title: "K8s 1.30 released",
    });
    expect(prompt).toBe(LEGACY_SCORER_PROMPT_SAMPLE);
  });

  it("joins dislikedTopics with ', ' and yields 'None' when empty", () => {
    const prompt = SCORER_PROMPT_TEMPLATE({
      topics: ["AI"],
      dislikedTopics: [],
      tags: ["x"],
      title: "T",
    });
    expect(prompt).toContain("Negative Topics: None");
    expect(prompt).toContain("Positive Topics: AI");
  });

  it("joins tags with ', ' and yields 'None' when empty", () => {
    const prompt = SCORER_PROMPT_TEMPLATE({
      topics: ["AI"],
      dislikedTopics: ["Crypto"],
      tags: [],
      title: "T",
    });
    expect(prompt).toContain("Article Tags: None");
  });

  it("CONSECUTIVE_ERROR_THRESHOLD is 3", () => {
    expect(CONSECUTIVE_ERROR_THRESHOLD).toBe(3);
  });
});

// ===========================================================================
// Prompt sent to the client
// ===========================================================================

describe("ArticleScorer — sends the parity prompt to the client", () => {
  it("the prompt the client receives matches SCORER_PROMPT_TEMPLATE output", async () => {
    let capturedPrompt = "";
    const client = makeMockClient(async (opts) => {
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("7");
    });

    const article = makeTaggedArticle({
      title: "K8s 1.30 released",
      tags: ["Kubernetes"],
    });

    await new ArticleScorer({ client }).scoreArticles([article], ["AI", "Cloud"], ["Crypto"]);

    expect(capturedPrompt).toBe(
      SCORER_PROMPT_TEMPLATE({
        topics: ["AI", "Cloud"],
        dislikedTopics: ["Crypto"],
        tags: ["Kubernetes"],
        title: "K8s 1.30 released",
      }),
    );
  });
});

// ===========================================================================
// Custom-template branch parity (M1): ArticleScorer with promptTemplate =
// SHIPPED_SCORER_PROMPT must render byte-identically to SCORER_PROMPT_TEMPLATE,
// proving the shipped-default and DB-loaded custom paths share one value-prep.
// ===========================================================================

describe("ArticleScorer — custom-template parity with SCORER_PROMPT_TEMPLATE (M1)", () => {
  it("promptTemplate = SHIPPED_SCORER_PROMPT renders byte-identical to SCORER_PROMPT_TEMPLATE for the same input", async () => {
    let capturedPrompt = "";
    const client = makeMockClient(async (opts) => {
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("7");
    });

    const topics = ["AI", "Cloud"];
    const dislikedTopics = ["Crypto"];
    const tags = ["Kubernetes"];
    const title = "K8s 1.30 released";

    await new ArticleScorer({
      client,
      promptTemplate: SHIPPED_SCORER_PROMPT,
    }).scoreArticles([makeTaggedArticle({ title, tags })], topics, dislikedTopics);

    expect(capturedPrompt).toBe(SCORER_PROMPT_TEMPLATE({ topics, dislikedTopics, tags, title }));
  });

  it("promptTemplate = SHIPPED_SCORER_PROMPT renders byte-identical with empty dislikedTopics and tags (None fallback)", async () => {
    let capturedPrompt = "";
    const client = makeMockClient(async (opts) => {
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("6");
    });

    const topics = ["AI"];
    const dislikedTopics: string[] = [];
    const tags: string[] = [];
    const title = "Edge Case Title";

    await new ArticleScorer({
      client,
      promptTemplate: SHIPPED_SCORER_PROMPT,
    }).scoreArticles([makeTaggedArticle({ title, tags })], topics, dislikedTopics);

    const expected = SCORER_PROMPT_TEMPLATE({ topics, dislikedTopics, tags, title });
    expect(capturedPrompt).toBe(expected);
    // Sanity: the "None" fallbacks are actually exercised.
    expect(expected).toContain("Negative Topics: None");
    expect(expected).toContain("Article Tags: None");
  });
});

// ===========================================================================
// Happy scoring
// ===========================================================================

describe("ArticleScorer — happy scoring", () => {
  it("parses '8.5' and retains tags/title/link on the ScoredArticle", async () => {
    const client = makeMockClient(async () => okContent("8.5"));
    const article = makeTaggedArticle({
      title: "Happy",
      link: "https://example.com/happy",
      tags: ["AI"],
    });

    const result = await new ArticleScorer({ client }).scoreArticles([article], ["AI"], []);

    expect(result.scoredArticles).toHaveLength(1);
    const scored = result.scoredArticles[0];
    expect(scored?.score).toBe(8.5);
    expect(scored?.title).toBe("Happy");
    expect(scored?.link).toBe("https://example.com/happy");
    expect(scored?.tags).toEqual(["AI"]);
  });
});

// ===========================================================================
// Clamping
// ===========================================================================

describe("ArticleScorer — score clamping to [0, 10]", () => {
  it("clamps '15.0' → 10", async () => {
    const client = makeMockClient(async () => okContent("15.0"));
    const result = await new ArticleScorer({ client }).scoreArticles(
      [makeTaggedArticle()],
      ["AI"],
      [],
    );
    expect(result.scoredArticles[0]?.score).toBe(10);
  });

  it("clamps '-5.0' → 0", async () => {
    const client = makeMockClient(async () => okContent("-5.0"));
    const result = await new ArticleScorer({ client }).scoreArticles(
      [makeTaggedArticle()],
      ["AI"],
      [],
    );
    expect(result.scoredArticles[0]?.score).toBe(0);
  });

  it("passes '7' through unchanged", async () => {
    const client = makeMockClient(async () => okContent("7"));
    const result = await new ArticleScorer({ client }).scoreArticles(
      [makeTaggedArticle()],
      ["AI"],
      [],
    );
    expect(result.scoredArticles[0]?.score).toBe(7);
  });
});

// ===========================================================================
// Parse failure
// ===========================================================================

describe("ArticleScorer — parse failure", () => {
  it("'Not a number' → ScoreFailure reason 'parse', attempts 1; article NOT in scoredArticles; client called once", async () => {
    const chatFn = vi.fn(async () => okContent("Not a number"));
    const client = { chatCompletion: chatFn } as unknown as LLMClient;

    const article = makeTaggedArticle({
      title: "Parse",
      link: "https://example.com/parse",
    });

    const result = await new ArticleScorer({ client }).scoreArticles([article], ["AI"], []);

    expect(result.scoredArticles).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    const f = result.failures[0];
    expect(f?.articleTitle).toBe("Parse");
    expect(f?.articleLink).toBe("https://example.com/parse");
    expect(f?.reason).toBe("parse");
    expect(f?.attempts).toBe(1);
    expect(f?.error).toBeTruthy();
    // A parse failure does NOT retry — exactly one client call for this article.
    expect(chatFn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Consecutive reset on success
// ===========================================================================

describe("ArticleScorer — consecutive reset on success", () => {
  it("[fail(exception), success, fail(parse)] → resets after success; not halted; 2 failures; 1 scored", async () => {
    // Key the mock on the article TITLE embedded in the prompt.
    const SUCCESS_TITLE = "B";
    const client = makeMockClient(async (opts) => {
      const prompt = opts.messages[0]?.content ?? "";
      const title = extractTitle(prompt);
      if (title === SUCCESS_TITLE) {
        return okContent("9");
      }
      // A throws; C returns garbage (parse failure).
      if (title === "C") {
        return okContent("garbage");
      }
      throw new Error("fail");
    });

    const result = await runWithFakeTimers(
      new ArticleScorer({ client }).scoreArticles(
        [
          makeTaggedArticle({ title: "A" }),
          makeTaggedArticle({ title: "B" }),
          makeTaggedArticle({ title: "C" }),
        ],
        ["AI"],
        [],
      ),
    );

    expect(result.halted).toBe(false);
    expect(result.consecutiveErrors).toBe(1); // reset after B, then C failed once
    expect(result.failures).toHaveLength(2);
    expect(result.scoredArticles).toHaveLength(1);
    expect(result.scoredArticles[0]?.title).toBe("B");
  });
});

// ===========================================================================
// Halt at 3 consecutive exceptions
// ===========================================================================

describe("ArticleScorer — halt at 3 consecutive exceptions", () => {
  it("halts after 3 consecutive exceptions, leaving later articles unprocessed", async () => {
    const client = makeMockClient(async () => {
      throw new Error("always fails");
    });

    const articles = Array.from({ length: 5 }, (_, i) =>
      makeTaggedArticle({
        title: `A${i}`,
        link: `https://example.com/${i}`,
      }),
    );

    const result = await runWithFakeTimers(
      new ArticleScorer({ client }).scoreArticles(articles, ["AI"], []),
    );

    expect(result.halted).toBe(true);
    expect(result.haltReason).toBeTruthy();
    expect(result.failures).toHaveLength(3);
    for (const f of result.failures) {
      expect(f.reason).toBe("exception");
    }
    // Articles 4 and 5 (index 3, 4) NOT processed.
    expect(result.scoredArticles.some((a) => a.title === "A3")).toBe(false);
    expect(result.scoredArticles.some((a) => a.title === "A4")).toBe(false);
    expect(result.failures.some((f) => f.articleTitle === "A3")).toBe(false);
    expect(result.failures.some((f) => f.articleTitle === "A4")).toBe(false);
    expect(result.totalArticles).toBe(5);
  });
});

// ===========================================================================
// Halt at 3 consecutive parse failures
// ===========================================================================

describe("ArticleScorer — halt at 3 consecutive parse failures", () => {
  it("halts after 3 consecutive parse failures; failures all reason 'parse'; 4th+ unprocessed", async () => {
    const client = makeMockClient(async () => okContent("garbage"));

    const articles = Array.from({ length: 5 }, (_, i) =>
      makeTaggedArticle({
        title: `P${i}`,
        link: `https://example.com/${i}`,
      }),
    );

    const result = await new ArticleScorer({ client }).scoreArticles(articles, ["AI"], []);

    expect(result.halted).toBe(true);
    expect(result.failures).toHaveLength(3);
    for (const f of result.failures) {
      expect(f.reason).toBe("parse");
    }
    expect(result.scoredArticles.some((a) => a.title === "P3")).toBe(false);
    expect(result.failures.some((f) => f.articleTitle === "P3")).toBe(false);
  });
});

// ===========================================================================
// Per-article retry exhaustion counts once
// ===========================================================================

describe("ArticleScorer — per-article retry exhaustion counts once", () => {
  it("one failed article = one ScoreFailure with attempts reflecting withRetry (3 client calls)", async () => {
    const chatFn = vi.fn(async () => {
      throw new LLMNetworkError("nope");
    });
    const client = { chatCompletion: chatFn } as unknown as LLMClient;

    const result = await runWithFakeTimers(
      new ArticleScorer({ client }).scoreArticles(
        [makeTaggedArticle({ title: "Only", link: "https://example.com/only" })],
        ["AI"],
        [],
      ),
    );

    expect(result.failures).toHaveLength(1);
    const f = result.failures[0];
    expect(f?.articleTitle).toBe("Only");
    expect(f?.articleLink).toBe("https://example.com/only");
    expect(f?.reason).toBe("exception");
    expect(f?.error).toBeTruthy();
    // withRetry made DEFAULT_MAX_RETRIES (3) attempts for this one article.
    expect(f?.attempts).toBe(3);
    expect(chatFn).toHaveBeenCalledTimes(3);
  });
});

// ===========================================================================
// totalArticles / shape
// ===========================================================================

describe("ArticleScorer — totalArticles and shape", () => {
  it("totalArticles === input.length; not halted → scored + failures === input.length", async () => {
    const client = makeMockClient(async (opts) => {
      const title = extractTitle(opts.messages[0]?.content ?? "");
      if (title === "Fail") throw new Error("x");
      return okContent("5");
    });

    const result = await runWithFakeTimers(
      new ArticleScorer({ client }).scoreArticles(
        [
          makeTaggedArticle({ title: "Ok" }),
          makeTaggedArticle({ title: "Fail" }),
          makeTaggedArticle({ title: "Ok2" }),
        ],
        ["AI"],
        [],
      ),
    );

    expect(result.totalArticles).toBe(3);
    expect(result.halted).toBe(false);
    expect(result.haltReason).toBeNull();
    expect(result.scoredArticles.length + result.failures.length).toBe(3);
    expect(result.scoredArticles).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
  });
});

// ===========================================================================
// Empty input
// ===========================================================================

describe("ArticleScorer — empty input", () => {
  it("returns a well-formed empty ScoreResult", async () => {
    const client = makeMockClient(async () => okContent("7"));
    const result = await new ArticleScorer({ client }).scoreArticles([], ["AI"], []);
    expect(result).toEqual({
      scoredArticles: [],
      failures: [],
      halted: false,
      haltReason: null,
      consecutiveErrors: 0,
      totalArticles: 0,
    });
  });
});

// ===========================================================================
// Strict parse boundary (C1-20260630): empty / whitespace / hex / non-finite
// ===========================================================================

describe("ArticleScorer — strict parse boundary (C1)", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["hex literal", "0x10"],
    ["Infinity", "Infinity"],
    ["-Infinity", "-Infinity"],
    ["NaN literal", "NaN"],
  ])(
    "'%s' response ('%s') → ScoreFailure reason 'parse'; not in scoredArticles; client called once",
    async (_label, payload) => {
      const chatFn = vi.fn(async () => okContent(payload));
      const client = { chatCompletion: chatFn } as unknown as LLMClient;

      const result = await new ArticleScorer({ client }).scoreArticles(
        [makeTaggedArticle({ title: "Bogus", link: "https://example.com/bogus" })],
        ["AI"],
        [],
      );

      expect(result.scoredArticles).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
      const f = result.failures[0];
      expect(f?.reason).toBe("parse");
      expect(f?.attempts).toBe(1);
      expect(f?.articleTitle).toBe("Bogus");
      // Parse failure does NOT retry — exactly one client call.
      expect(chatFn).toHaveBeenCalledTimes(1);
    },
  );

  it("3 consecutive empty-response articles → ScoreResult.halted === true (parse failures trip the halt)", async () => {
    const client = makeMockClient(async () => okContent(""));
    const articles = Array.from({ length: 5 }, (_, i) =>
      makeTaggedArticle({ title: `E${i}`, link: `https://example.com/e${i}` }),
    );

    const result = await new ArticleScorer({ client }).scoreArticles(articles, ["AI"], []);

    expect(result.halted).toBe(true);
    expect(result.failures).toHaveLength(3);
    for (const f of result.failures) {
      expect(f.reason).toBe("parse");
    }
    // Articles 4 and 5 unprocessed.
    expect(result.failures.some((f) => f.articleTitle === "E3")).toBe(false);
    expect(result.scoredArticles.some((a) => a.title === "E3")).toBe(false);
  });

  it.each([
    ["plain integer", "7", 7],
    ["decimal", "8.5", 8.5],
    ["leading dot", ".5", 0.5],
    ["trailing dot", "8.", 8],
    ["scientific", "1e1", 10],
    ["signed negative", "-3.2", 0], // clamped to [0,10]
    ["signed positive", "+5", 5],
  ])(
    "'%s' response ('%s') still parses to %d (valid decimals accepted)",
    async (_label, payload, expected) => {
      const client = makeMockClient(async () => okContent(payload));
      const result = await new ArticleScorer({ client }).scoreArticles(
        [makeTaggedArticle()],
        ["AI"],
        [],
      );
      expect(result.scoredArticles).toHaveLength(1);
      expect(result.scoredArticles[0]?.score).toBe(expected);
      expect(result.failures).toHaveLength(0);
    },
  );
});

// ===========================================================================
// Prompt parity (C6-20260630): single-article and halt-loop paths share
// callLLM, so they must produce byte-identical prompts for the same input.
// ===========================================================================

describe("ArticleScorer — prompt parity between calculateScore and tryCalculateScore (C6)", () => {
  it("the single-article path and the halt-loop path send byte-identical prompts", async () => {
    const prompts: string[] = [];
    const client = makeMockClient(async (opts) => {
      prompts.push(opts.messages[0]?.content ?? "");
      return okContent("7");
    });

    const scorer = new ArticleScorer({ client });
    const title = "Parity Title";
    const tags = ["AI", "Cloud"];
    const topics = ["AI"];
    const disliked = ["Crypto"];

    // Single-article path (calculateScore → callLLM).
    await scorer.calculateScore(title, "ignored-body", tags, topics, disliked);
    // Halt-loop path (scoreArticles → tryCalculateScore → callLLM).
    await scorer.scoreArticles([makeTaggedArticle({ title, tags })], topics, disliked);

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe(prompts[1]);
  });
});

// ===========================================================================
// Standalone scoreArticles helper
// ===========================================================================

describe("standalone scoreArticles helper", () => {
  it("wraps new ArticleScorer(options).scoreArticles(...)", async () => {
    const client = makeMockClient(async () => okContent("6"));
    const result = await scoreArticles([makeTaggedArticle({ title: "Standalone" })], ["AI"], [], {
      client,
    });
    expect(result.totalArticles).toBe(1);
    expect(result.scoredArticles[0]?.score).toBe(6);
  });
});

// ===========================================================================
// O1-20260630: haltReason truncation + newline stripping (exception + parse)
// ===========================================================================

describe("ArticleScorer — haltReason truncation (O1-20260630)", () => {
  it("exception path: haltReason bounded to <=200 chars and newline-free for a long multi-line error", async () => {
    const longMsg =
      "x".repeat(100) + "\nbroken\n" + "y".repeat(100) + "\r\nmore\r" + "z".repeat(290);
    expect(longMsg.length).toBeGreaterThan(500);

    const client = makeMockClient(async () => {
      throw new Error(longMsg);
    });

    const articles = Array.from({ length: 5 }, (_, i) =>
      makeTaggedArticle({
        title: `A${i}`,
        link: `https://example.com/${i}`,
      }),
    );

    const result = await runWithFakeTimers(
      new ArticleScorer({ client }).scoreArticles(articles, ["AI"], []),
    );

    expect(result.halted).toBe(true);
    expect(result.haltReason).not.toBeNull();
    expect(result.haltReason!.length).toBeLessThanOrEqual(200);
    expect(result.haltReason).not.toContain("\n");
    expect(result.haltReason).not.toContain("\r");
  });

  it("parse path: haltReason bounded + newline-free; ScoreParseError.raw retains the FULL raw content", async () => {
    // 500-char non-numeric garbage with newlines → parse failure.
    const longRaw = "garbage-".repeat(60) + "\nmid\n" + "tail-".repeat(40);
    expect(longRaw.length).toBeGreaterThan(200);
    expect(longRaw).toContain("\n");

    const client = makeMockClient(async () => okContent(longRaw));

    const articles = Array.from({ length: 5 }, (_, i) =>
      makeTaggedArticle({
        title: `P${i}`,
        link: `https://example.com/${i}`,
      }),
    );

    const result = await new ArticleScorer({ client }).scoreArticles(articles, ["AI"], []);

    expect(result.halted).toBe(true);
    expect(result.haltReason).not.toBeNull();
    expect(result.haltReason!.length).toBeLessThanOrEqual(200);
    expect(result.haltReason).not.toContain("\n");
    expect(result.haltReason).not.toContain("\r");

    // ScoreParseError.raw (caught directly via calculateScore) retains the
    // FULL raw content — only the human-facing haltReason is bounded.
    expect.assertions(9);
    try {
      await new ArticleScorer({ client }).calculateScore("T", "C", [], ["AI"], []);
    } catch (e) {
      expect(e).toBeInstanceOf(ScoreParseError);
      expect((e as ScoreParseError).raw).toBe(longRaw);
    }
  });
});

// ===========================================================================
// Option injection (model / promptTemplate)
// ===========================================================================

describe("ArticleScorer — model and promptTemplate injection", () => {
  it("uses injected model and rendered promptTemplate for chatCompletion", async () => {
    let capturedModel = "";
    let capturedPrompt = "";
    const client = makeMockClient(async (opts) => {
      capturedModel = opts.model;
      capturedPrompt = opts.messages[0]?.content ?? "";
      return okContent("8");
    });

    await new ArticleScorer({
      client,
      model: "x/y",
      promptTemplate: "Topics:{topics}|Title:{title}",
    }).scoreArticles(
      [makeTaggedArticle({ title: "K8s 1.30", tags: ["k8s"] })],
      ["AI", "Cloud"],
      [],
    );

    expect(capturedModel).toBe("x/y");
    expect(capturedPrompt).toBe("Topics:AI, Cloud|Title:K8s 1.30");
  });
});
