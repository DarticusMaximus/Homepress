import type { Client } from "node-appwrite";
import type { Run } from "./types";
import { RunRepositoryError } from "./types";
import {
  MIN_RUN_RETENTION_DAYS,
  MAX_RUN_RETENTION_DAYS,
  PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER,
} from "../schema/declarations";
import { getOrCreateAppSettings } from "../settings/repository";
import { getRun, deleteRun, listAllRuns } from "./repository";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pure selection of runs eligible for deletion under the retention policy.
 *
 * 1. Clamp `retentionDays` to `[MIN, MAX]` defensively.
 * 2. `cutoffMs = now - retentionDays` days.
 * 3. Group runs by `newsletterId`; for each group compute the
 *    `PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER` most-recent completed run ids
 *    (sort key: `endedAt` desc, fallback `startedAt`, tie-break `$id` desc).
 * 4. A run is eligible iff status is not active (pending/running), it is not
 *    in its newsletter's protected-completed set, and `startedAt` is older
 *    than `cutoffMs`.
 * 5. Return eligible runs sorted `startedAt` ascending, then `$id` ascending.
 */
export function selectRunsForDeletion(
  runs: Run[],
  retentionDays: number,
  now: Date = new Date(),
): Run[] {
  const clampedDays = Math.max(
    MIN_RUN_RETENTION_DAYS,
    Math.min(MAX_RUN_RETENTION_DAYS, retentionDays),
  );
  const cutoffMs = now.getTime() - clampedDays * MS_PER_DAY;

  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const group = groups.get(run.newsletterId);
    if (group) {
      group.push(run);
    } else {
      groups.set(run.newsletterId, [run]);
    }
  }

  const protectedSets = new Map<string, Set<string>>();
  for (const [nlId, group] of groups) {
    protectedSets.set(nlId, buildProtectedCompletedSet(group));
  }

  const eligible: Run[] = [];
  for (const run of runs) {
    if (run.status === "pending" || run.status === "running") continue;
    const protectedSet = protectedSets.get(run.newsletterId)!;
    if (protectedSet.has(run.$id)) continue;
    if (Date.parse(run.startedAt) < cutoffMs) {
      eligible.push(run);
    }
  }

  eligible.sort((a, b) => {
    const byStarted = a.startedAt.localeCompare(b.startedAt);
    if (byStarted !== 0) return byStarted;
    return a.$id.localeCompare(b.$id);
  });

  return eligible;
}

function buildProtectedCompletedSet(runs: Run[]): Set<string> {
  const completed = runs.filter((r) => r.status === "completed");
  completed.sort((a, b) => {
    const aKey = a.endedAt || a.startedAt;
    const bKey = b.endedAt || b.startedAt;
    const cmp = bKey.localeCompare(aKey);
    if (cmp !== 0) return cmp;
    return b.$id.localeCompare(a.$id);
  });
  return new Set(completed.slice(0, PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER).map((r) => r.$id));
}

/**
 * Sweep the entire `runs` collection and delete expired runs according to the
 * retention policy. Resolves `retentionDays` from `opts` or app settings,
 * pages all runs via `listAllRuns`, selects eligible runs via
 * {@link selectRunsForDeletion}, then re-checks each before deleting.
 *
 * Re-check semantics: if the document is gone (404/not_found) the run is
 * treated as already cleaned (quiet skip). If the run has since become
 * pending/running it is skipped to avoid clobbering an active retry. Per-run
 * delete failures are caught, logged sanitized, and counted as `errors` —
 * never thrown.
 *
 * Returns `{ deleted, errors, retentionDays }`.
 */
export async function purgeExpiredRuns(
  client: Client,
  opts?: { retentionDays?: number; now?: Date },
): Promise<{ deleted: number; errors: number; retentionDays: number }> {
  let retentionDays: number;
  if (opts?.retentionDays !== undefined) {
    retentionDays = opts.retentionDays;
  } else {
    const settings = await getOrCreateAppSettings(client);
    retentionDays = settings.runRetentionDays;
  }

  const runs = await listAllRuns(client);
  const eligible = selectRunsForDeletion(runs, retentionDays, opts?.now);

  let deleted = 0;
  let errors = 0;

  for (const run of eligible) {
    let current: Run;
    try {
      current = await getRun(client, run.$id);
    } catch (err) {
      if (err instanceof RunRepositoryError && err.code === "not_found") {
        continue;
      }
      errors++;
      continue;
    }

    if (current.status === "pending" || current.status === "running") {
      continue;
    }

    try {
      await deleteRun(client, run.$id);
      deleted++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error({
        phase: "purge-expired-runs",
        runId: run.$id,
        message: sanitizeAppwriteMessageForLog(message),
      });
    }
  }

  return { deleted, errors, retentionDays };
}
