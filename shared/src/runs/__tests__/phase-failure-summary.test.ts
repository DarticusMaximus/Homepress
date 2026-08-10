import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
  storage: null as unknown,
  uniqueId: "file-unique-id",
}));

vi.mock("node-appwrite", async (importActual) => {
  const actual = await importActual<typeof import("node-appwrite")>();
  return {
    ...actual,
    ID: {
      ...actual.ID,
      unique: () => mockHolder.uniqueId,
    },
    Databases: class MockDatabasesConstructor {
      constructor() {
        return mockHolder.databases as unknown as MockDatabasesConstructor;
      }
    },
    Storage: class MockStorageConstructor {
      constructor() {
        return mockHolder.storage as unknown as MockStorageConstructor;
      }
    },
  };
});

import { savePhaseCheckpoint, loadPhaseCheckpoint } from "../repository";
import {
  RunRepositoryError,
  type PhaseFailureSummaryJson,
  type TagCheckpoint,
  type ScoreCheckpoint,
} from "../types";
import type { TagResult, ScoreResult, SelectionFailure } from "../../pipeline/types";
import type { SuppressSummary } from "../../pipeline/cross-run-suppress";
import {
  PHASE_FAILURE_SAMPLE_MAX,
  FAILURE_MESSAGE_SAMPLE_MAX,
  FAILURE_MESSAGE_MAX,
  buildPhaseFailureSummary,
  buildHaltFailureMessage,
  buildEmptySelectionFailureMessage,
  buildFullSuppressFailureMessage,
} from "../phase-failure-summary";
import { MockRunsDatabases, MockStorage, fakeClient, mockRunDocument } from "./mock-client";

function expectRepoError(
  promise: Promise<unknown>,
  code: RunRepositoryError["code"],
): Promise<RunRepositoryError> {
  return promise.then(
    () => {
      throw new Error(`Expected RunRepositoryError with code ${code}`);
    },
    (err) => {
      expect(err).toBeInstanceOf(RunRepositoryError);
      const repoErr = err as RunRepositoryError;
      expect(repoErr.code).toBe(code);
      return repoErr;
    },
  );
}

const ISO_DATE = "2024-01-15T10:30:00Z";

function baseArticle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Some headline",
    link: "https://example.com/a",
    published: ISO_DATE,
    content: "Body text",
    source: "example.com",
    ...overrides,
  };
}

const tagPhaseFailure: PhaseFailureSummaryJson = {
  halted: true,
  haltReason: "3 consecutive tagging errors",
  consecutiveErrors: 3,
  totalArticles: 12,
  failureCount: 5,
  failures: [
    {
      articleTitle: "Broken A",
      articleLink: "https://example.com/a",
      error: "timeout",
      attempts: 3,
    },
    {
      articleTitle: "Broken B",
      articleLink: "https://example.com/b",
      error: "rate limited",
      attempts: 2,
    },
  ],
};

const scorePhaseFailure: PhaseFailureSummaryJson = {
  halted: true,
  haltReason: null,
  consecutiveErrors: 3,
  totalArticles: 8,
  failureCount: 4,
  failures: [
    {
      articleTitle: "Score fail",
      articleLink: "https://example.com/score-fail",
      error: "parse error",
      attempts: 3,
      reason: "parse",
    },
    {
      articleTitle: "Score boom",
      articleLink: "https://example.com/score-boom",
      error: "provider down",
      attempts: 1,
      reason: "exception",
    },
  ],
};

