import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { Client } from "node-appwrite";
import type { DueCheckResult } from "@newsletter/shared";

import {
  DEFAULT_SCHEDULE_POLL_MS,
  MIN_SCHEDULE_POLL_MS,
  SchedulePoller,
  parseSchedulePollMs,
} from "../schedule-poller";

const client = {} as Client;

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

describe("parseSchedulePollMs / DEFAULT_SCHEDULE_POLL_MS", () => {
  it("defaults to 60000 when env is unset", () => {
    expect(DEFAULT_SCHEDULE_POLL_MS).toBe(60000);
    expect(parseSchedulePollMs(undefined)).toBe(60000);
    expect(parseSchedulePollMs("")).toBe(60000);
  });

  it("rejects non-positive and invalid values to DEFAULT_SCHEDULE_POLL_MS (X1)", () => {
    expect(MIN_SCHEDULE_POLL_MS).toBeGreaterThanOrEqual(1000);
    expect(parseSchedulePollMs("0")).toBe(DEFAULT_SCHEDULE_POLL_MS);
    expect(parseSchedulePollMs("-1")).toBe(DEFAULT_SCHEDULE_POLL_MS);
    expect(parseSchedulePollMs("abc")).toBe(DEFAULT_SCHEDULE_POLL_MS);
  });

  it("clamps positive values below the floor to MIN_SCHEDULE_POLL_MS (X1)", () => {
    expect(parseSchedulePollMs("1")).toBe(MIN_SCHEDULE_POLL_MS);
    expect(parseSchedulePollMs("999")).toBe(MIN_SCHEDULE_POLL_MS);
  });

  it("accepts values at or above the floor", () => {
    expect(parseSchedulePollMs("1000")).toBe(1000);
    expect(parseSchedulePollMs("60000")).toBe(60000);
  });

  it("logs when falling back from invalid or non-positive env (X1)", () => {
    const onLog = vi.fn();
    parseSchedulePollMs("0", onLog);
    expect(onLog).toHaveBeenCalledWith(expect.stringMatching(/WORKER_SCHEDULE_POLL_MS/));
    expect(onLog).toHaveBeenCalledWith(expect.stringMatching(/default|fallback|invalid/i));

    onLog.mockClear();
    parseSchedulePollMs("abc", onLog);
    expect(onLog).toHaveBeenCalled();

    onLog.mockClear();
    parseSchedulePollMs("-1", onLog);
    expect(onLog).toHaveBeenCalled();
  });
});

describe("SchedulePoller single-flight", () => {
  let processDueSchedules: Mock<(client: Client) => Promise<DueCheckResult>>;
  let poller: SchedulePoller;

  beforeEach(() => {
    processDueSchedules = vi.fn();
    poller = new SchedulePoller({
      client,
      processDueSchedules,
      pollMs: 1000,
    });
  });

  afterEach(() => {
    poller.stop();
  });

  it("overlapping ticks do not double-invoke processDueSchedules", async () => {
    const pending = deferred<DueCheckResult>();
    processDueSchedules.mockReturnValueOnce(pending.promise);

    const first = poller.tick();
    const second = poller.tick();

    expect(processDueSchedules).toHaveBeenCalledTimes(1);

    pending.resolve({
      considered: 0,
      due: 0,
      enqueued: 0,
      skipped: 0,
      skippedActive: 0,
      errors: 0,
    });

    await Promise.all([first, second]);

    expect(processDueSchedules).toHaveBeenCalledTimes(1);
    expect(processDueSchedules).toHaveBeenCalledWith(client);
  });

  it("uses DEFAULT_SCHEDULE_POLL_MS when pollMs is omitted", () => {
    const defaultPoller = new SchedulePoller({
      client,
      processDueSchedules,
    });
    expect(defaultPoller.pollMs).toBe(DEFAULT_SCHEDULE_POLL_MS);
    expect(defaultPoller.pollMs).toBe(60000);
    defaultPoller.stop();
  });

  it("never uses non-positive pollMs as the interval delay (X1)", () => {
    const onLog = vi.fn();
    const zeroPoller = new SchedulePoller({
      client,
      processDueSchedules,
      pollMs: 0,
      onLog,
    });
    expect(zeroPoller.pollMs).toBeGreaterThan(0);
    expect(zeroPoller.pollMs).toBe(DEFAULT_SCHEDULE_POLL_MS);
    zeroPoller.stop();

    const negPoller = new SchedulePoller({
      client,
      processDueSchedules,
      pollMs: -5,
      onLog,
    });
    expect(negPoller.pollMs).toBeGreaterThan(0);
    expect(negPoller.pollMs).toBe(DEFAULT_SCHEDULE_POLL_MS);
    negPoller.stop();
  });
});

describe("SchedulePoller tick summary logs (O1)", () => {
  let processDueSchedules: Mock<(client: Client) => Promise<DueCheckResult>>;
  let onLog: Mock<(message: string) => void>;
  let poller: SchedulePoller;

  beforeEach(() => {
    processDueSchedules = vi.fn();
    onLog = vi.fn();
    poller = new SchedulePoller({
      client,
      processDueSchedules,
      pollMs: 1000,
      onLog,
    });
  });

  afterEach(() => {
    poller.stop();
  });

  it("emits structured DueCheckResult counters when due > 0", async () => {
    processDueSchedules.mockResolvedValueOnce({
      considered: 10,
      due: 3,
      enqueued: 2,
      skipped: 0,
      skippedActive: 1,
      errors: 0,
    });

    await poller.tick();

    expect(onLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /schedule tick:.*considered=10.*due=3.*enqueued=2.*skipped=0.*skippedActive=1.*errors=0/,
      ),
    );
  });

  it("emits structured DueCheckResult counters when errors > 0", async () => {
    processDueSchedules.mockResolvedValueOnce({
      considered: 4,
      due: 0,
      enqueued: 0,
      skipped: 1,
      skippedActive: 0,
      errors: 2,
    });

    await poller.tick();

    expect(onLog).toHaveBeenCalledWith(
      expect.stringMatching(
        /schedule tick:.*considered=4.*due=0.*enqueued=0.*skipped=1.*skippedActive=0.*errors=2/,
      ),
    );
  });

  it("does not emit a tick summary when due and errors are both zero", async () => {
    processDueSchedules.mockResolvedValueOnce({
      considered: 5,
      due: 0,
      enqueued: 0,
      skipped: 5,
      skippedActive: 0,
      errors: 0,
    });

    await poller.tick();

    expect(onLog).not.toHaveBeenCalled();
  });
});
