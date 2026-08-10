import { describe, it, expect, vi } from "vitest";
import { RunPoller, shouldClaim } from "../run-poller";
import type { PollerDeps } from "../run-poller";
import type { Run } from "@newsletter/shared";
import type { Client } from "node-appwrite";

const client = {} as Client;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Test",
    status: "pending",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "",
    failedPhase: "",
    failureMessage: "",
    startedAt: "2024-01-01T10:00:00.000Z",
    endedAt: null,
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
    ...overrides,
  };
}

interface SetupResult {
  poller: RunPoller;
  listPendingRuns: ReturnType<typeof vi.fn>;
  listActiveRunsForNewsletter: ReturnType<typeof vi.fn>;
  executeJob: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
}

function setup(overrides?: Partial<Pick<PollerDeps, "onLog" | "pollMs">>): SetupResult {
  const listPendingRuns = vi.fn();
  const listActiveRunsForNewsletter = vi.fn();
  const executeJob = vi.fn();
  const markFailed = vi.fn();
  const poller = new RunPoller({
    client,
    listPendingRuns,
    listActiveRunsForNewsletter,
    executeJob,
    markFailed,
    ...overrides,
  });
  return { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob, markFailed };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("shouldClaim", () => {
  it("claims when candidate is the only active run", () => {
    const candidate = makeRun();
    expect(shouldClaim(candidate, [candidate])).toBe(true);
  });

  it("claims when there are no other active runs", () => {
    const candidate = makeRun();
    expect(shouldClaim(candidate, [])).toBe(true);
  });

  it("skips when another active run is running", () => {
    const candidate = makeRun({ $id: "run-2" });
    const running = makeRun({ $id: "run-1", status: "running" });
    expect(shouldClaim(candidate, [candidate, running])).toBe(false);
  });

  it("skips when another active run is an older pending", () => {
    const candidate = makeRun({
      $id: "run-2",
      startedAt: "2024-01-01T11:00:00.000Z",
    });
    const older = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    expect(shouldClaim(candidate, [candidate, older])).toBe(false);
  });

  it("claims when another active run is a newer pending", () => {
    const candidate = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const newer = makeRun({
      $id: "run-2",
      startedAt: "2024-01-01T11:00:00.000Z",
    });
    expect(shouldClaim(candidate, [candidate, newer])).toBe(true);
  });

  it("skips when another pending has same startedAt but earlier $id", () => {
    const candidate = makeRun({
      $id: "run-2",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const earlier = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    expect(shouldClaim(candidate, [candidate, earlier])).toBe(false);
  });

  it("claims when another pending has same startedAt but later $id", () => {
    const candidate = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const later = makeRun({
      $id: "run-2",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    expect(shouldClaim(candidate, [candidate, later])).toBe(true);
  });

  it("ignores completed and failed runs", () => {
    const candidate = makeRun({ $id: "run-1" });
    const completed = makeRun({ $id: "run-2", status: "completed" });
    const failed = makeRun({ $id: "run-3", status: "failed" });
    expect(shouldClaim(candidate, [candidate, completed, failed])).toBe(true);
  });
});

describe("RunPoller.tick", () => {
  it("(a) skips tick when in-flight is set", async () => {
    // Case 8: single-flight — while inFlight, tick must not claim or execute
    const { poller, listPendingRuns, executeJob } = setup();
    poller.inFlight = true;

    await poller.tick();

    expect(listPendingRuns).not.toHaveBeenCalled();
    expect(executeJob).not.toHaveBeenCalled();
  });

  it("(b) invokes executeJob when claim is allowed", async () => {
    const run = makeRun({ $id: "run-42" });
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    listPendingRuns.mockResolvedValue([run]);
    listActiveRunsForNewsletter.mockResolvedValue([run]);

    await poller.tick();

    expect(listPendingRuns).toHaveBeenCalledWith(client, { limit: 1 });
    expect(listActiveRunsForNewsletter).toHaveBeenCalledWith(client, "nl-1");
    expect(executeJob).toHaveBeenCalledWith("run-42");
  });

  it("(c) skips claim when another active run is running", async () => {
    const candidate = makeRun({ $id: "run-2" });
    const running = makeRun({ $id: "run-1", status: "running" });
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    listPendingRuns.mockResolvedValue([candidate]);
    listActiveRunsForNewsletter.mockResolvedValue([candidate, running]);

    await poller.tick();

    expect(executeJob).not.toHaveBeenCalled();
  });

  it("(c) skips claim when another active run is an older pending", async () => {
    const candidate = makeRun({
      $id: "run-2",
      startedAt: "2024-01-01T11:00:00.000Z",
    });
    const older = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    listPendingRuns.mockResolvedValue([candidate]);
    listActiveRunsForNewsletter.mockResolvedValue([candidate, older]);

    await poller.tick();

    expect(executeJob).not.toHaveBeenCalled();
  });

  it("does nothing when no pending runs exist", async () => {
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    listPendingRuns.mockResolvedValue([]);

    await poller.tick();

    expect(listActiveRunsForNewsletter).not.toHaveBeenCalled();
    expect(executeJob).not.toHaveBeenCalled();
  });

  it("clears in-flight after successful execution", async () => {
    const run = makeRun();
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    listPendingRuns.mockResolvedValue([run]);
    listActiveRunsForNewsletter.mockResolvedValue([run]);
    executeJob.mockResolvedValue(undefined);

    await poller.tick();

    expect(poller.inFlight).toBe(false);
    expect(poller.currentRunId).toBeNull();
  });

  it("clears in-flight after executeJob throws and logs the error", async () => {
    const run = makeRun();
    const onLog = vi.fn();
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup({ onLog });
    listPendingRuns.mockResolvedValue([run]);
    listActiveRunsForNewsletter.mockResolvedValue([run]);
    executeJob.mockRejectedValue(new Error("boom"));

    await poller.tick();

    expect(executeJob).toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(poller.inFlight).toBe(false);
    expect(poller.currentRunId).toBeNull();
  });

  it("logs and returns when listPendingRuns throws", async () => {
    const onLog = vi.fn();
    const { poller, listPendingRuns, executeJob } = setup({ onLog });
    listPendingRuns.mockRejectedValue(new Error("db down"));

    await poller.tick();

    expect(executeJob).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("db down"));
  });

  it("logs and returns when listActiveRunsForNewsletter throws", async () => {
    const run = makeRun();
    const onLog = vi.fn();
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup({ onLog });
    listPendingRuns.mockResolvedValue([run]);
    listActiveRunsForNewsletter.mockRejectedValue(new Error("lookup failed"));

    await poller.tick();

    expect(executeJob).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("lookup failed"));
  });

  it("concurrent overlapping ticks never both execute a job", async () => {
    const run = makeRun({ $id: "run-1" });
    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    const pending = deferred<Run[]>();
    listPendingRuns.mockReturnValueOnce(pending.promise);
    listActiveRunsForNewsletter.mockResolvedValue([run]);
    executeJob.mockResolvedValue(undefined);

    const first = poller.tick();
    const second = poller.tick();

    expect(listPendingRuns).toHaveBeenCalledTimes(1);

    pending.resolve([run]);

    await Promise.all([first, second]);

    expect(executeJob).toHaveBeenCalledTimes(1);
  });

  // Case 9: two pending runs for different newsletters — serial via inFlight
  it("executes at most one job while two pending runs for different newsletters wait", async () => {
    const runA = makeRun({
      $id: "run-a",
      newsletterId: "nl-a",
      newsletterName: "A",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const runB = makeRun({
      $id: "run-b",
      newsletterId: "nl-b",
      newsletterName: "B",
      startedAt: "2024-01-01T10:01:00.000Z",
    });

    const { poller, listPendingRuns, listActiveRunsForNewsletter, executeJob } = setup();
    const enteredExecute = deferred<void>();
    const firstExec = deferred<void>();
    let concurrentExecuteCalls = 0;
    let maxConcurrentExecuteCalls = 0;

    listPendingRuns.mockResolvedValueOnce([runA]).mockResolvedValue([runB]);
    listActiveRunsForNewsletter.mockImplementation(async (_client, newsletterId) => {
      if (newsletterId === "nl-a") return [runA];
      if (newsletterId === "nl-b") return [runB];
      return [];
    });
    executeJob.mockImplementation(async () => {
      concurrentExecuteCalls += 1;
      maxConcurrentExecuteCalls = Math.max(maxConcurrentExecuteCalls, concurrentExecuteCalls);
      enteredExecute.resolve();
      try {
        await firstExec.promise;
      } finally {
        concurrentExecuteCalls -= 1;
      }
    });

    const firstTick = poller.tick();
    await enteredExecute.promise;

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith("run-a");
    expect(poller.inFlight).toBe(true);

    // Second tick while first execute is in flight must not start another job
    await poller.tick();
    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(maxConcurrentExecuteCalls).toBe(1);

    firstExec.resolve(undefined);
    await firstTick;

    expect(poller.inFlight).toBe(false);

    // Later tick claims the remaining pending for the other newsletter
    await poller.tick();
    expect(executeJob).toHaveBeenCalledTimes(2);
    expect(executeJob).toHaveBeenNthCalledWith(2, "run-b");
    expect(maxConcurrentExecuteCalls).toBe(1);
  });
});

describe("RunPoller.shutdown", () => {
  it("(d) marks failed on shutdown when in-flight", async () => {
    const { poller, markFailed } = setup();
    markFailed.mockResolvedValue(makeRun({ status: "failed" }));
    poller.inFlight = true;
    poller.currentRunId = "run-99";

    await poller.shutdown();

    expect(markFailed).toHaveBeenCalledWith(
      client,
      "run-99",
      expect.objectContaining({
        failedPhase: "fetch",
        failureMessage: "Worker shut down during run",
      }),
    );
  });

  it("(d) resets in-flight state after shutdown markFailed", async () => {
    const { poller, markFailed } = setup();
    markFailed.mockResolvedValue(makeRun({ status: "failed" }));
    poller.inFlight = true;
    poller.currentRunId = "run-99";

    await poller.shutdown();

    expect(poller.inFlight).toBe(false);
    expect(poller.currentRunId).toBeNull();
  });

  it("shutdown is idempotent (double-call marks failed only once)", async () => {
    const { poller, markFailed } = setup();
    markFailed.mockResolvedValue(makeRun({ status: "failed" }));
    poller.inFlight = true;
    poller.currentRunId = "run-99";

    await poller.shutdown();
    await poller.shutdown();

    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it("does nothing on shutdown when not in-flight", async () => {
    const { poller, markFailed } = setup();

    await poller.shutdown();

    expect(markFailed).not.toHaveBeenCalled();
  });

  it("does not throw when markFailed itself fails", async () => {
    const onLog = vi.fn();
    const { poller, markFailed } = setup({ onLog });
    markFailed.mockRejectedValue(new Error("db gone"));
    poller.inFlight = true;
    poller.currentRunId = "run-99";

    await expect(poller.shutdown()).resolves.toBeUndefined();

    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("db gone"));
    expect(poller.inFlight).toBe(false);
    expect(poller.currentRunId).toBeNull();
  });
});

describe("RunPoller lifecycle", () => {
  it("start() begins periodic polling", () => {
    vi.useFakeTimers();
    const { poller, listPendingRuns } = setup({ pollMs: 1000 });
    listPendingRuns.mockResolvedValue([]);

    poller.start();
    vi.advanceTimersByTime(1000);

    expect(listPendingRuns).toHaveBeenCalledTimes(1);

    poller.stop();
    vi.useRealTimers();
  });

  it("start() is idempotent — calling twice does not create a second interval", () => {
    vi.useFakeTimers();
    const { poller, listPendingRuns } = setup({ pollMs: 1000 });
    listPendingRuns.mockResolvedValue([]);

    poller.start();
    poller.start();
    vi.advanceTimersByTime(1000);

    expect(listPendingRuns).toHaveBeenCalledTimes(1);

    poller.stop();
    vi.useRealTimers();
  });

  it("stop() halts polling — no further ticks after stop", () => {
    vi.useFakeTimers();
    const { poller, listPendingRuns } = setup({ pollMs: 1000 });
    listPendingRuns.mockResolvedValue([]);

    poller.start();
    vi.advanceTimersByTime(1000);
    expect(listPendingRuns).toHaveBeenCalledTimes(1);

    poller.stop();
    vi.advanceTimersByTime(5000);
    expect(listPendingRuns).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("start() can resume polling after stop()", async () => {
    vi.useFakeTimers();
    const { poller, listPendingRuns } = setup({ pollMs: 1000 });
    listPendingRuns.mockResolvedValue([]);

    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    poller.stop();

    poller.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(listPendingRuns).toHaveBeenCalledTimes(2);

    poller.stop();
    vi.useRealTimers();
  });
});

describe("RunPoller interval error handling", () => {
  it(".catch() logs unexpected throw instead of unhandled rejection", async () => {
    vi.useFakeTimers();
    const onLog = vi.fn();
    const candidate = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const badActive = makeRun({
      $id: "run-2",
      status: "pending",
      startedAt: null as unknown as string,
    });
    const { poller, listPendingRuns, listActiveRunsForNewsletter } = setup({
      pollMs: 1000,
      onLog,
    });
    listPendingRuns.mockResolvedValue([candidate]);
    listActiveRunsForNewsletter.mockResolvedValue([candidate, badActive]);

    poller.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("tick error"));

    poller.stop();
    vi.useRealTimers();
  });

  it(".catch() resets ticking so polling can resume after an unexpected throw", async () => {
    vi.useFakeTimers();
    const onLog = vi.fn();
    const candidate = makeRun({
      $id: "run-1",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const badActive = makeRun({
      $id: "run-2",
      status: "pending",
      startedAt: null as unknown as string,
    });
    const { poller, listPendingRuns, listActiveRunsForNewsletter } = setup({
      pollMs: 1000,
      onLog,
    });
    listPendingRuns.mockResolvedValue([candidate]);
    listActiveRunsForNewsletter.mockResolvedValue([candidate, badActive]);

    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(listPendingRuns).toHaveBeenCalledTimes(2);

    poller.stop();
    vi.useRealTimers();
  });
});
