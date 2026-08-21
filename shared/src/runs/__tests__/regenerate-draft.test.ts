import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import { RunRepositoryError } from "../types";
import type { Run } from "../types";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  findActiveRunForNewsletter: vi.fn(),
  listActiveRunsForNewsletter: vi.fn(),
  loadPhaseCheckpoint: vi.fn(),
  requeueCompletedRunForDraft: vi.fn(),
  restoreCompleted: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock("../repository", () => ({
  getRun: mocks.getRun,
  findActiveRunForNewsletter: mocks.findActiveRunForNewsletter,
  listActiveRunsForNewsletter: mocks.listActiveRunsForNewsletter,
  loadPhaseCheckpoint: mocks.loadPhaseCheckpoint,
  requeueCompletedRunForDraft: mocks.requeueCompletedRunForDraft,
  restoreCompleted: mocks.restoreCompleted,
  markFailed: mocks.markFailed,
}));

import { isDraftRegenerateRun, requestRegenerateDraft } from "../regenerate-draft";

const client = {} as Client;
const runId = "run-regen";
const PRESERVED_ENDED_AT = "2026-03-15T12:00:00.000Z";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: runId,
    newsletterId: "nl-1",
    newsletterName: "Test Newsletter",
    status: "completed",
    trigger: "manual",
    currentPhase: "draft",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: PRESERVED_ENDED_AT,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "ckpt-fetch",
    checkpointScrapeId: "ckpt-scrape",
    checkpointTagId: "ckpt-tag",
    checkpointScoreId: "ckpt-score",
    checkpointSelectionId: "ckpt-selection",
    checkpointDraftId: "ckpt-draft",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "Stored title",
    issueDek: "Stored dek",
    ...overrides,
  };
}

describe("isDraftRegenerateRun", () => {
  it("is true only when startPhase is draft, endedAt is non-empty, and checkpointDraftId is non-empty", () => {
    const run = makeRun();
    expect(isDraftRegenerateRun(run, "draft")).toBe(true);
  });

  it("is false for a failed-retry resume from selection (endedAt null)", () => {
    const run = makeRun({ endedAt: null, completedPhase: "selection" });
    expect(isDraftRegenerateRun(run, "selection")).toBe(false);
    expect(isDraftRegenerateRun(run, "draft")).toBe(false);
  });

  it("is false when startPhase is not draft even if endedAt and draft checkpoint exist", () => {
    expect(isDraftRegenerateRun(makeRun(), "fetch")).toBe(false);
    expect(isDraftRegenerateRun(makeRun(), "selection")).toBe(false);
  });

  it("is false when endedAt or checkpointDraftId is empty", () => {
    expect(isDraftRegenerateRun(makeRun({ endedAt: "" }), "draft")).toBe(false);
    expect(isDraftRegenerateRun(makeRun({ checkpointDraftId: "" }), "draft")).toBe(false);
  });
});

