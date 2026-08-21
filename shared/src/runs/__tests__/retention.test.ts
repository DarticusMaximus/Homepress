import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import type { Run } from "../types";
import { RunRepositoryError } from "../types";

// ---------------------------------------------------------------------------
// Mocks for purgeExpiredRuns dependencies
// ---------------------------------------------------------------------------

const mockHolder = vi.hoisted(() => ({
  getOrCreateAppSettings: vi.fn(),
  listAllRuns: vi.fn(),
  getRun: vi.fn(),
  deleteRun: vi.fn(),
}));

vi.mock("../repository", () => ({
  getRun: mockHolder.getRun,
  deleteRun: mockHolder.deleteRun,
  listAllRuns: mockHolder.listAllRuns,
}));

vi.mock("../../settings/repository", () => ({
  getOrCreateAppSettings: mockHolder.getOrCreateAppSettings,
}));

// Import after mocks are in place
import { selectRunsForDeletion, purgeExpiredRuns } from "../retention";
import {
  DEFAULT_RUN_RETENTION_DAYS,
  PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER,
} from "../../schema/declarations";

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

function completedRuns(count: number, newsletterId: string, prefix: string, month = "01"): Run[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return makeRun({
      $id: `${prefix}${i + 1}`,
      newsletterId,
      startedAt: `2026-${month}-${day}T00:00:00.000Z`,
      endedAt: `2026-${month}-${day}T01:00:00.000Z`,
    });
  });
}

const NOW = new Date("2026-02-15T00:00:00.000Z");
const RETENTION_DAYS = DEFAULT_RUN_RETENTION_DAYS;

const fakeClient = {} as Client;

// ===========================================================================
// selectRunsForDeletion (pure)
// ===========================================================================

