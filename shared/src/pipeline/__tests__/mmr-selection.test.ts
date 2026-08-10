import { describe, it, expect, vi } from "vitest";

import type { EmbeddingsResult, LLMClient } from "../llm-client";
import type { ScoredArticle } from "../types";
import {
  buildEmbedText,
  selectDiverse,
  MMRSelector,
  DEFAULT_LAMBDA,
  EMBED_SNIPPET_LENGTH,
  EMBED_MAX_CONTENT_LENGTH,
} from "../mmr-selection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeArticle(title: string, score: number, content = "content"): ScoredArticle {
  return {
    title,
    link: `https://example.com/${encodeURIComponent(title)}`,
    published: new Date("2026-06-30T00:00:00Z"),
    content,
    source: "test",
    tags: ["test"],
    score,
  };
}

type EmbeddingsFn = (options: {
  model: string;
  input: string | string[];
  timeoutMs?: number;
}) => Promise<EmbeddingsResult>;

/** Minimal mock of LLMClient exposing only `embeddings` (the client boundary). */
function mockClient(embeddings: EmbeddingsFn): LLMClient {
  return { embeddings } as unknown as LLMClient;
}

// ===========================================================================
// buildEmbedText
// ===========================================================================

describe("mmr-selection — buildEmbedText", () => {
  it("slices content to EMBED_SNIPPET_LENGTH and prefixes the title", () => {
    const article = makeArticle("T", 9, "x".repeat(5000));
    expect(buildEmbedText(article)).toBe("T " + "x".repeat(1000));
  });

  it("caps the total length at EMBED_MAX_CONTENT_LENGTH", () => {
    expect(EMBED_SNIPPET_LENGTH).toBe(1000);
    expect(EMBED_MAX_CONTENT_LENGTH).toBe(8000);
    // The 1000-char snippet is well under the 8000 cap; the cap is a safety bound.
    const article = makeArticle("T", 9, "y".repeat(50_000));
    const text = buildEmbedText(article);
    expect(text).toBe("T " + "y".repeat(1000));
    expect(text.length).toBeLessThanOrEqual(EMBED_MAX_CONTENT_LENGTH);
  });
});

// ===========================================================================
// Threshold filter
// ===========================================================================

describe("mmr-selection — threshold filter", () => {
  it("excludes articles below minScore and records them as below-threshold failures", async () => {
    const articles = [
      makeArticle("a", 8),
      makeArticle("b", 7.5),
      makeArticle("c", 6),
      makeArticle("d", 9),
      makeArticle("e", 5),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: articles.map(() => [1, 0, 0]),
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      minScore: 7,
    }).selectDiverse(articles, 3);

    // Candidates passed threshold: scores 9, 8, 7.5 → candidateCount 3.
    expect(result.candidateCount).toBe(3);
    expect(result.totalArticles).toBe(5);
    const belowThresholdTitles = result.failures
      .filter((f) => f.reason === "below-threshold")
      .map((f) => f.articleTitle)
      .sort();
    expect(belowThresholdTitles).toEqual(["c", "e"]);
  });

  it("includes an article whose score is exactly equal to minScore (>= boundary)", async () => {
    const articles = [
      makeArticle("a", 9),
      makeArticle("b", 7), // score === minScore (7)
      makeArticle("c", 6),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: articles.map(() => [1, 0, 0]),
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      minScore: 7,
    }).selectDiverse(articles, 2);

    // The boundary article must pass the threshold, not be a below-threshold failure.
    expect(result.candidateCount).toBe(2);
    const belowThresholdTitles = result.failures
      .filter((f) => f.reason === "below-threshold")
      .map((f) => f.articleTitle);
    expect(belowThresholdTitles).not.toContain("b");
    expect(belowThresholdTitles).toEqual(["c"]);
  });
});

// ===========================================================================
// First-pick = highest score
// ===========================================================================

describe("mmr-selection — first pick", () => {
  it("selects the highest-scored candidate first", async () => {
    const articles = [makeArticle("a", 8), makeArticle("b", 9), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles[0]?.title).toBe("b");
  });
});

// ===========================================================================
// Count <= target and <= pool
// ===========================================================================

describe("mmr-selection — selection count", () => {
  it("selects exactly `target` when pool >= target", async () => {
    const articles = [
      makeArticle("a", 9),
      makeArticle("b", 8),
      makeArticle("c", 7.5),
      makeArticle("d", 7),
      makeArticle("e", 7.1),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: articles.map(() => [1, 0, 0]),
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);
    expect(result.selectedArticles).toHaveLength(3);
  });

  it("never selects more than the pool", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: articles.map(() => [1, 0, 0]),
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 5);
    expect(result.selectedArticles).toHaveLength(3);
  });
});

