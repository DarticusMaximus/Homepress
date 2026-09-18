import { describe, it, expect, vi } from "vitest";
import type { Client } from "node-appwrite";
import type { Run } from "../types";
import { sweepStaleRuns } from "../stale-run-reaper";

const client = {} as Client;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Test",
    status: "running",
    trigger: "manual",
    currentPhase: "fetch",
    completedPhase: "",
    failedPhase: "",
    failureMessage: "",
    startedAt: "2024-01-01T10:00:00.000Z",
    endedAt: null,
    lastHeartbeatAt: null,
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

const NOW = Date.parse("2024-01-01T12:00:00.000Z");
const STALE_MS = 300_000;

describe("sweepStaleRuns", () => {
  it("does not sweep a run with a fresh lastHeartbeatAt", async () => {
    const listRuns = vi.fn().mockResolvedValue([
      makeRun({
        lastHeartbeatAt: "2024-01-01T11:59:00.000Z",
        currentPhase: "draft",
      }),
    ]);
    const markFailed = vi.fn();

    const result = await sweepStaleRuns(client, {
      staleMs: STALE_MS,
      now: NOW,
      listRuns,
      markFailed,
    });

    expect(result).toEqual({ swept: 0 });
    expect(markFailed).not.toHaveBeenCalled();
    expect(listRuns).toHaveBeenCalledWith(client, { status: "running", limit: 100 });
  });

  it("sweeps a stale lastHeartbeatAt with the persisted currentPhase", async () => {
    const listRuns = vi.fn().mockResolvedValue([
      makeRun({
        $id: "run-draft",
        lastHeartbeatAt: "2024-01-01T11:50:00.000Z",
        currentPhase: "draft",
      }),
    ]);
    const markFailed = vi.fn().mockResolvedValue(makeRun({ status: "failed" }));

    const result = await sweepStaleRuns(client, {
      staleMs: STALE_MS,
      now: NOW,
      listRuns,
      markFailed,
    });

    expect(result).toEqual({ swept: 1 });
    expect(markFailed).toHaveBeenCalledWith(client, "run-draft", {
      failedPhase: "draft",
      failureMessage:
        'Run marked failed by stale-run reaper: heartbeat lost during "draft" phase (worker crash or heartbeat stall)',
    });
  });

  it("does not sweep null lastHeartbeatAt with a recent startedAt", async () => {
    const listRuns = vi.fn().mockResolvedValue([
      makeRun({
        lastHeartbeatAt: null,
        startedAt: "2024-01-01T11:59:00.000Z",
      }),
    ]);
    const markFailed = vi.fn();

    const result = await sweepStaleRuns(client, {
      staleMs: STALE_MS,
      now: NOW,
      listRuns,
      markFailed,
    });

    expect(result).toEqual({ swept: 0 });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("sweeps null lastHeartbeatAt with an old startedAt (pre-upgrade zombie)", async () => {
    const listRuns = vi.fn().mockResolvedValue([
      makeRun({
        $id: "run-zombie",
        lastHeartbeatAt: null,
        startedAt: "2024-01-01T10:00:00.000Z",
        currentPhase: "scrape",
      }),
    ]);
    const markFailed = vi.fn().mockResolvedValue(makeRun({ status: "failed" }));

    const result = await sweepStaleRuns(client, {
      staleMs: STALE_MS,
      now: NOW,
      listRuns,
      markFailed,
    });

    expect(result).toEqual({ swept: 1 });
    expect(markFailed).toHaveBeenCalledWith(client, "run-zombie", {
      failedPhase: "scrape",
      failureMessage:
        'Run marked failed by stale-run reaper: heartbeat lost during "scrape" phase (worker crash or heartbeat stall)',
    });
  });

  it("isolates markFailed throws so other stale runs are still swept", async () => {
    const listRuns = vi.fn().mockResolvedValue([
      makeRun({
        $id: "run-boom",
        lastHeartbeatAt: "2024-01-01T11:50:00.000Z",
        currentPhase: "tag",
      }),
      makeRun({
        $id: "run-ok",
        lastHeartbeatAt: "2024-01-01T11:50:00.000Z",
        currentPhase: "score",
      }),
    ]);
    const markFailed = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(makeRun({ $id: "run-ok", status: "failed" }));
    const onLog = vi.fn();

    const result = await sweepStaleRuns(client, {
      staleMs: STALE_MS,
      now: NOW,
      listRuns,
      markFailed,
      onLog,
    });

    expect(result).toEqual({ swept: 1 });
    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(markFailed).toHaveBeenNthCalledWith(2, client, "run-ok", {
      failedPhase: "score",
      failureMessage:
        'Run marked failed by stale-run reaper: heartbeat lost during "score" phase (worker crash or heartbeat stall)',
    });
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("db down"));
  });
});
