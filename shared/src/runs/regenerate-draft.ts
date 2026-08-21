import type { Client } from "node-appwrite";
import {
  getRun,
  findActiveRunForNewsletter,
  listActiveRunsForNewsletter,
  loadPhaseCheckpoint,
  requeueCompletedRunForDraft,
  restoreCompleted,
  markFailed,
} from "./repository";
import { RunRepositoryError } from "./types";
import type { Run } from "./types";
import type { RunPhase } from "../schema/declarations";
import type { RetryResult } from "./retry";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

/** Same user-facing string as retry.ts (GENERIC_ERROR is not exported). */
const GENERIC_ERROR = "Something went wrong while talking to the database. Please try again.";

/**
 * Discriminator for a regenerate-draft resume: worker startPhase is draft,
 * the run still has a preserved endedAt (failed-retry requeue clears it),
 * and a prior draft checkpoint id exists to restore from on abort.
 */
export function isDraftRegenerateRun(
  run: Pick<Run, "endedAt" | "checkpointDraftId">,
  startPhase: RunPhase,
): boolean {
  return (
    startPhase === "draft" &&
    typeof run.endedAt === "string" &&
    run.endedAt.length > 0 &&
    typeof run.checkpointDraftId === "string" &&
    run.checkpointDraftId.length > 0
  );
}

/**
 * Requeue a completed draft-phase run so the worker resumes at draft.
 * Guards (steps 1–5) lock the Feature 04 error strings. This function never
 * executes the drafter — it only validates and requeues. Race cleanup
 * restores this run to completed; it never markFaileds this run id.
 */
export async function requestRegenerateDraft(
  client: Client,
  runId: string,
): Promise<RetryResult> {
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

  // Capture before requeue — restoreCompleted must write this ISO, not a new one.
  const preservedEndedAt = run.endedAt ?? "";

  // Step 2: status !== "completed"
  if (run.status !== "completed") {
    return { ok: false, error: "Only completed runs can regenerate their draft" };
  }

  // Step 3: completedPhase !== "draft"
  if (run.completedPhase !== "draft") {
    return {
      ok: false,
      error: "This run cannot regenerate its draft; start a new run instead",
    };
  }

  // Step 4: findActiveRunForNewsletter — non-null → active-run guard
  const activeRun = await findActiveRunForNewsletter(client, run.newsletterId);
  if (activeRun !== null) {
    return {
      ok: false,
      error: "A run is already in progress for this newsletter",
    };
  }

  // Step 5: load selection then draft checkpoints
  for (const phase of ["selection", "draft"] as const) {
    try {
      await loadPhaseCheckpoint(client, runId, phase);
    } catch (checkpointErr) {
      const isCheckpointMissing =
        checkpointErr instanceof RunRepositoryError && checkpointErr.code === "checkpoint_missing";
      const errMsg = checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr);
      console.error({
        phase: `regenerate-draft-checkpoint-${phase}`,
        runId,
        code: isCheckpointMissing ? "checkpoint_missing" : "appwrite",
        message: sanitizeAppwriteMessageForLog(errMsg),
      });
      return {
        ok: false,
        error: isCheckpointMissing
          ? "Cannot regenerate: checkpoint data is missing. Start a new run instead."
          : "Could not load checkpoint due to a database error. Try again.",
      };
    }
  }

  // Step 6: requeue (status → pending, completedPhase → selection)
  // Step 7: race re-check — extras may markFailed; this runId restores completed
  try {
    await requeueCompletedRunForDraft(client, runId);

    const actives = await listActiveRunsForNewsletter(client, run.newsletterId);
    if (actives.length > 1) {
      for (let i = 1; i < actives.length; i++) {
        const superseded = actives[i];
        if (superseded.$id === runId) {
          continue;
        }
        try {
          await markFailed(client, superseded.$id, {
            failedPhase: "fetch",
            failureMessage: "Superseded by a concurrent start",
          });
        } catch (cleanupErr) {
          const errMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          console.error({
            phase: "regenerate-draft-race-cleanup",
            runId: superseded.$id,
            message: sanitizeAppwriteMessageForLog(errMsg),
          });
        }
      }
      if (actives[0].$id !== runId) {
        try {
          await restoreCompleted(client, runId, { endedAt: preservedEndedAt });
        } catch (restoreErr) {
          const errMsg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
          console.error({
            phase: "regenerate-draft-race-restore",
            runId,
            message: sanitizeAppwriteMessageForLog(errMsg),
          });
        }
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

  return { ok: true };
}
