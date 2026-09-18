import type { Client } from "node-appwrite";
import type { RunPhase } from "../schema/declarations";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { listRuns, markFailed } from "./repository";
import type { MarkFailedInput, Run } from "./types";

export const DEFAULT_STALE_RUN_MS = 300_000;

export type SweepStaleRunsOptions = {
  staleMs?: number;
  now?: Date | number;
  listRuns?: (
    client: Client,
    opts?: { newsletterId?: string; status?: Run["status"] | Run["status"][]; limit?: number },
  ) => Promise<Run[]>;
  markFailed?: (client: Client, runId: string, input: MarkFailedInput) => Promise<Run>;
  onLog?: (message: string) => void;
};

export async function sweepStaleRuns(
  client: Client,
  opts?: SweepStaleRunsOptions,
): Promise<{ swept: number }> {
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_RUN_MS;
  const nowMs = opts?.now === undefined ? Date.now() : toEpochMs(opts.now);
  const list = opts?.listRuns ?? listRuns;
  const fail = opts?.markFailed ?? markFailed;
  const onLog = opts?.onLog;

  const runs = await list(client, { status: "running", limit: 100 });
  let swept = 0;

  for (const run of runs) {
    const lastBeat = Date.parse(run.lastHeartbeatAt ?? run.startedAt);
    if (!(nowMs - lastBeat > staleMs)) continue;

    const phase = (run.currentPhase || "fetch") as RunPhase;
    try {
      await fail(client, run.$id, {
        failedPhase: phase,
        failureMessage: `Run marked failed by stale-run reaper: heartbeat lost during "${phase}" phase (worker crash or heartbeat stall)`,
      });
      swept += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const sanitized = sanitizeAppwriteMessageForLog(message);
      if (onLog) {
        onLog(sanitized);
      } else {
        console.error({ phase: "stale-run-reaper", runId: run.$id, message: sanitized });
      }
    }
  }

  return { swept };
}

function toEpochMs(now: Date | number): number {
  return now instanceof Date ? now.getTime() : now;
}