describe("phase-failure checkpoint ser/de", () => {
  let docs: MockRunsDatabases;
  let storage: MockStorage;
  let client: Client;
  const runId = "run-phase-failure";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    storage = new MockStorage();
    mockHolder.databases = docs;
    mockHolder.storage = storage;
    mockHolder.uniqueId = "file-unique-id";
    client = fakeClient();
  });

  it("tag: round-trips phaseFailure with tagged articles", async () => {
    await savePhaseCheckpoint(client, runId, "tag", {
      taggedArticles: [{ ...baseArticle(), tags: ["ai"] }],
      phaseFailure: tagPhaseFailure,
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content) as {
      taggedArticles: unknown[];
      phaseFailure?: PhaseFailureSummaryJson;
    };
    expect(stored.phaseFailure).toEqual(tagPhaseFailure);
    expect(stored.taggedArticles).toHaveLength(1);

    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointTagId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "tag")) as TagCheckpoint;
    expect(loaded.taggedArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.phaseFailure).toEqual(tagPhaseFailure);
  });

  it("tag: success write omits phaseFailure key; load leaves it undefined", async () => {
    await savePhaseCheckpoint(client, runId, "tag", {
      taggedArticles: [{ ...baseArticle(), tags: ["research"] }],
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content) as Record<
      string,
      unknown
    >;
    expect(stored).not.toHaveProperty("phaseFailure");

    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointTagId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "tag")) as TagCheckpoint;
    expect(loaded.phaseFailure).toBeUndefined();
  });

  it("tag: legacy JSON without phaseFailure key loads with phaseFailure undefined", async () => {
    storage.files.set("file-legacy-tag", {
      name: "run-chk-tag.json",
      content: JSON.stringify({
        taggedArticles: [{ ...baseArticle(), tags: ["legacy"] }],
      }),
    });
    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointTagId: "file-legacy-tag" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "tag")) as TagCheckpoint;
    expect(loaded.taggedArticles).toHaveLength(1);
    expect(loaded.taggedArticles[0]!.tags).toEqual(["legacy"]);
    expect(loaded.phaseFailure).toBeUndefined();
  });

  it("score: round-trips phaseFailure (including reason) and strips embedding", async () => {
    await savePhaseCheckpoint(client, runId, "score", {
      scoredArticles: [
        {
          ...baseArticle(),
          tags: ["ai"],
          score: 0.5,
          embedding: [0.1, 0.2],
        } as unknown as never,
      ],
      phaseFailure: scorePhaseFailure,
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content) as {
      scoredArticles: { embedding?: number[]; score: number }[];
      phaseFailure?: PhaseFailureSummaryJson;
    };
    expect(stored.phaseFailure).toEqual(scorePhaseFailure);
    expect(stored.scoredArticles[0]).not.toHaveProperty("embedding");
    expect(stored.scoredArticles[0]!.score).toBe(0.5);

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointScoreId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "score")) as ScoreCheckpoint;
    expect(loaded.scoredArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.scoredArticles[0]).not.toHaveProperty("embedding");
    expect(loaded.phaseFailure).toEqual(scorePhaseFailure);
    expect(loaded.phaseFailure!.failures[0]!.reason).toBe("parse");
    expect(loaded.phaseFailure!.failures[1]!.reason).toBe("exception");
  });

  it("score: success write omits phaseFailure key; load leaves it undefined", async () => {
    await savePhaseCheckpoint(client, runId, "score", {
      scoredArticles: [{ ...baseArticle(), tags: ["ok"], score: 0.9 }],
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content) as Record<
      string,
      unknown
    >;
    expect(stored).not.toHaveProperty("phaseFailure");

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointScoreId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "score")) as ScoreCheckpoint;
    expect(loaded.phaseFailure).toBeUndefined();
  });

  it("score: legacy JSON without phaseFailure key loads with phaseFailure undefined", async () => {
    storage.files.set("file-legacy-score", {
      name: "run-chk-score.json",
      content: JSON.stringify({
        scoredArticles: [{ ...baseArticle(), tags: ["legacy"], score: 0.42 }],
      }),
    });
    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointScoreId: "file-legacy-score" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "score")) as ScoreCheckpoint;
    expect(loaded.scoredArticles).toHaveLength(1);
    expect(loaded.scoredArticles[0]!.score).toBe(0.42);
    expect(loaded.phaseFailure).toBeUndefined();
  });

  // C1: poison phaseFailure must map to checkpoint_missing (never reach Inspect).
  it.each([
    {
      label: "halted true only (missing required fields)",
      phaseFailure: { halted: true },
    },
    {
      label: "failures null",
      phaseFailure: {
        halted: true,
        haltReason: null,
        consecutiveErrors: 0,
        totalArticles: 1,
        failureCount: 0,
        failures: null,
      },
    },
    {
      label: "failures string",
      phaseFailure: {
        halted: true,
        haltReason: "oops",
        consecutiveErrors: 1,
        totalArticles: 1,
        failureCount: 1,
        failures: "oops",
      },
    },
  ] as const)(
    "tag: throws checkpoint_missing for malformed phaseFailure ($label)",
    async ({ phaseFailure }) => {
      storage.files.set("file-malformed-pf", {
        name: "run-chk-tag.json",
        content: JSON.stringify({
          taggedArticles: [{ ...baseArticle(), tags: ["ai"] }],
          phaseFailure,
        }),
      });
      docs.getDocumentImpl = () =>
        mockRunDocument({ $id: runId, checkpointTagId: "file-malformed-pf" });

      const err = await expectRepoError(
        loadPhaseCheckpoint(client, runId, "tag"),
        "checkpoint_missing",
      );
      expect(err.message).toContain("corrupted");
      expect(err.message).toContain("tag");
    },
  );

  it.each([
    {
      label: "halted true only (missing required fields)",
      phaseFailure: { halted: true },
    },
    {
      label: "failures null",
      phaseFailure: {
        halted: true,
        haltReason: null,
        consecutiveErrors: 0,
        totalArticles: 1,
        failureCount: 0,
        failures: null,
      },
    },
    {
      label: "failures string",
      phaseFailure: {
        halted: true,
        haltReason: "oops",
        consecutiveErrors: 1,
        totalArticles: 1,
        failureCount: 1,
        failures: "oops",
      },
    },
  ] as const)(
    "score: throws checkpoint_missing for malformed phaseFailure ($label)",
    async ({ phaseFailure }) => {
      storage.files.set("file-malformed-pf-score", {
        name: "run-chk-score.json",
        content: JSON.stringify({
          scoredArticles: [{ ...baseArticle(), tags: ["ai"], score: 0.5 }],
          phaseFailure,
        }),
      });
      docs.getDocumentImpl = () =>
        mockRunDocument({ $id: runId, checkpointScoreId: "file-malformed-pf-score" });

      const err = await expectRepoError(
        loadPhaseCheckpoint(client, runId, "score"),
        "checkpoint_missing",
      );
      expect(err.message).toContain("corrupted");
      expect(err.message).toContain("score");
    },
  );
});

