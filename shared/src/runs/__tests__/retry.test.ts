import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import { RunRepositoryError } from "../types";
import type { Run } from "../types";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  findActiveRunForNewsletter: vi.fn(),
  listActiveRunsForNewsletter: vi.fn(),
  loadPhaseCheckpoint: vi.fn(),
  requeueFailedRun: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock("../repository", () => ({
  getRun: mocks.getRun,
  findActiveRunForNewsletter: mocks.findActiveRunForNewsletter,
  listActiveRunsForNewsletter: mocks.listActiveRunsForNewsletter,
  loadPhaseCheckpoint: mocks.loadPhaseCheckpoint,
  requeueFailedRun: mocks.requeueFailedRun,
  markFailed: mocks.markFailed,
}));

import { requestFailedRunRetry } from "../retry";

const client = {} as Client;
const runId = "run-retry";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: runId,
    newsletterId: "nl-1",
    newsletterName: "Test Newsletter",
    status: "failed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "scrape",
    failedPhase: "tag",
    failureMessage: "boom",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T01:00:00.000Z",
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "ckpt-scrape-1",
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
    ...overrides,
  };
}

describe("requestFailedRunRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRun.mockResolvedValue(makeRun());
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({ $id: runId, status: "pending" }),
    ]);
    mocks.loadPhaseCheckpoint.mockResolvedValue(undefined);
    mocks.requeueFailedRun.mockResolvedValue(makeRun({ status: "pending" }));
    mocks.markFailed.mockResolvedValue(makeRun({ status: "failed" }));
  });

  // (a) Run not found → "Run not found"
  it("returns 'Run not found' when getRun throws not_found", async () => {
    mocks.getRun.mockRejectedValue(new RunRepositoryError("not_found", "Run not found"));

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({ ok: false, error: "Run not found" });
  });

  // (b) status !== "failed" → "Only failed runs can be retried"
  it("returns 'Only failed runs can be retried' when the run is not failed", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "completed" }));

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Only failed runs can be retried",
    });
  });

  it("returns the non-failed guard for a pending run", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "pending" }));

    const result = await requestFailedRunRetry(client, runId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Only failed runs can be retried");
    }
  });

  // (c) active run exists → "A run is already in progress for this newsletter"
  it("returns the active-run guard when findActiveRunForNewsletter is non-null", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({
        $id: runId,
        newsletterId: "nl-1",
        status: "failed",
        failedPhase: "scrape",
      }),
    );
    mocks.findActiveRunForNewsletter.mockResolvedValue(
      makeRun({
        $id: "run-active",
        newsletterId: "nl-1",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
    });
  });

  it("does not call findActiveRunForNewsletter for a non-failed run (guard short-circuits before step 3)", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "completed" }));

    await requestFailedRunRetry(client, runId);

    expect(mocks.findActiveRunForNewsletter).not.toHaveBeenCalled();
  });

  // --- Feature 04: real enqueue path ---

  // 1. Success path
  it("succeeds when checkpoint loads and run is sole active", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({ $id: runId, status: "pending", completedPhase: "scrape" }),
    ]);

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({ ok: true });
    expect(mocks.loadPhaseCheckpoint).toHaveBeenCalledWith(client, runId, "scrape");
    expect(mocks.requeueFailedRun).toHaveBeenCalledWith(client, runId);
  });

  // Feature 06 Task 1 case 9 — persistence of trigger:"manual" on requeue is covered by
  // repository.test.ts ("sets trigger to manual on requeue even when the document was scheduled").
  // requestFailedRunRetry mocks requeueFailedRun, so the write contract is asserted there.

  // 2. Missing checkpoint
  it("returns checkpoint-missing error when loadPhaseCheckpoint throws checkpoint_missing", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("checkpoint_missing", "No checkpoint"),
    );

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Cannot retry: checkpoint data is missing. Start a new run instead.",
    });
    expect(mocks.requeueFailedRun).not.toHaveBeenCalled();
  });

  // 2b. Transient DB error during checkpoint preflight (N1)
  it("returns database-error message when loadPhaseCheckpoint throws appwrite (N1)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("appwrite", "DB connection lost"),
    );

    const result = await requestFailedRunRetry(client, runId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not load checkpoint due to a database error. Try again.");
    }
    expect(mocks.requeueFailedRun).not.toHaveBeenCalled();

    // Error must be logged with structured context
    const logged = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "retry-checkpoint-scrape",
    );
    expect(logged).toBeDefined();
    spy.mockRestore();
  });

  // 3. Invalid resume (completedPhase === "draft")
  it("returns non-resumable error when completedPhase is 'draft'", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "draft" }),
    );

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "This run cannot be resumed; start a new run instead",
    });
    expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.requeueFailedRun).not.toHaveBeenCalled();
  });

  // 4. Success from fetch (no completedPhase)
  it("succeeds from fetch without loading checkpoint when completedPhase is empty", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ $id: runId, status: "failed", completedPhase: "" }));
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({ $id: runId, status: "pending", completedPhase: "" }),
    ]);

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({ ok: true });
    expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.requeueFailedRun).toHaveBeenCalledWith(client, runId);
  });

  // 5. Race — this run is oldest
  it("marks newer runs as superseded and succeeds when this run is oldest", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({
        $id: runId,
        status: "pending",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeRun({
        $id: "run-other",
        status: "pending",
        startedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({ ok: true });
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-other", {
      failedPhase: "fetch",
      failureMessage: "Superseded by a concurrent start",
    });
  });

  // 6. Race — this run is not oldest
  it("returns active-run guard when this run is not the oldest after requeue", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({
        $id: "run-other",
        status: "pending",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeRun({
        $id: runId,
        status: "pending",
        startedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
    });
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, runId, {
      failedPhase: "tag",
      failureMessage: "Superseded by a concurrent start",
    });
  });

  // --- C3: steps 6-7 error isolation ---

  it("returns { ok: false, error } when requeueFailedRun throws RunRepositoryError (C3)", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.requeueFailedRun.mockRejectedValue(
      new RunRepositoryError("appwrite", "DB write failed during requeue"),
    );

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "DB write failed during requeue",
    });
  });

  it("returns GENERIC_ERROR when requeueFailedRun throws unknown error (C3)", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.requeueFailedRun.mockRejectedValue(new Error("unexpected boom"));

    const result = await requestFailedRunRetry(client, runId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Something went wrong while talking to the database. Please try again.",
      );
    }
  });

  it("returns { ok: false, error } when listActiveRunsForNewsletter throws RunRepositoryError (C3)", async () => {
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.listActiveRunsForNewsletter.mockRejectedValue(
      new RunRepositoryError("appwrite", "DB query failed"),
    );

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({ ok: false, error: "DB query failed" });
  });

  it("isolates markFailed failures in race cleanup and continues loop (C3)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    mocks.getRun.mockResolvedValue(
      makeRun({ $id: runId, status: "failed", completedPhase: "scrape" }),
    );
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({
        $id: runId,
        status: "pending",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeRun({
        $id: "run-a",
        status: "pending",
        startedAt: "2026-01-01T01:00:00.000Z",
      }),
      makeRun({
        $id: "run-b",
        status: "pending",
        startedAt: "2026-01-01T02:00:00.000Z",
      }),
    ]);
    mocks.markFailed.mockRejectedValueOnce(new RunRepositoryError("appwrite", "transient failure"));
    mocks.markFailed.mockResolvedValueOnce(makeRun({ $id: "run-b", status: "failed" }));

    const result = await requestFailedRunRetry(client, runId);

    expect(result).toEqual({ ok: true });
    expect(mocks.markFailed).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).toHaveBeenCalledWith(
      client,
      "run-a",
      expect.objectContaining({ failureMessage: "Superseded by a concurrent start" }),
    );
    expect(mocks.markFailed).toHaveBeenCalledWith(
      client,
      "run-b",
      expect.objectContaining({ failureMessage: "Superseded by a concurrent start" }),
    );

    const logged = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "retry-race-cleanup",
    );
    expect(logged).toBeDefined();
    spy.mockRestore();
  });
});
