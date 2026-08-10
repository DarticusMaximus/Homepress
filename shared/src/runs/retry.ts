import type { Client } from "node-appwrite";
import {
  getRun,
  findActiveRunForNewsletter,
  listActiveRunsForNewsletter,
  loadPhaseCheckpoint,
  requeueFailedRun,
  markFailed,
} from "./repository";
import { resumeStartPhase } from "./phases";
import { RunRepositoryError } from "./types";
import type { RunPhase } from "../schema/declarations";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

export type RetryResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong while talking to the database. Please try again.";

/**
 * Retry a failed run from its failed phase, reusing durable checkpoints for
 * every completed phase. Guards (steps 1–3) lock the Feature 03 error strings.
 * Steps 4–8 validate resume-ability, verify checkpoint availability, requeue,
 * and mirror Feature 02's race-recheck cleanup. This function never executes
 * pipeline phases — it only validates and requeues.
 */
export async function requestFailedRunRetry(client: Client, runId: string): Promise<RetryResult> {
  // Step 1: getRun — missing → "Run not found"
  let run;
  try {
    run = await getRun(client, runId);
  } catch (err) {
    if (err instanceof RunRepositoryError && err.code === "not_found") {
      return { ok: false, error: "Run not found" };
    }
    if (err instanceof RunRepositoryError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  // Step 2: status !== "failed" → "Only failed runs can be retried"
  if (run.status !== "failed") {
    return { ok: false, error: "Only failed runs can be retried" };
  }

  // Step 3: findActiveRunForNewsletter — non-null → active-run guard
  const activeRun = await findActiveRunForNewsletter(client, run.newsletterId);
  if (activeRun !== null) {
    return {
      ok: false,
      error: "A run is already in progress for this newsletter",
    };
  }

  // Step 4: compute resume start phase from completedPhase
  const startPhase = resumeStartPhase(run.completedPhase as RunPhase | "");
  if (startPhase === null) {
    return {
      ok: false,
      error: "This run cannot be resumed; start a new run instead",
    };
  }

  // Step 5: verify checkpoint exists when resuming past fetch
  if (startPhase !== "fetch") {
    try {
      await loadPhaseCheckpoint(client, runId, run.completedPhase as RunPhase);
    } catch (checkpointErr) {
      const isCheckpointMissing =
        checkpointErr instanceof RunRepositoryError && checkpointErr.code === "checkpoint_missing";
      const errMsg = checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr);
      console.error({
        phase: `retry-checkpoint-${run.completedPhase}`,
        runId,
        code: isCheckpointMissing ? "checkpoint_missing" : "appwrite",
        message: sanitizeAppwriteMessageForLog(errMsg),
      });
      return {
        ok: false,
        error: isCheckpointMissing
          ? "Cannot retry: checkpoint data is missing. Start a new run instead."
          : "Could not load checkpoint due to a database error. Try again.",
      };
    }
  }

  // Step 6: requeue the failed run (status → pending, clear failure fields)
  // Step 7: race re-check — mirror Feature 02's concurrent-start cleanup
  try {
    await requeueFailedRun(client, runId);

    const actives = await listActiveRunsForNewsletter(client, run.newsletterId);
    if (actives.length > 1) {
      for (let i = 1; i < actives.length; i++) {
        const superseded = actives[i];
        const failedPhase: RunPhase = superseded.$id === runId ? startPhase : "fetch";
        try {
          await markFailed(client, superseded.$id, {
            failedPhase,
            failureMessage: "Superseded by a concurrent start",
          });
        } catch (cleanupErr) {
          const errMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          console.error({
            phase: "retry-race-cleanup",
            runId: superseded.$id,
            message: sanitizeAppwriteMessageForLog(errMsg),
          });
        }
      }
      if (actives[0].$id !== runId) {
        return {
          ok: false,
          error: "A run is already in progress for this newsletter",
        };
      }
    }
  } catch (err) {
    if (err instanceof RunRepositoryError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  // Step 8: sole or oldest active run
  return { ok: true };
}