describe("selectRunsForDeletion", () => {
  it("protects the top-N completed runs per newsletter; only the oldest is eligible", () => {
    const runs = completedRuns(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER + 1, "nl-1", "r");
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result.map((r) => r.$id)).toEqual(["r1"]);
  });

  it("failed runs older than cutoff are eligible; recent failed runs are not", () => {
    const runs = [
      makeRun({
        $id: "old-failed",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-05T00:00:00.000Z",
        endedAt: "2026-01-05T01:00:00.000Z",
      }),
      makeRun({
        $id: "new-failed",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-02-01T00:00:00.000Z",
        endedAt: "2026-02-01T01:00:00.000Z",
      }),
    ];
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result.map((r) => r.$id)).toEqual(["old-failed"]);
  });

  it("active runs (pending/running) are never eligible regardless of age", () => {
    const runs = [
      makeRun({
        $id: "ancient-pending",
        newsletterId: "nl-1",
        status: "pending",
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: null,
      }),
      makeRun({
        $id: "ancient-running",
        newsletterId: "nl-1",
        status: "running",
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: null,
      }),
    ];
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result).toEqual([]);
  });

  it("completed run outside top-N but inside the retention window is not eligible", () => {
    const runs = completedRuns(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER + 1, "nl-1", "r", "02");
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result).toEqual([]);
  });

  it("newsletter with fewer than the protected count completed protects all completed; old failed still eligible", () => {
    const completed = completedRuns(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER - 1, "nl-1", "c");
    const failedDay = String(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER).padStart(2, "0");
    const runs: Run[] = [
      ...completed,
      makeRun({
        $id: "f1",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: `2026-01-${failedDay}T00:00:00.000Z`,
        endedAt: `2026-01-${failedDay}T01:00:00.000Z`,
      }),
    ];
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result.map((r) => r.$id)).toEqual(["f1"]);
  });

  it("returns [] for empty input", () => {
    expect(selectRunsForDeletion([], RETENTION_DAYS, NOW)).toEqual([]);
  });

  it("protects the protected count independently per newsletter", () => {
    const runs: Run[] = [
      ...completedRuns(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER + 1, "nl-1", "nl1-r"),
      ...completedRuns(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER + 1, "nl-2", "nl2-r"),
    ];
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result.map((r) => r.$id)).toEqual(["nl1-r1", "nl2-r1"]);
  });

  it("returns eligible runs in stable order: startedAt ascending, then $id ascending", () => {
    const runs = [
      makeRun({
        $id: "z-run",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-10T00:00:00.000Z",
        endedAt: "2026-01-10T01:00:00.000Z",
      }),
      makeRun({
        $id: "a-run",
        newsletterId: "nl-2",
        status: "failed",
        startedAt: "2026-01-05T00:00:00.000Z",
        endedAt: "2026-01-05T01:00:00.000Z",
      }),
      makeRun({
        $id: "m-run",
        newsletterId: "nl-3",
        status: "failed",
        startedAt: "2026-01-05T00:00:00.000Z",
        endedAt: "2026-01-05T01:00:00.000Z",
      }),
    ];
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    // a-run and m-run share startedAt; tie-break $id asc → a-run before m-run
    // z-run has later startedAt → last
    expect(result.map((r) => r.$id)).toEqual(["a-run", "m-run", "z-run"]);
  });

  it("endedAt null falls back to startedAt for protected-completed sorting", () => {
    const nullDay = String(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER + 7).padStart(2, "0");
    const runs: Run[] = [
      makeRun({
        $id: "null-ended",
        newsletterId: "nl-1",
        startedAt: `2026-01-${nullDay}T00:00:00.000Z`,
        endedAt: null,
      }),
    ];
    for (let i = PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER; i >= 1; i--) {
      const day = String(i).padStart(2, "0");
      runs.push(
        makeRun({
          $id: `e${i}`,
          newsletterId: "nl-1",
          startedAt: `2026-01-${day}T00:00:00.000Z`,
          endedAt: `2026-01-${day}T01:00:00.000Z`,
        }),
      );
    }
    const result = selectRunsForDeletion(runs, RETENTION_DAYS, NOW);
    expect(result.map((r) => r.$id)).toEqual(["e1"]);
  });

  it("clamps retentionDays below MIN to MIN (1) without crashing", () => {
    // retentionDays=0 → clamped to 1; cutoff = Feb 15 - 1 day = Feb 14
    const runs = [
      makeRun({
        $id: "two-days-old",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-02-13T00:00:00.000Z",
        endedAt: "2026-02-13T01:00:00.000Z",
      }),
      makeRun({
        $id: "same-day",
        newsletterId: "nl-2",
        status: "failed",
        startedAt: "2026-02-14T12:00:00.000Z",
        endedAt: "2026-02-14T13:00:00.000Z",
      }),
    ];
    const result = selectRunsForDeletion(runs, 0, NOW);
    // two-days-old (Feb 13 < Feb 14 cutoff) → eligible
    // same-day (Feb 14 12:00 is NOT < Feb 14 00:00) → not eligible
    expect(result.map((r) => r.$id)).toEqual(["two-days-old"]);
  });

  it("clamps retentionDays above MAX to MAX (365) without crashing", () => {
    // retentionDays=1000 → clamped to 365; cutoff ≈ Feb 15 2025
    const runs = [
      makeRun({
        $id: "very-old",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: "2024-01-01T01:00:00.000Z",
      }),
      makeRun({
        $id: "year-old",
        newsletterId: "nl-2",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    ];
    const result = selectRunsForDeletion(runs, 1000, NOW);
    // very-old (2024) is before cutoff (~Feb 2025) → eligible
    // year-old (Jan 2026) is after cutoff → not eligible
    expect(result.map((r) => r.$id)).toEqual(["very-old"]);
  });
});

// ===========================================================================
// purgeExpiredRuns (mocked dependencies)
// ===========================================================================