function makeTagResult(overrides: Partial<TagResult> & { failureCount?: number }): TagResult {
  const failureCount = overrides.failureCount ?? overrides.failures?.length ?? 0;
  const failures =
    overrides.failures ??
    Array.from({ length: failureCount }, (_, i) => ({
      articleTitle: `Tag fail ${i}`,
      articleLink: `https://example.com/tag-${i}`,
      error: `tag error ${i}`,
      attempts: 2,
    }));
  return {
    taggedArticles: overrides.taggedArticles ?? [],
    failures,
    halted: overrides.halted ?? true,
    haltReason: overrides.haltReason !== undefined ? overrides.haltReason : "3 consecutive tagging errors",
    consecutiveErrors: overrides.consecutiveErrors ?? 3,
    totalArticles: overrides.totalArticles ?? 40,
  };
}

function makeScoreResult(
  overrides: Partial<ScoreResult> & { failureCount?: number },
): ScoreResult {
  const failureCount = overrides.failureCount ?? overrides.failures?.length ?? 0;
  const failures =
    overrides.failures ??
    Array.from({ length: failureCount }, (_, i) => ({
      articleTitle: `Score fail ${i}`,
      articleLink: `https://example.com/score-${i}`,
      error: `score error ${i}`,
      attempts: 1,
      reason: (i % 2 === 0 ? "parse" : "exception") as "parse" | "exception",
    }));
  return {
    scoredArticles: overrides.scoredArticles ?? [],
    failures,
    halted: overrides.halted ?? true,
    haltReason: overrides.haltReason !== undefined ? overrides.haltReason : null,
    consecutiveErrors: overrides.consecutiveErrors ?? 3,
    totalArticles: overrides.totalArticles ?? 20,
  };
}

