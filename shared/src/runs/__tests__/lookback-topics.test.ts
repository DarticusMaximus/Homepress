import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import type { Run } from "../types";

// ---------------------------------------------------------------------------
// Mocks for loadLookbackTopics dependency: listRuns
// ---------------------------------------------------------------------------

const mockHolder = vi.hoisted(() => ({
  listRuns: vi.fn(),
}));

vi.mock("../repository", () => ({
  listRuns: mockHolder.listRuns,
}));

// Import after mocks are in place
import {
  loadLookbackTopics,
  parseRunTopicSummary,
  selectLookbackCompletedRuns,
} from "../lookback-topics";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> & Pick<Run, "$id" | "newsletterId">): Run {
  return {
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    newsletterName: "Test",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T01:00:00.000Z",
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    ...overrides,
  };
}

const fakeClient = {} as Client;

// ===========================================================================
// parseRunTopicSummary (pure)
// ===========================================================================

describe("parseRunTopicSummary", () => {
  it("returns [] for empty string", () => {
    expect(parseRunTopicSummary("")).toEqual([]);
  });

  it("parses a valid JSON array of { title, tags }", () => {
    const raw = JSON.stringify([
      { title: "AI breakthrough", tags: ["ai", "research"] },
      { title: "Market update", tags: ["finance"] },
    ]);
    expect(parseRunTopicSummary(raw)).toEqual([
      { title: "AI breakthrough", tags: ["ai", "research"] },
      { title: "Market update", tags: ["finance"] },
    ]);
  });

  it("returns [] for invalid JSON", () => {
    expect(parseRunTopicSummary("{not valid json<<<")).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    expect(parseRunTopicSummary(JSON.stringify({ title: "X", tags: [] }))).toEqual([]);
  });

  it("keeps only valid items from a mixed array", () => {
    const raw = JSON.stringify([
      { title: "Valid", tags: ["a"] },
      { title: 123, tags: ["b"] },
      { tags: ["c"] },
      { title: "Missing tags" },
      { title: "Also valid", tags: [] },
    ]);
    expect(parseRunTopicSummary(raw)).toEqual([
      { title: "Valid", tags: ["a"] },
      { title: "Also valid", tags: [] },
    ]);
  });
});

// ===========================================================================
// selectLookbackCompletedRuns (pure)
// ===========================================================================