describe("requestRegenerateDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRun.mockResolvedValue(makeRun());
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({ $id: runId, status: "pending" }),
    ]);
    mocks.loadPhaseCheckpoint.mockResolvedValue(undefined);
    mocks.requeueCompletedRunForDraft.mockResolvedValue(
      makeRun({ status: "pending", completedPhase: "selection" }),
    );
    mocks.restoreCompleted.mockResolvedValue(makeRun());
    mocks.markFailed.mockResolvedValue(makeRun({ status: "failed" }));
  });

  // --- Test 5: not_found / non-completed / wrong completedPhase ---

  it("returns 'Run not found' when getRun throws not_found", async () => {
    mocks.getRun.mockRejectedValue(new RunRepositoryError("not_found", "Run not found"));

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({ ok: false, error: "Run not found" });
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  it("returns the non-completed guard for a pending run", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "pending" }));

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Only completed runs can regenerate their draft",
    });
    expect(mocks.findActiveRunForNewsletter).not.toHaveBeenCalled();
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  it("returns the non-completed guard for a failed run", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "failed", completedPhase: "selection" }));

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Only completed runs can regenerate their draft",
    });
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  it("returns the cannot-regenerate string when completedPhase is selection", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "completed", completedPhase: "selection" }));

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "This run cannot regenerate its draft; start a new run instead",
    });
    expect(mocks.findActiveRunForNewsletter).not.toHaveBeenCalled();
    expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  // --- Test 6: active run / missing checkpoint / appwrite load error ---

  it("returns the in-progress string when findActiveRunForNewsletter is non-null", async () => {
    mocks.findActiveRunForNewsletter.mockResolvedValue(
      makeRun({
        $id: "run-active",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
    });
    expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  it("returns the missing-checkpoint string when the selection checkpoint is missing", async () => {
    mocks.loadPhaseCheckpoint.mockRejectedValueOnce(
      new RunRepositoryError("checkpoint_missing", "No selection checkpoint"),
    );

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Cannot regenerate: checkpoint data is missing. Start a new run instead.",
    });
    expect(mocks.loadPhaseCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.loadPhaseCheckpoint).toHaveBeenCalledWith(client, runId, "selection");
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  it("returns the missing-checkpoint string when the draft checkpoint is missing", async () => {
    mocks.loadPhaseCheckpoint.mockResolvedValueOnce(undefined);
    mocks.loadPhaseCheckpoint.mockRejectedValueOnce(
      new RunRepositoryError("checkpoint_missing", "No draft checkpoint"),
    );

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Cannot regenerate: checkpoint data is missing. Start a new run instead.",
    });
    expect(mocks.loadPhaseCheckpoint).toHaveBeenNthCalledWith(1, client, runId, "selection");
    expect(mocks.loadPhaseCheckpoint).toHaveBeenNthCalledWith(2, client, runId, "draft");
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  it("returns the database-error string when checkpoint load throws appwrite", async () => {
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("appwrite", "DB connection lost"),
    );

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "Could not load checkpoint due to a database error. Try again.",
    });
    expect(mocks.requeueCompletedRunForDraft).not.toHaveBeenCalled();
  });

  // --- Test 7: happy path ---

  it("loads both checkpoints, requeues, and succeeds when this run is the only active", async () => {
    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({ ok: true });
    expect(mocks.loadPhaseCheckpoint).toHaveBeenNthCalledWith(1, client, runId, "selection");
    expect(mocks.loadPhaseCheckpoint).toHaveBeenNthCalledWith(2, client, runId, "draft");
    expect(mocks.loadPhaseCheckpoint).toHaveBeenCalledTimes(2);
    expect(mocks.requeueCompletedRunForDraft).toHaveBeenCalledWith(client, runId);
    expect(mocks.restoreCompleted).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  // --- Test 8: race — this run is not oldest ---

  it("restores this run with pre-requeue endedAt and never markFaileds this runId when it is not oldest", async () => {
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({
        $id: "run-older",
        status: "pending",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeRun({
        $id: runId,
        status: "pending",
        startedAt: "2026-01-01T01:00:00.000Z",
        endedAt: PRESERVED_ENDED_AT,
      }),
      makeRun({
        $id: "run-newer",
        status: "pending",
        startedAt: "2026-01-01T02:00:00.000Z",
      }),
    ]);

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
    });
    expect(mocks.requeueCompletedRunForDraft).toHaveBeenCalledWith(client, runId);
    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, runId, {
      endedAt: PRESERVED_ENDED_AT,
    });
    expect(mocks.markFailed).not.toHaveBeenCalledWith(
      client,
      runId,
      expect.anything(),
    );
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-newer", {
      failedPhase: "fetch",
      failureMessage: "Superseded by a concurrent start",
    });
  });

  it("still returns the in-progress string when restoreCompleted throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    mocks.listActiveRunsForNewsletter.mockResolvedValue([
      makeRun({
        $id: "run-older",
        status: "pending",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeRun({
        $id: runId,
        status: "pending",
        startedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);
    mocks.restoreCompleted.mockRejectedValue(new RunRepositoryError("appwrite", "restore boom"));

    const result = await requestRegenerateDraft(client, runId);

    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
    });
    expect(mocks.markFailed).not.toHaveBeenCalledWith(client, runId, expect.anything());
    const logged = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "regenerate-draft-race-restore",
    );
    expect(logged).toBeDefined();
    spy.mockRestore();
  });
});
