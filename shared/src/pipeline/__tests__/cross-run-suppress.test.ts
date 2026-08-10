import { describe, it, expect, vi } from "vitest";

import { buildTopicEmbedText, suppressCrossRunTopics } from "../cross-run-suppress";
import { DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD } from "../config";
import type { ScoredArticle } from "../types";
import type { LookbackTopic } from "../../runs/lookback-topics";
import type { LLMClient } from "../llm-client";

function scoredArticle(
  over: Partial<ScoredArticle> & { title: string; link: string },
): ScoredArticle {
  return {
    title: over.title,
    link: over.link,
    published: over.published ?? new Date("2026-01-01T00:00:00Z"),
    content: over.content ?? "body",
    source: over.source ?? "src",
    tags: over.tags ?? [],
    score: over.score ?? 8,
  };
}

function lookbackTopic(
  over: Partial<LookbackTopic> & { title: string; runId: string },
): LookbackTopic {
  return {
    title: over.title,
    tags: over.tags ?? [],
    runId: over.runId,
    runEndedAt: over.runEndedAt ?? null,
    runStartedAt: over.runStartedAt ?? "2026-01-01T00:00:00Z",
  };
}

function makeEmbedClientByText(map: Record<string, number[]>): LLMClient {
  const stub = {
    embeddings: async ({ input }: { model: string; input: string[] }) => ({
      embeddings: input.map((t) => map[t] ?? [0, 0, 0]),
      raw: null,
    }),
  };
  return stub as unknown as LLMClient;
}

function makeRejectingEmbedClient(): LLMClient {
  const stub = {
    embeddings: async () => {
      throw new Error("embeddings boom");
    },
  };
  return stub as unknown as LLMClient;
}

function makeMalformedEmbedClient(payload: unknown): LLMClient {
  const stub = {
    embeddings: async () => ({ embeddings: payload as never, raw: null }),
  };
  return stub as unknown as LLMClient;
}

describe("buildTopicEmbedText", () => {
  it("joins title and tags with a single space", () => {
    expect(buildTopicEmbedText({ title: "AI Chips", tags: ["ai", "hardware"] })).toBe(
      "AI Chips ai hardware",
    );
  });

  it("returns just the title when tags is empty", () => {
    expect(buildTopicEmbedText({ title: "Solo", tags: [] })).toBe("Solo");
  });
});