// ===========================================================================
// lambda = 0 → pure relevance (top-N by score)
// ===========================================================================

describe("mmr-selection — lambda=0 collapses to pure relevance", () => {
  it("selects the top-N-by-score set in score order", async () => {
    const articles = [
      makeArticle("a", 9),
      makeArticle("b", 8.5),
      makeArticle("c", 8),
      makeArticle("d", 7.5),
    ];
    // Distinct embeddings so MMR could differ — but lambda=0 ignores diversity.
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 1, 0],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      lambda: 0,
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles.map((a) => a.title)).toEqual(["a", "b", "c"]);
  });
});

// ===========================================================================
// lambda = 0.5 → observably more diverse than naive top-N
// ===========================================================================

describe("mmr-selection — lambda=0.5 favors diversity", () => {
  it("includes the orthogonal 4th candidate over a redundant top-3 member", async () => {
    // Top-3 by score share near-identical embeddings (cosine ≈ 1); 4th (lower
    // score) has an orthogonal embedding.
    const articles = [
      makeArticle("same1", 9),
      makeArticle("same2", 8.8),
      makeArticle("same3", 8.6),
      makeArticle("distinct", 8.4),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0],
        [0.999, 0.001],
        [0.998, 0.002],
        [0, 1],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      lambda: 0.5,
    }).selectDiverse(articles, 3);

    const titles = result.selectedArticles.map((a) => a.title);
    // The distinct candidate must be selected (diverse set differs from top-3).
    expect(titles).toContain("distinct");
  });
});

// ===========================================================================
// Batch embedding called exactly once with all candidate texts
// ===========================================================================

describe("mmr-selection — batch embedding call", () => {
  it("calls client.embeddings exactly once with buildEmbedText of each candidate in order", async () => {
    const articles = [
      makeArticle("a", 9, "alpha"),
      makeArticle("b", 8, "beta"),
      makeArticle("c", 7.5, "gamma"),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: articles.map(() => [1, 0, 0]),
      raw: {},
    }));
    await new MMRSelector({ client: mockClient(embeddings) }).selectDiverse(articles, 3);

    expect(embeddings).toHaveBeenCalledTimes(1);
    const calls = embeddings.mock.calls as Array<
      Array<{ model: string; input: string | string[]; timeoutMs?: number }>
    >;
    const callArg = calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(Array.isArray(callArg!.input)).toBe(true);
    expect(callArg!.input).toHaveLength(3);
    expect(callArg!.input).toEqual(articles.map(buildEmbedText));
  });
});

// ===========================================================================
// Batch embedding failure (throw) → atomic, every candidate embedding-failed
// ===========================================================================

describe("mmr-selection — batch embedding failure", () => {
  it("records every candidate as embedding-failed when embeddings throws", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => {
      throw new Error("boom");
    });
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.reason === "embedding-failed")).toBe(true);
    expect(result.failures.every((f) => typeof f.error === "string")).toBe(true);
  });

  it("records every candidate as embedding-failed when embeddings returns a wrong-length payload", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      // 3 candidates, only 2 embeddings returned → shape mismatch.
      embeddings: [
        [1, 0],
        [0, 1],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.reason === "embedding-failed")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // C2: non-finite embedding elements must fail the batch atomically.
  // -------------------------------------------------------------------------

  it("fails atomically when an embedding contains a NaN element", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0],
        [NaN, 0],
        [0, 1],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.reason === "embedding-failed")).toBe(true);
    expect(result.failures.every((f) => typeof f.error === "string")).toBe(true);
  });

  it("fails atomically when an embedding contains an Infinity element", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0],
        [Infinity, 0],
        [0, 1],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.reason === "embedding-failed")).toBe(true);
  });

  it("fails atomically when an embedding contains a null element", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0],
        [null, 0],
        [0, 1],
      ] as unknown as number[][],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.reason === "embedding-failed")).toBe(true);
  });

  it("fails atomically when an embedding row is not an array", async () => {
    const articles = [makeArticle("a", 9), makeArticle("b", 8), makeArticle("c", 7.5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [[1, 0], "not-an-array" as unknown as number[], [0, 1]],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse(articles, 3);

    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.every((f) => f.reason === "embedding-failed")).toBe(true);
  });
});

// ===========================================================================
// No embeddings call when input empty or all below threshold
// ===========================================================================

