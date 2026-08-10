import type { Client } from "node-appwrite";
import type { DueCheckResult } from "@newsletter/shared";

/** Default interval when env is unset, invalid, or non-positive. */
export const DEFAULT_SCHEDULE_POLL_MS = 60000;

/** Minimum allowed poll interval — prevents busy-loop from tiny positive values. */
export const MIN_SCHEDULE_POLL_MS = 1000;

/**
 * Parse `WORKER_SCHEDULE_POLL_MS`. Invalid / non-positive → default;
 * positive values below {@link MIN_SCHEDULE_POLL_MS} are clamped to the floor.
 * Logs via `onLog` when falling back or clamping.
 */
export function parseSchedulePollMs(
  raw: string | undefined,
  onLog?: (message: string) => void,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    onLog?.(
      `WORKER_SCHEDULE_POLL_MS invalid (${raw ?? "unset"}); using default ${DEFAULT_SCHEDULE_POLL_MS}ms`,
    );
    return DEFAULT_SCHEDULE_POLL_MS;
  }
  if (parsed < MIN_SCHEDULE_POLL_MS) {
    onLog?.(
      `WORKER_SCHEDULE_POLL_MS ${parsed} below floor ${MIN_SCHEDULE_POLL_MS}ms; clamping to ${MIN_SCHEDULE_POLL_MS}ms`,
    );
    return MIN_SCHEDULE_POLL_MS;
  }
  return parsed;
}

function normalizePollMs(pollMs: number, onLog?: (message: string) => void): number {
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    onLog?.(
      `schedule pollMs invalid (${String(pollMs)}); using default ${DEFAULT_SCHEDULE_POLL_MS}ms`,
    );
    return DEFAULT_SCHEDULE_POLL_MS;
  }
  if (pollMs < MIN_SCHEDULE_POLL_MS) {
    onLog?.(
      `schedule pollMs ${pollMs} below floor ${MIN_SCHEDULE_POLL_MS}ms; clamping to ${MIN_SCHEDULE_POLL_MS}ms`,
    );
    return MIN_SCHEDULE_POLL_MS;
  }
  return pollMs;
}

export type SchedulePollerDeps = {
  client: Client;
  processDueSchedules: (client: Client) => Promise<DueCheckResult>;
  pollMs?: number;
  onLog?: (message: string) => void;
};

/**
 * Interval poller that invokes `processDueSchedules` with single-flight
 * protection (overlapping ticks are skipped while a tick is in progress).
 */
export class SchedulePoller {
  readonly pollMs: number;
  private ticking = false;
  private readonly deps: SchedulePollerDeps;
  private readonly log: (message: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SchedulePollerDeps) {
    this.deps = deps;
    this.log = deps.onLog ?? (() => {});
    this.pollMs = normalizePollMs(deps.pollMs ?? DEFAULT_SCHEDULE_POLL_MS, this.log);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const result = await this.deps.processDueSchedules(this.deps.client);
      if (result.due > 0 || result.errors > 0) {
        this.log(
          `schedule tick: considered=${result.considered} due=${result.due} enqueued=${result.enqueued} skipped=${result.skipped} skippedActive=${result.skippedActive} errors=${result.errors}`,
        );
      }
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) =>
        this.log(`schedule tick error: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
