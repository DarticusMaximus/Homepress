import type { Client } from "node-appwrite";

import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { ALREADY_IN_PROGRESS_CODE, enqueueNewsletterRun } from "../runs/start";
import { listRuns } from "../runs/repository";
import type { Run } from "../runs/types";
import {
  listAllNewslettersForDueCheck,
  setScheduleLastFiredAt,
  type SetScheduleLastFiredAtOpts,
} from "./repository";
import { computePreviousFireAt, isScheduleDue } from "./schedule";
import type { Newsletter } from "./types";

export type DueCheckResult = {
  considered: number;
  due: number;
  enqueued: number;
  skipped: number;
  skippedActive: number;
  errors: number;
};

export type ProcessDueSchedulesOpts = {
  now?: Date;
  /**
   * Newsletter listing for this tick. Defaults to
   * `listAllNewslettersForDueCheck` (full cursor walk) so schedules beyond the
   * GUI first page are not starved (C2). Tests may inject a fixture list.
   */
  listNewsletters?: (client: Client) => Promise<Newsletter[]>;
  enqueue?: typeof enqueueNewsletterRun;
  setLastFired?: (
    client: Client,
    id: string,
    iso: string,
    opts?: SetScheduleLastFiredAtOpts,
  ) => Promise<void>;
  /**
   * Lookup runs for secondary durable consume reconcile (default: `listRuns`).
   * Used when stamp is still null but a prior scheduled run may cover this fire.
   * Fail-closed: lookup errors skip enqueue (do not double-fire).
   */
  listRuns?: typeof listRuns;
  /** Injected sleep for stamp backoff (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Total stamp-claim attempts before giving up (default 3). */
  stampMaxAttempts?: number;
  /**
   * In-process consume ledger: after a successful stamp-first claim (or a
   * durable run-history hit), later ticks in this process stamp-reconcile only
   * and never re-enqueue the same previousFire. Defaults to a module-level set.
   * Primary durability across restart is the Appwrite stamp itself.
   */
  consumedFires?: Set<string>;
};

const DEFAULT_STAMP_MAX_ATTEMPTS = 3;
/** Cap run lookback for scheduled-fire reconcile (newest-first from listRuns). */
const SCHEDULED_FIRE_RECONCILE_LIMIT = 25;

/** Module-level consume ledger for the worker process (see opts.consumedFires). */
const defaultConsumedFires = new Set<string>();

/** Test helper: clear the default consume ledger between cases. */
export function resetConsumedScheduleFiresForTests(): void {
  defaultConsumedFires.clear();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fireConsumeKey(newsletterId: string, previousFireIso: string): string {
  return `${newsletterId}:${previousFireIso}`;
}

/**
 * Whether a run is durable evidence that `previousFire` was already consumed:
 * a scheduled run whose `startedAt` is at or after that fire instant.
 */
export function runCoversScheduledFire(run: Run, previousFireIso: string): boolean {
  if (run.trigger !== "scheduled") {
    return false;
  }
  const startedMs = new Date(run.startedAt).getTime();
  const fireMs = new Date(previousFireIso).getTime();
  if (Number.isNaN(startedMs) || Number.isNaN(fireMs)) {
    return false;
  }
  return startedMs >= fireMs;
}

type DurableConsumeLookup = "consumed" | "free" | "uncertain";

/**
 * Secondary durable consume check: look for an existing scheduled run covering
 * this fire (e.g. legacy enqueue-before-stamp, or stamp missing after restart).
 * Fail-closed: lookup errors return `"uncertain"` so callers skip enqueue.
 */
async function lookupDurableScheduledFireConsume(
  client: Client,
  newsletterId: string,
  previousFireIso: string,
  listRunsFn: typeof listRuns,
): Promise<DurableConsumeLookup> {
  try {
    const runs = await listRunsFn(client, {
      newsletterId,
      limit: SCHEDULED_FIRE_RECONCILE_LIMIT,
    });
    return runs.some((run) => runCoversScheduledFire(run, previousFireIso))
      ? "consumed"
      : "free";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error({
      phase: "process-due-schedules",
      newsletterId,
      message: sanitizeAppwriteMessageForLog(
        `scheduled-fire reconcile lookup failed (fail-closed): ${errMsg}`,
      ),
    });
    return "uncertain";
  }
}

/**
 * Retry `setScheduleLastFiredAt` with bounded exponential backoff. Always uses
 * stamp-with-compare so retries are idempotent. Returns true on success.
 */
async function stampFireDurable(
  client: Client,
  newsletterId: string,
  previousFireIso: string,
  setLastFiredFn: NonNullable<ProcessDueSchedulesOpts["setLastFired"]>,
  sleepFn: (ms: number) => Promise<void>,
  maxAttempts: number,
): Promise<boolean> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await setLastFiredFn(client, newsletterId, previousFireIso, { compare: true });
      return true;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        await sleepFn(delay);
      }
    }
  }

  const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.error({
    phase: "process-due-schedules",
    newsletterId,
    message: sanitizeAppwriteMessageForLog(
      `scheduleLastFiredAt stamp failed after ${maxAttempts} attempt(s): ${errMsg}`,
    ),
  });
  return false;
}

/**
 * Stamp-only reconcile path after an in-process or durable consume hit.
 */