describe("phase-failure summary formatters", () => {
  it("caps phaseFailure.failures at 10 while failureCount reflects full length", () => {
    expect(PHASE_FAILURE_SAMPLE_MAX).toBe(10);
    const result = makeTagResult({ failureCount: 15, totalArticles: 40 });
    const summary = buildPhaseFailureSummary(result);

    expect(summary.halted).toBe(true);
    expect(summary.failureCount).toBe(15);
    expect(summary.failures).toHaveLength(10);
    expect(summary.failures[0]!.articleTitle).toBe("Tag fail 0");
    expect(summary.failures[9]!.articleTitle).toBe("Tag fail 9");
    expect(summary.totalArticles).toBe(40);
    expect(summary.consecutiveErrors).toBe(3);
    expect(summary.haltReason).toBe("3 consecutive tagging errors");
  });

  it("includes score reason on phaseFailure samples and omits it for tag", () => {
    const tagSummary = buildPhaseFailureSummary(
      makeTagResult({
        failures: [
          {
            articleTitle: "T",
            articleLink: "https://example.com/t",
            error: "boom",
            attempts: 3,
          },
        ],
      }),
    );
    expect(tagSummary.failures[0]).not.toHaveProperty("reason");

    const scoreSummary = buildPhaseFailureSummary(
      makeScoreResult({
        failures: [
          {
            articleTitle: "S",
            articleLink: "https://example.com/s",
            error: "bad json",
            attempts: 1,
            reason: "parse",
          },
        ],
      }),
    );
    expect(scoreSummary.failures[0]!.reason).toBe("parse");
  });

  it("halt failureMessage includes required fields, ≤3 samples, and ≤2000 chars", () => {
    expect(FAILURE_MESSAGE_SAMPLE_MAX).toBe(3);
    expect(FAILURE_MESSAGE_MAX).toBe(2000);

    const summary = buildPhaseFailureSummary(
      makeTagResult({
        haltReason: "3 consecutive tagging errors",
        consecutiveErrors: 3,
        totalArticles: 40,
        failureCount: 5,
      }),
    );
    const message = buildHaltFailureMessage("tag", summary);

    expect(message).toMatch(/Tagging halted/i);
    expect(message).toContain("3 consecutive tagging errors");
    expect(message).toContain("Consecutive errors: 3");
    expect(message).toMatch(/Failures:\s*5\/40/);
    expect(message).toContain("Tag fail 0");
    expect(message).toContain("Tag fail 1");
    expect(message).toContain("Tag fail 2");
    expect(message).not.toContain("Tag fail 3");
    expect(message.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX);

    const scoreSummary = buildPhaseFailureSummary(
      makeScoreResult({
        haltReason: null,
        consecutiveErrors: 3,
        totalArticles: 8,
        failureCount: 4,
      }),
    );
    const scoreMessage = buildHaltFailureMessage("score", scoreSummary);
    expect(scoreMessage).toMatch(/Scoring halted/i);
    expect(scoreMessage).toContain("Consecutive errors: 3");
    expect(scoreMessage).toMatch(/Failures:\s*4\/8/);
    expect(scoreMessage.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX);
  });

  it("redacts and bounds per-article error strings in phaseFailure and messages", () => {
    const secretError =
      "provider failed with sk-abcdefghijklmnopqrstuvwxyz123456 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload";
    const result = makeTagResult({
      failures: [
        {
          articleTitle: "Secret article",
          articleLink: "https://example.com/secret",
          error: secretError,
          attempts: 2,
        },
      ],
    });
    const summary = buildPhaseFailureSummary(result);
    expect(summary.failures[0]!.error).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(summary.failures[0]!.error).toContain("[redacted]");
    expect(summary.failures[0]!.error.length).toBeLessThanOrEqual(2000);

    const message = buildHaltFailureMessage("tag", summary);
    expect(message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(message).toContain("[redacted]");
    expect(message.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX);
  });

  it("S1: redacts secrets in haltReason while keeping enrichment fields", () => {
    const skSecret = "sk-ant-api03-TESTSECRET";
    const bearerSecret = "TESTTOKEN";
    const result = makeTagResult({
      haltReason: `Tagging halted (last error: auth failed with ${skSecret} and Bearer ${bearerSecret})`,
      consecutiveErrors: 5,
      totalArticles: 12,
      failureCount: 3,
    });
    const summary = buildPhaseFailureSummary(result);

    expect(summary.haltReason).not.toBeNull();
    expect(summary.haltReason).not.toContain(skSecret);
    expect(summary.haltReason).not.toContain("sk-ant-api03");
    expect(summary.haltReason).not.toContain(bearerSecret);
    expect(summary.haltReason).not.toMatch(/Bearer\s+\S/i);
    expect(summary.haltReason).toContain("[redacted]");
    expect(summary.halted).toBe(true);
    expect(summary.consecutiveErrors).toBe(5);
    expect(summary.totalArticles).toBe(12);
    expect(summary.failureCount).toBe(3);
    expect(summary.failures).toHaveLength(3);
  });

  it("S1: leaves null haltReason as null", () => {
    const summary = buildPhaseFailureSummary(makeScoreResult({ haltReason: null }));
    expect(summary.haltReason).toBeNull();
  });

  it("empty-selection message includes drop count and up to 3 title+reason samples", () => {
    const failures: SelectionFailure[] = [
      {
        articleTitle: "Drop A",
        articleLink: "https://example.com/a",
        reason: "below-threshold",
      },
      {
        articleTitle: "Drop B",
        articleLink: "https://example.com/b",
        reason: "not-selected",
        error: "not selected by MMR (target=2, candidates=5)",
      },
      {
        articleTitle: "Drop C",
        articleLink: "https://example.com/c",
        reason: "embedding-failed",
        error: "embed timeout",
      },
      {
        articleTitle: "Drop D",
        articleLink: "https://example.com/d",
        reason: "below-threshold",
      },
    ];
    const message = buildEmptySelectionFailureMessage(failures);

    expect(message).not.toBe("No articles selected");
    expect(message).toMatch(/No articles selected/i);
    expect(message).toMatch(/4/);
    expect(message).toContain("Drop A");
    expect(message).toContain("below-threshold");
    expect(message).toContain("Drop B");
    expect(message).toContain("not-selected");
    expect(message).toContain("Drop C");
    expect(message).not.toContain("Drop D");
    expect(message.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX);
  });

  it("full-suppress message includes suppress count and up to 3 titles", () => {
    const summary: SuppressSummary = {
      count: 4,
      items: [
        {
          title: "Suppressed A",
          link: "https://example.com/a",
          matchedRunId: "run-1",
          matchedTitle: "Prior A",
          similarity: 0.95,
        },
        {
          title: "Suppressed B",
          link: "https://example.com/b",
          matchedRunId: "run-1",
          matchedTitle: "Prior B",
          similarity: 0.91,
        },
        {
          title: "Suppressed C",
          link: "https://example.com/c",
          matchedRunId: "run-2",
          matchedTitle: "Prior C",
          similarity: 0.88,
        },
        {
          title: "Suppressed D",
          link: "https://example.com/d",
          matchedRunId: "run-2",
          matchedTitle: "Prior D",
          similarity: 0.87,
        },
      ],
    };
    const message = buildFullSuppressFailureMessage(summary);

    expect(message).not.toBe("No articles selected");
    expect(message).toMatch(/No articles selected/i);
    expect(message).toMatch(/4/);
    expect(message).toContain("Suppressed A");
    expect(message).toContain("Suppressed B");
    expect(message).toContain("Suppressed C");
    expect(message).not.toContain("Suppressed D");
    expect(message.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX);
  });
});