describe("selectLookbackCompletedRuns", () => {
  it("returns [] when lookback <= 0 even if completed runs exist", () => {
    const runs = [
      makeRun({ $id: "r1", newsletterId: "nl-1" }),
      makeRun({ $id: "r2", newsletterId: "nl-1" }),
    ];
    expect(selectLookbackCompletedRuns(runs, 0)).toEqual([]);
    expect(selectLookbackCompletedRuns(runs, -1)).toEqual([]);
  });

  it("filters to completed only", () => {
    const runs = [
      makeRun({ $id: "r1", newsletterId: "nl-1", status: "completed" }),
      makeRun({ $id: "r2", newsletterId: "nl-1", status: "failed" }),
      makeRun({ $id: "r3", newsletterId: "nl-1", status: "pending" }),
      makeRun({ $id: "r4", newsletterId: "nl-1", status: "running" }),
    ];
    expect(selectLookbackCompletedRuns(runs, 10).map((r) => r.$id)).toEqual(["r1"]);
  });

  it("orders by endedAt||startedAt desc (startedAt order differs from endedAt)", () => {
    const runs = [
      // run-a started earlier but ended later than run-b
      makeRun({
        $id: "run-a",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T02:00:00.000Z",
      }),
      makeRun({
        $id: "run-b",
        newsletterId: "nl-1",
        startedAt: "2026-01-02T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    ];
    // By startedAt desc: run-b, run-a. By endedAt desc: run-a, run-b.
    expect(selectLookbackCompletedRuns(runs, 10).map((r) => r.$id)).toEqual(["run-a", "run-b"]);
  });

  it("tie-breaks by $id descending when endedAt is equal", () => {
    const runs = [
      makeRun({
        $id: "run-a",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T02:00:00.000Z",
      }),
      makeRun({
        $id: "run-b",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T02:00:00.000Z",
      }),
    ];
    expect(selectLookbackCompletedRuns(runs, 10).map((r) => r.$id)).toEqual(["run-b", "run-a"]);
  });

  it("falls back to startedAt when endedAt is null", () => {
    const runs = [
      makeRun({
        $id: "r1",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
      }),
      makeRun({
        $id: "r2",
        newsletterId: "nl-1",
        startedAt: "2026-01-02T00:00:00.000Z",
        endedAt: null,
      }),
    ];
    expect(selectLookbackCompletedRuns(runs, 10).map((r) => r.$id)).toEqual(["r2", "r1"]);
  });

  it("slices to the N most recent completed", () => {
    const runs = [
      makeRun({
        $id: "r1",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
      makeRun({
        $id: "r2",
        newsletterId: "nl-1",
        startedAt: "2026-01-02T00:00:00.000Z",
        endedAt: "2026-01-02T01:00:00.000Z",
      }),
      makeRun({
        $id: "r3",
        newsletterId: "nl-1",
        startedAt: "2026-01-03T00:00:00.000Z",
        endedAt: "2026-01-03T01:00:00.000Z",
      }),
    ];
    expect(selectLookbackCompletedRuns(runs, 2).map((r) => r.$id)).toEqual(["r3", "r2"]);
  });

  it("returns all K when fewer than N completed runs exist", () => {
    const runs = [makeRun({ $id: "r1", newsletterId: "nl-1" })];
    expect(selectLookbackCompletedRuns(runs, 5).map((r) => r.$id)).toEqual(["r1"]);
  });

  it("ignores non-completed statuses entirely", () => {
    const runs = [
      makeRun({ $id: "r1", newsletterId: "nl-1", status: "pending" }),
      makeRun({ $id: "r2", newsletterId: "nl-1", status: "running" }),
      makeRun({ $id: "r3", newsletterId: "nl-1", status: "failed" }),
    ];
    expect(selectLookbackCompletedRuns(runs, 10)).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(selectLookbackCompletedRuns([], 5)).toEqual([]);
  });
});

// ===========================================================================
// loadLookbackTopics (mocked listRuns)
// ===========================================================================

describe("loadLookbackTopics", () => {
  beforeEach(() => {
    mockHolder.listRuns.mockReset();
  });

  it("returns empty result without calling listRuns when lookback is 0", async () => {
    const result = await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 0,
    });
    expect(result.lookback).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.topics).toEqual([]);
    expect(mockHolder.listRuns).not.toHaveBeenCalled();
  });

  it("returns empty result without calling listRuns when lookback is negative", async () => {
    const result = await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: -3,
    });
    expect(result.issues).toEqual([]);
    expect(result.topics).toEqual([]);
    expect(mockHolder.listRuns).not.toHaveBeenCalled();
  });

  it("happy path: three completed runs, lookback 2 → two most recent issues + flattened topics", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({
        $id: "r1",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
        topicSummary: JSON.stringify([{ title: "Topic A", tags: ["ai"] }]),
      }),
      makeRun({
        $id: "r2",
        newsletterId: "nl-1",
        startedAt: "2026-01-02T00:00:00.000Z",
        endedAt: "2026-01-02T01:00:00.000Z",
        topicSummary: JSON.stringify([{ title: "Topic B", tags: ["finance"] }]),
      }),
      makeRun({
        $id: "r3",
        newsletterId: "nl-1",
        startedAt: "2026-01-03T00:00:00.000Z",
        endedAt: "2026-01-03T01:00:00.000Z",
        topicSummary: JSON.stringify([
          { title: "Topic C", tags: ["tech"] },
          { title: "Topic D", tags: ["web"] },
        ]),
      }),
    ]);

    const result = await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 2,
    });

    expect(result.lookback).toBe(2);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.runId)).toEqual(["r3", "r2"]);
    expect(result.topics).toEqual([
      {
        title: "Topic C",
        tags: ["tech"],
        runId: "r3",
        runEndedAt: "2026-01-03T01:00:00.000Z",
        runStartedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        title: "Topic D",
        tags: ["web"],
        runId: "r3",
        runEndedAt: "2026-01-03T01:00:00.000Z",
        runStartedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        title: "Topic B",
        tags: ["finance"],
        runId: "r2",
        runEndedAt: "2026-01-02T01:00:00.000Z",
        runStartedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("returns empty issues and topics when no completed runs exist", async () => {
    mockHolder.listRuns.mockResolvedValue([]);
    const result = await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 5,
    });
    expect(result.lookback).toBe(5);
    expect(result.issues).toEqual([]);
    expect(result.topics).toEqual([]);
  });

  it("malformed topicSummary on one run → that issue has topics: []; siblings still parse", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({
        $id: "r1",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
        topicSummary: "{not valid json<<<",
      }),
      makeRun({
        $id: "r2",
        newsletterId: "nl-1",
        startedAt: "2026-01-02T00:00:00.000Z",
        endedAt: "2026-01-02T01:00:00.000Z",
        topicSummary: JSON.stringify([{ title: "Topic B", tags: ["finance"] }]),
      }),
    ]);

    const result = await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 5,
    });

    expect(result.issues).toHaveLength(2);
    const malformedIssue = result.issues.find((i) => i.runId === "r1")!;
    expect(malformedIssue.topics).toEqual([]);
    const okIssue = result.issues.find((i) => i.runId === "r2")!;
    expect(okIssue.topics).toEqual([{ title: "Topic B", tags: ["finance"] }]);
    expect(result.topics).toEqual([
      {
        title: "Topic B",
        tags: ["finance"],
        runId: "r2",
        runEndedAt: "2026-01-02T01:00:00.000Z",
        runStartedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("completed run with empty topicSummary still counts toward N issues but contributes zero topics", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({
        $id: "r1",
        newsletterId: "nl-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
        topicSummary: "",
      }),
      makeRun({
        $id: "r2",
        newsletterId: "nl-1",
        startedAt: "2026-01-02T00:00:00.000Z",
        endedAt: "2026-01-02T01:00:00.000Z",
        topicSummary: JSON.stringify([{ title: "Topic B", tags: ["finance"] }]),
      }),
    ]);

    const result = await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 2,
    });

    expect(result.issues).toHaveLength(2);
    expect(result.issues.find((i) => i.runId === "r1")!.topics).toEqual([]);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0]!.runId).toBe("r2");
  });

  it("passes newsletterId + status: completed with limit === Math.max(lookback, 100)", async () => {
    mockHolder.listRuns.mockResolvedValue([]);
    await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 5,
    });
    expect(mockHolder.listRuns).toHaveBeenCalledWith(fakeClient, {
      newsletterId: "nl-1",
      status: "completed",
      limit: 100,
    });
  });

  it("limit === lookback when lookback > 100", async () => {
    mockHolder.listRuns.mockResolvedValue([]);
    await loadLookbackTopics(fakeClient, {
      newsletterId: "nl-1",
      lookback: 150,
    });
    expect(mockHolder.listRuns).toHaveBeenCalledWith(fakeClient, {
      newsletterId: "nl-1",
      status: "completed",
      limit: 150,
    });
  });
});