async function reconcileMissingStamp(
  client: Client,
  newsletterId: string,
  previousFireIso: string,
  consumeKey: string,
  consumedFires: Set<string>,
  setLastFiredFn: NonNullable<ProcessDueSchedulesOpts["setLastFired"]>,
  sleepFn: (ms: number) => Promise<void>,
  stampMaxAttempts: number,
  result: DueCheckResult,
): Promise<void> {
  const stamped = await stampFireDurable(
    client,
    newsletterId,
    previousFireIso,
    setLastFiredFn,
    sleepFn,
    stampMaxAttempts,
  );
  if (stamped) {
    consumedFires.delete(consumeKey);
  } else {
    result.errors += 1;
  }
}

/**
 * Find enabled schedules whose previous fire has arrived and enqueue a pending
 * run via `enqueueNewsletterRun(..., { trigger: "scheduled" })`.
 *
 * **Stamp-first claim (C1):** when due, claim the previousFire slot by writing
 * `scheduleLastFiredAt` (stamp-with-compare + retries) *before* enqueue or
 * busy-skip. If the stamp fails permanently, do not enqueue. Once the stamp
 * lands, busy-skip and enqueue success/failure all leave the slot consumed
 * (aligned with no catch-up) — a worker restart cannot re-fire that slot.
 *
 * Secondary durability: in-process consume ledger + run-history reconcile
 * (scheduled run with `startedAt` ≥ previousFire). listRuns errors are
 * fail-closed (skip enqueue) so a stamp-miss restart cannot double-fire.
 *
 * Processes every due newsletter independently — never stops after the first.
 * Catch-up is a single latest previous fire (`isScheduleDue`); does not loop `prev()`.
 */
export async function processDueSchedules(
  client: Client,
  opts?: ProcessDueSchedulesOpts,
): Promise<DueCheckResult> {
  const now = opts?.now ?? new Date();
  const listFn = opts?.listNewsletters ?? listAllNewslettersForDueCheck;
  const enqueueFn = opts?.enqueue ?? enqueueNewsletterRun;
  const setLastFiredFn = opts?.setLastFired ?? setScheduleLastFiredAt;
  const listRunsFn = opts?.listRuns ?? listRuns;
  const sleepFn = opts?.sleep ?? defaultSleep;
  const stampMaxAttempts = opts?.stampMaxAttempts ?? DEFAULT_STAMP_MAX_ATTEMPTS;
  const consumedFires = opts?.consumedFires ?? defaultConsumedFires;

  const newsletters = await listFn(client);

  const result: DueCheckResult = {
    considered: newsletters.length,
    due: 0,
    enqueued: 0,
    skipped: 0,
    skippedActive: 0,
    errors: 0,
  };

  for (const newsletter of newsletters) {
    if (!isScheduleDue(newsletter, now)) {
      continue;
    }

    result.due += 1;

    const previousFire = computePreviousFireAt(
      newsletter.scheduleCron,
      newsletter.scheduleTimezone,
      now,
    );
    if (previousFire === null) {
      // isScheduleDue should have ruled this out; treat as a soft error and continue.
      result.errors += 1;
      console.error({
        phase: "process-due-schedules",
        newsletterId: newsletter.$id,
        message: "due newsletter missing previous fire",
      });
      continue;
    }

    const previousFireIso = previousFire.toISOString();
    const consumeKey = fireConsumeKey(newsletter.$id, previousFireIso);

    // Already claimed this slot in-process — stamp-reconcile only, never re-enqueue.
    if (consumedFires.has(consumeKey)) {
      await reconcileMissingStamp(
        client,
        newsletter.$id,
        previousFireIso,
        consumeKey,
        consumedFires,
        setLastFiredFn,
        sleepFn,
        stampMaxAttempts,
        result,
      );
      continue;
    }

    // Secondary: scheduled run already covers this fire (stamp still null).
    const durableLookup = await lookupDurableScheduledFireConsume(
      client,
      newsletter.$id,
      previousFireIso,
      listRunsFn,
    );
    if (durableLookup === "consumed") {
      consumedFires.add(consumeKey);
      await reconcileMissingStamp(
        client,
        newsletter.$id,
        previousFireIso,
        consumeKey,
        consumedFires,
        setLastFiredFn,
        sleepFn,
        stampMaxAttempts,
        result,
      );
      continue;
    }
    if (durableLookup === "uncertain") {
      // Fail-closed: do not enqueue when reconcile cannot confirm the slot is free.
      result.errors += 1;
      continue;
    }

    // Stamp-first claim — durable consume before enqueue / busy-skip.
    const claimed = await stampFireDurable(
      client,
      newsletter.$id,
      previousFireIso,
      setLastFiredFn,
      sleepFn,
      stampMaxAttempts,
    );
    if (!claimed) {
      result.errors += 1;
      continue;
    }

    // Slot is durable in Appwrite; ledger covers same-process ticks with a stale list.
    consumedFires.add(consumeKey);

    try {
      const enqueueResult = await enqueueFn(client, newsletter.$id, { trigger: "scheduled" });

      if (!enqueueResult.ok) {
        if (enqueueResult.code === ALREADY_IN_PROGRESS_CODE) {
          result.skippedActive += 1;
          console.error({
            phase: "process-due-schedules",
            newsletterId: newsletter.$id,
            message: "schedule fire skipped — run already in progress",
          });
          continue;
        }

        result.skipped += 1;
        console.error({
          phase: "process-due-schedules",
          newsletterId: newsletter.$id,
          message: sanitizeAppwriteMessageForLog(
            enqueueResult.error || "enqueue returned not ok",
          ),
        });
        continue;
      }

      result.enqueued += 1;
    } catch (err) {
      result.errors += 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error({
        phase: "process-due-schedules",
        newsletterId: newsletter.$id,
        message: sanitizeAppwriteMessageForLog(errMsg),
      });
    }
  }

  return result;
}