describe("suppressCrossRunTopics", () => {
  it("empty lookback is a no-op and does not call embeddings", async () => {
    const embeddingsSpy = vi.fn(async ({ input }: { model: string; input: string[] }) => ({
      embeddings: input.map(() => [1, 0, 0]),
      raw: null,
    }));
    const client = { embeddings: embeddingsSpy } as unknown as LLMClient;

    const candidates = [
      scoredArticle({ title: "AI Chips", link: "la", tags: ["ai"] }),
      scoredArticle({ title: "Climate", link: "lb", tags: ["climate"] }),
    ];

    const result = await suppressCrossRunTopics(candidates, [], { client });

    expect(result.remaining).toHaveLength(candidates.length);
    expect(result.remaining.map((a: ScoredArticle) => a.link).sort()).toEqual(
      candidates.map((a) => a.link).sort(),
    );
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
    expect(embeddingsSpy).not.toHaveBeenCalled();
  });

  it("empty candidates is a no-op and does not call embeddings (non-empty lookback)", async () => {
    const embeddingsSpy = vi.fn(async ({ input }: { model: string; input: string[] }) => ({
      embeddings: input.map(() => [1, 0, 0]),
      raw: null,
    }));
    const client = { embeddings: embeddingsSpy } as unknown as LLMClient;

    const lookback = [lookbackTopic({ title: "Past AI Chips", tags: ["ai"], runId: "R1" })];

    const result = await suppressCrossRunTopics([], lookback, { client });

    expect(result.remaining).toHaveLength(0);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
    expect(embeddingsSpy).not.toHaveBeenCalled();
  });

  it("similarity >= threshold drops the candidate and records it", async () => {
    const matchCandidateText = "AI Chips ai hardware";
    const otherCandidateText = "Climate climate";
    const matchLookbackText = "Past AI Chips Discussion ai hardware";

    const client = makeEmbedClientByText({
      [matchCandidateText]: [1, 0, 0],
      [matchLookbackText]: [1, 0, 0],
      [otherCandidateText]: [0, 1, 0],
    });

    const candidateMatch = scoredArticle({
      title: "AI Chips",
      link: "la",
      tags: ["ai", "hardware"],
    });
    const candidateOther = scoredArticle({
      title: "Climate",
      link: "lb",
      tags: ["climate"],
    });
    const lookback = [
      lookbackTopic({
        title: "Past AI Chips Discussion",
        tags: ["ai", "hardware"],
        runId: "R1",
      }),
    ];

    const result = await suppressCrossRunTopics([candidateMatch, candidateOther], lookback, {
      client,
      threshold: DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
    });

    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].link).toBe("lb");

    expect(result.summary.count).toBe(1);
    expect(result.summary.items).toHaveLength(1);
    expect(result.summary.count).toBe(result.summary.items.length);

    const item = result.summary.items[0];
    expect(item.title).toBe("AI Chips");
    expect(item.link).toBe("la");
    expect(item.matchedRunId).toBe("R1");
    expect(item.matchedTitle).toBe("Past AI Chips Discussion");
    expect(item.similarity).toBeCloseTo(1.0, 5);
  });

  it("similarity below threshold keeps the candidate", async () => {
    const candidateText = "AI Chips ai hardware";
    const lookbackText = "Climate Policy climate";

    const client = makeEmbedClientByText({
      [candidateText]: [1, 0, 0],
      [lookbackText]: [0, 1, 0],
    });

    const candidate = scoredArticle({
      title: "AI Chips",
      link: "la",
      tags: ["ai", "hardware"],
    });
    const lookback = [
      lookbackTopic({
        title: "Climate Policy",
        tags: ["climate"],
        runId: "R1",
      }),
    ];

    const result = await suppressCrossRunTopics([candidate], lookback, {
      client,
    });

    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].link).toBe("la");
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });

  it("tie on similarity resolves to the first flattened lookback topic", async () => {
    const candidateText = "AI Chips ai";
    const firstText = "First ai";
    const secondText = "Second ai";

    const client = makeEmbedClientByText({
      [candidateText]: [1, 0, 0],
      [firstText]: [1, 0, 0],
      [secondText]: [1, 0, 0],
    });

    const candidate = scoredArticle({
      title: "AI Chips",
      link: "la",
      tags: ["ai"],
    });
    const lookback = [
      lookbackTopic({ title: "First", tags: ["ai"], runId: "R1" }),
      lookbackTopic({ title: "Second", tags: ["ai"], runId: "R2" }),
    ];

    const result = await suppressCrossRunTopics([candidate], lookback, {
      client,
    });

    expect(result.remaining).toHaveLength(0);
    expect(result.summary.count).toBe(1);
    expect(result.summary.items).toHaveLength(1);

    const item = result.summary.items[0];
    expect(item.matchedRunId).toBe("R1");
    expect(item.matchedTitle).toBe("First");
  });

  it("embeddings throwing is a no-op suppress (does not throw)", async () => {
    const client = makeRejectingEmbedClient();

    const candidate = scoredArticle({
      title: "AI Chips",
      link: "la",
      tags: ["ai", "hardware"],
    });
    const lookback = [
      lookbackTopic({
        title: "AI Chips",
        tags: ["ai", "hardware"],
        runId: "R1",
      }),
    ];

    const result = await suppressCrossRunTopics([candidate], lookback, {
      client,
    });

    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]).toEqual(candidate);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });
});

describe("assertEmbeddings malformed response guards", () => {
  const twoLookback = [
    lookbackTopic({
      title: "Past AI Chips",
      tags: ["ai", "hardware"],
      runId: "R1",
    }),
    lookbackTopic({
      title: "Past Climate",
      tags: ["climate"],
      runId: "R2",
    }),
  ];
  const twoCandidates = [
    scoredArticle({
      title: "AI Chips",
      link: "la",
      tags: ["ai", "hardware"],
    }),
    scoredArticle({ title: "Climate", link: "lb", tags: ["climate"] }),
  ];
  const oneLookback = [twoLookback[0]];
  const oneCandidate = [twoCandidates[0]];

  it("non-array top-level embeddings payload triggers noOp (defensive)", async () => {
    const client = makeMalformedEmbedClient("wrong");

    const result = await suppressCrossRunTopics(twoCandidates, twoLookback, {
      client,
    });

    expect(result.remaining).toEqual(twoCandidates);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });

  it("length-mismatch embeddings payload triggers noOp (defensive)", async () => {
    const client = makeMalformedEmbedClient([[1, 0, 0]]);

    const result = await suppressCrossRunTopics(twoCandidates, twoLookback, {
      client,
    });

    expect(result.remaining).toEqual(twoCandidates);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });

  it("non-array element in embeddings payload triggers noOp (defensive)", async () => {
    const client = makeMalformedEmbedClient([[1, 0], "x"]);

    const result = await suppressCrossRunTopics(twoCandidates, twoLookback, {
      client,
    });

    expect(result.remaining).toEqual(twoCandidates);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });

  it("NaN element in embeddings payload triggers noOp (defensive)", async () => {
    const client = makeMalformedEmbedClient([[1, 0, NaN]]);

    const result = await suppressCrossRunTopics(oneCandidate, oneLookback, {
      client,
    });

    expect(result.remaining).toEqual(oneCandidate);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });

  it("Infinity element in embeddings payload triggers noOp (defensive)", async () => {
    const client = makeMalformedEmbedClient([[1, 0, Infinity]]);

    const result = await suppressCrossRunTopics(oneCandidate, oneLookback, {
      client,
    });

    expect(result.remaining).toEqual(oneCandidate);
    expect(result.summary.count).toBe(0);
    expect(result.summary.items).toHaveLength(0);
  });
});
