import type { Client } from "node-appwrite";
import type { Run, RunPhase } from "@newsletter/shared";

const SHUTDOWN_MESSAGE = "Worker shut down during run";
const DEFAULT_POLL_MS = 3000;

export interface PollerDeps {
  client: Client;
  listPendingRuns: (client: Client, opts?: { limit?: number }) => Promise<Run[]>;
  listActiveRunsForNewsletter: (client: Client, newsletterId: string) => Promise<Run[]>;
  executeJob: (runId: string) => Promise<void>;
  markFailed: (
    client: Client,
    runId: string,
    input: { failedPhase: RunPhase; failureMessage: string },
  ) => Promise<Run>;
  pollMs?: number;
  onLog?: (message: string) => void;
}

export function shouldClaim(candidate: Run, allActives: Run[]): boolean {
  for (const other of allActives) {
    if (other.$id === candidate.$id) continue;
    if (other.status === "running") return false;
    if (other.status === "pending") {
      const byStarted = other.startedAt.localeCompare(candidate.startedAt);
      if (byStarted < 0) return false;
      if (byStarted === 0 && other.$id.localeCompare(candidate.$id) < 0) {
        return false;
      }
    }
  }
  return true;
}

export class RunPoller {
  inFlight = false;
  currentRunId: string | null = null;

  private ticking = false;
  private readonly deps: PollerDeps;
  private readonly pollMs: number;
  private readonly log: (message: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: PollerDeps) {
    this.deps = deps;
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
    this.log = deps.onLog ?? (() => {});
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    if (this.ticking) return;
    this.ticking = true;

    try {
      let candidates: Run[];
      try {
        candidates = await this.deps.listPendingRuns(this.deps.client, {
          limit: 1,
        });
      } catch (err) {
        this.log(`poll error: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      if (candidates.length === 0) return;

      const candidate = candidates[0];
      if (candidate === undefined) return;

      let actives: Run[];
      try {
        actives = await this.deps.listActiveRunsForNewsletter(
          this.deps.client,
          candidate.newsletterId,
        );
      } catch (err) {
        this.log(`claim check error: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      if (!shouldClaim(candidate, actives)) return;

      this.inFlight = true;
      this.currentRunId = candidate.$id;

      try {
        await this.deps.executeJob(candidate.$id);
      } catch (err) {
        this.log(
          `execute error for run ${candidate.$id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.inFlight = false;
        this.currentRunId = null;
      }
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) =>
        this.log(`tick error: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    if (this.inFlight && this.currentRunId) {
      try {
        await this.deps.markFailed(this.deps.client, this.currentRunId, {
          failedPhase: "fetch",
          failureMessage: SHUTDOWN_MESSAGE,
        });
      } catch (err) {
        this.log(`shutdown markFailed error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.inFlight = false;
        this.currentRunId = null;
      }
    }
  }
}
