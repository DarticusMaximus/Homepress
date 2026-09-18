import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  APP_NAME,
  getAppwriteConfig,
  getServerAppwrite,
  provisionDatabase,
  listPendingRuns,
  listActiveRunsForNewsletter,
  getRun,
  markFailed,
  executeRun,
  purgeExpiredRuns,
  processDueSchedules,
  sweepStaleRuns,
} from "@newsletter/shared";
import { RunPoller } from "./run-poller";
import { SchedulePoller, parseSchedulePollMs } from "./schedule-poller";
import { registerJob, getJob } from "./registry";

export { registerJob, getJob, listJobs } from "./registry";
export type { JobHandler } from "./registry";
export { RunPoller, shouldClaim } from "./run-poller";
export type { PollerDeps } from "./run-poller";
export { SchedulePoller, parseSchedulePollMs, DEFAULT_SCHEDULE_POLL_MS } from "./schedule-poller";
export type { SchedulePollerDeps } from "./schedule-poller";

// Walk upward from the process working directory to find the nearest `.env`.
// This is location-agnostic: works in dev (tsx from repo root), from the
// bundled `dist/index.js`, and gracefully no-ops in a container where env
// comes from `env_file` instead. Best-effort — never throws.
function findEnvFile(start: string): string | undefined {
  for (let dir = start; ; dir = resolve(dir, "..")) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return undefined;
  }
}

try {
  const envPath = findEnvFile(process.cwd());
  if (envPath) process.loadEnvFile(envPath);
} catch {
  // .env missing/unreadable or already present in process.env; continue
}

const PREFIX = "[worker]";

function log(message: string): void {
  console.log(`${PREFIX} ${message}`);
}

log(`starting ${APP_NAME} worker (pid ${process.pid})`);

try {
  getServerAppwrite();
  const { endpoint, projectId } = getAppwriteConfig();
  log(`appwrite server-client initialized: endpoint=${endpoint} project=${projectId}`);
} catch (err) {
  log(`appwrite init failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const client = getServerAppwrite();

registerJob("execute-run", async (input: unknown) => {
  const { runId } = input as { runId: string };
  await executeRun(client, runId);
});
log(`registered job: execute-run`);

registerJob("purge-expired-runs", async () => {
  try {
    const result = await purgeExpiredRuns(getServerAppwrite());
    log(
      `retention purge: deleted=${result.deleted} errors=${result.errors} retentionDays=${result.retentionDays}`,
    );
  } catch (err) {
    log(`retention purge failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});
log(`registered job: purge-expired-runs`);

const parsedPollMs = Number.parseInt(process.env.WORKER_RUN_POLL_MS ?? "", 10);
const pollMs = Number.isFinite(parsedPollMs) ? parsedPollMs : 3000;

const DEFAULT_STALE_RUN_MS = 300000;
const MIN_STALE_RUN_MS = 60000;

function parseStaleRunMs(raw: string | undefined, onLog?: (message: string) => void): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    onLog?.(
      `WORKER_STALE_RUN_MS invalid (${raw ?? "unset"}); using default ${DEFAULT_STALE_RUN_MS}ms`,
    );
    return DEFAULT_STALE_RUN_MS;
  }
  if (parsed < MIN_STALE_RUN_MS) {
    onLog?.(
      `WORKER_STALE_RUN_MS ${parsed} below floor ${MIN_STALE_RUN_MS}ms; clamping to ${MIN_STALE_RUN_MS}ms`,
    );
    return MIN_STALE_RUN_MS;
  }
  return parsed;
}

const staleRunMs = parseStaleRunMs(process.env.WORKER_STALE_RUN_MS, (message) => log(message));

const poller = new RunPoller({
  client,
  listPendingRuns,
  listActiveRunsForNewsletter,
  executeJob: async (runId: string) => {
    const job = getJob("execute-run");
    if (job) {
      await job({ runId });
    }
  },
  getRun,
  markFailed,
  pollMs,
  onLog: (message: string) => log(message),
});

void (async () => {
  // The sweep is for the ungraceful case only.
  try {
    const { swept } = await sweepStaleRuns(client, { staleMs: staleRunMs });
    if (swept > 0) log(`stale-run reaper boot: swept=${swept}`);
  } catch (err) {
    log(`stale-run reaper boot failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  poller.start();
  log(`run poller started: pollMs=${pollMs}`);
})();

const schedulePollMs = parseSchedulePollMs(process.env.WORKER_SCHEDULE_POLL_MS, (message) =>
  log(message),
);
const schedulePoller = new SchedulePoller({
  client,
  processDueSchedules,
  pollMs: schedulePollMs,
  onLog: (message: string) => log(message),
});
schedulePoller.start();
log(`schedule poller started: pollMs=${schedulePollMs}`);

void (async () => {
  try {
    const provisionResult = await provisionDatabase(getServerAppwrite());
    log(
      `schema provisioned: db=created:${provisionResult.databases.created}/skipped:${provisionResult.databases.skipped}/failed:${provisionResult.databases.failed} collections=created:${provisionResult.collections.created}/skipped:${provisionResult.collections.skipped}/failed:${provisionResult.collections.failed}/drift:${provisionResult.collections.drift} attributes=created:${provisionResult.attributes.created}/skipped:${provisionResult.attributes.skipped}/failed:${provisionResult.attributes.failed}/drift:${provisionResult.attributes.drift} buckets=created:${provisionResult.buckets.created}/skipped:${provisionResult.buckets.skipped}/failed:${provisionResult.buckets.failed} warnings=${provisionResult.warnings?.length ?? 0}`,
    );
  } catch (err) {
    log(`schema provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Best-effort boot purge after provision settles
  try {
    const purgeJob = getJob("purge-expired-runs");
    if (purgeJob) await purgeJob(undefined);
  } catch {
    // Best-effort — errors already logged inside the job handler
  }
})();

const parsedHeartbeat = Number.parseInt(process.env.WORKER_HEARTBEAT_MS ?? "", 10);
const heartbeatMs = Number.isFinite(parsedHeartbeat) ? parsedHeartbeat : 30000;

let tick = 0;
const interval = setInterval(() => {
  tick += 1;
  log(`heartbeat tick=${tick} uptime=${process.uptime().toFixed(0)}s`);
  void sweepStaleRuns(client, { staleMs: staleRunMs }).catch((err) =>
    log(`stale-run reaper error: ${err instanceof Error ? err.message : String(err)}`),
  );
}, heartbeatMs);

const parsedRetentionMs = Number.parseInt(process.env.WORKER_RETENTION_POLL_MS ?? "", 10);
const retentionMs = Number.isFinite(parsedRetentionMs) ? parsedRetentionMs : 86400000; // 24h default
let retentionInFlight = false;
const retentionInterval = setInterval(() => {
  if (retentionInFlight) return; // single-flight
  retentionInFlight = true;
  const purgeJob = getJob("purge-expired-runs");
  if (purgeJob) {
    void purgeJob(undefined).finally(() => {
      retentionInFlight = false;
    });
  } else {
    retentionInFlight = false;
  }
}, retentionMs);
log(`retention poller started: pollMs=${retentionMs}`);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(interval);
  clearInterval(retentionInterval);
  schedulePoller.stop();
  log(`received ${signal}, shutting down`);
  const forceExit = setTimeout(() => process.exit(0), 5000);
  forceExit.unref();
  void poller.shutdown().finally(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