describe("purgeExpiredRuns", () => {
  beforeEach(() => {
    mockHolder.getOrCreateAppSettings.mockReset();
    mockHolder.listAllRuns.mockReset();
    mockHolder.getRun.mockReset();
    mockHolder.deleteRun.mockReset();
  });

  it("deletes only eligible ids (old failed), skips recent and active", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([
      makeRun({
        $id: "to-delete",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
      makeRun({
        $id: "keep-recent",
        newsletterId: "nl-1",
        status: "completed",
        startedAt: "2026-02-01T00:00:00.000Z",
        endedAt: "2026-02-01T01:00:00.000Z",
      }),
    ]);
    mockHolder.getRun.mockImplementation(async (_c: unknown, id: string) =>
      makeRun({
        $id: id,
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    );
    mockHolder.deleteRun.mockResolvedValue(undefined);

    const result = await purgeExpiredRuns(fakeClient, { now: NOW });

    expect(mockHolder.deleteRun).toHaveBeenCalledTimes(1);
    expect(mockHolder.deleteRun).toHaveBeenCalledWith(fakeClient, "to-delete");
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("continues after a per-run delete error, incrementing errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });

    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([
      makeRun({
        $id: "fail-this",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
      makeRun({
        $id: "succeed-this",
        newsletterId: "nl-2",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);
    mockHolder.getRun.mockImplementation(async (_c: unknown, id: string) =>
      makeRun({
        $id: id,
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    );
    mockHolder.deleteRun.mockImplementation(async (_c: unknown, id: string) => {
      if (id === "fail-this") throw new Error("delete exploded");
    });

    const result = await purgeExpiredRuns(fakeClient, { now: NOW });

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(1);
    expect(mockHolder.deleteRun).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it("skips delete when re-check returns pending (does not count as deleted or errors)", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([
      makeRun({
        $id: "now-pending",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);
    mockHolder.getRun.mockResolvedValue(
      makeRun({
        $id: "now-pending",
        newsletterId: "nl-1",
        status: "pending",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
      }),
    );
    mockHolder.deleteRun.mockResolvedValue(undefined);

    const result = await purgeExpiredRuns(fakeClient, { now: NOW });

    expect(mockHolder.deleteRun).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("skips delete when re-check returns running (does not count as deleted or errors)", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([
      makeRun({
        $id: "now-running",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);
    mockHolder.getRun.mockResolvedValue(
      makeRun({
        $id: "now-running",
        newsletterId: "nl-1",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
      }),
    );
    mockHolder.deleteRun.mockResolvedValue(undefined);

    const result = await purgeExpiredRuns(fakeClient, { now: NOW });

    expect(mockHolder.deleteRun).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("quietly skips when re-check throws not_found (404) — no error increment", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([
      makeRun({
        $id: "already-gone",
        newsletterId: "nl-1",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
      }),
    ]);
    mockHolder.getRun.mockRejectedValue(new RunRepositoryError("not_found", "Run not found"));
    mockHolder.deleteRun.mockResolvedValue(undefined);

    const result = await purgeExpiredRuns(fakeClient, { now: NOW });

    expect(mockHolder.deleteRun).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("returns exactly { deleted, errors, retentionDays }", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([]);

    const result = await purgeExpiredRuns(fakeClient, { now: NOW });

    expect(Object.keys(result).sort()).toEqual(["deleted", "errors", "retentionDays"]);
    expect(typeof result.deleted).toBe("number");
    expect(typeof result.errors).toBe("number");
    expect(typeof result.retentionDays).toBe("number");
  });

  it("uses runRetentionDays from settings when opts.retentionDays is omitted", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 45,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([]);

    const result = await purgeExpiredRuns(fakeClient);

    expect(mockHolder.getOrCreateAppSettings).toHaveBeenCalledTimes(1);
    expect(result.retentionDays).toBe(45);
  });

  it("uses opts.retentionDays and does NOT call getOrCreateAppSettings", async () => {
    mockHolder.getOrCreateAppSettings.mockResolvedValue({
      runRetentionDays: 45,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockHolder.listAllRuns.mockResolvedValue([]);

    const result = await purgeExpiredRuns(fakeClient, { retentionDays: 7 });

    expect(mockHolder.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(result.retentionDays).toBe(7);
  });
});