describe("mmr-selection — skips embeddings call", () => {
  it("does not call embeddings on empty input", async () => {
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({ embeddings: [], raw: {} }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
    }).selectDiverse([], 3);

    expect(embeddings).not.toHaveBeenCalled();
    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.totalArticles).toBe(0);
    expect(result.candidateCount).toBe(0);
    expect(result.targetCount).toBe(3);
  });

  it("does not call embeddings when all articles are below threshold", async () => {
    const articles = [makeArticle("a", 4), makeArticle("b", 5)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({ embeddings: [], raw: {} }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      minScore: 7,
    }).selectDiverse(articles, 3);

    expect(embeddings).not.toHaveBeenCalled();
    expect(result.selectedArticles).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((f) => f.reason === "below-threshold")).toBe(true);
  });
});

// ===========================================================================
// Shape invariants
// ===========================================================================

describe("mmr-selection — shape invariants", () => {
  it("echoes config and preserves the selected + failures partition when target >= candidateCount (trivial case)", async () => {
    const articles = [
      makeArticle("a", 9),
      makeArticle("b", 8),
      makeArticle("c", 6),
      makeArticle("d", 5),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      lambda: 0.5,
      minScore: 7,
    }).selectDiverse(articles, 2);

    expect(result.totalArticles).toBe(articles.length);
    expect(result.selectedArticles.length + result.failures.length).toBe(articles.length);
    expect(result.candidateCount).toBe(articles.filter((a) => a.score >= 7).length);
    expect(result.targetCount).toBe(2);
    expect(result.lambda).toBe(0.5);
    expect(result.minScore).toBe(7);
  });

  // -------------------------------------------------------------------------
  // N4 / C7: when target < candidateCount, every non-selected candidate must
  // be recorded as `reason: 'not-selected'`, so the universal invariant
  // `selectedArticles.length + failures.length === totalArticles` holds.
  // -------------------------------------------------------------------------

  it("records non-selected candidates as 'not-selected' when target < candidateCount (N4 invariant)", async () => {
    // 4 candidates above threshold (scores >= 7), target 2 → 2 selected,
    // 2 not-selected. Plus 2 below-threshold → totalArticles 6.
    const articles = [
      makeArticle("a", 9),
      makeArticle("b", 8),
      makeArticle("c", 7.5),
      makeArticle("d", 7),
      makeArticle("e", 6),
      makeArticle("f", 5),
    ];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 1, 0],
      ],
      raw: {},
    }));
    const result = await new MMRSelector({
      client: mockClient(embeddings),
      lambda: 0.5,
      minScore: 7,
    }).selectDiverse(articles, 2);

    // Exactly target selected.
    expect(result.selectedArticles).toHaveLength(2);
    expect(result.candidateCount).toBe(4);

    // Failures partition: 2 below-threshold + 2 not-selected.
    const notSelected = result.failures.filter((f) => f.reason === "not-selected");
    const belowThreshold = result.failures.filter((f) => f.reason === "below-threshold");
    expect(notSelected).toHaveLength(2);
    expect(belowThreshold).toHaveLength(2);
    expect(notSelected.every((f) => typeof f.error === "string")).toBe(true);

    // The not-selected failures must reference candidates (scores >= 7), not
    // the below-threshold ones.
    const candidateTitles = new Set(["a", "b", "c", "d"]);
    for (const f of notSelected) {
      expect(candidateTitles.has(f.articleTitle)).toBe(true);
    }

    // Universal invariant: every input article is in exactly one bucket.
    expect(result.selectedArticles.length + result.failures.length).toBe(articles.length);
    expect(result.selectedArticles.length + result.failures.length).toBe(result.totalArticles);
  });
});

// ===========================================================================
// Standalone selectDiverse helper
// ===========================================================================

describe("mmr-selection — standalone selectDiverse helper", () => {
  it("wraps new MMRSelector().selectDiverse and applies DEFAULT_LAMBDA", async () => {
    const articles = [makeArticle("a", 9)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [[1, 0, 0]],
      raw: {},
    }));
    const result = await selectDiverse(articles, 1, {
      client: mockClient(embeddings),
    });
    expect(DEFAULT_LAMBDA).toBe(0.5);
    expect(result.lambda).toBe(0.5);
    expect(result.selectedArticles[0]?.title).toBe("a");
  });
});

// ===========================================================================
// Option injection (model)
// ===========================================================================

describe("mmr-selection — model injection", () => {
  it("passes injected model to embeddings", async () => {
    const articles = [makeArticle("a", 9)];
    const embeddings = vi.fn(async (): Promise<EmbeddingsResult> => ({
      embeddings: [[1, 0, 0]],
      raw: {},
    }));

    await new MMRSelector({
      client: mockClient(embeddings),
      model: "embed/custom",
    }).selectDiverse(articles, 1);

    expect(embeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: "embed/custom" }),
    );
  });
});
