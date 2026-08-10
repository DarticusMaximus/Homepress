import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  APP_NAME,
  getAppwriteConfig,
  getServerAppwrite,
  provisionDatabase,
  listPendingRuns,
  listActiveRunsForNewsletter,
  markFailed,
  executeRun,
  purgeExpiredRuns,
  processDueSchedules,
} from "@newsletter/shared";
import type { Article } from "@newsletter/shared";
import type { ArticleScorer, ArticleTagger, LLMClient, MMRSelector } from "@newsletter/shared";
import { getModelName, sanitizeUrlForLog, scrapeArticle } from "@newsletter/shared";
import { runPipeline, NewsletterDrafter } from "@newsletter/shared";
import { RunPoller } from "./run-poller";
import { SchedulePoller, parseSchedulePollMs } from "./schedule-poller";
import { registerJob, getJob } from "./registry";

// Cross-package smoke reference: proves the pipeline module is reachable and
// type-resolves from `worker`. Referenced in the startup log below so tsc
// treats them as used (and they genuinely exercise resolution at compile time).
const DEFAULT_ARTICLE: Article = {
  title: "smoke",
  link: "https://example.com/smoke",
  published: new Date(0),
  content: "",
  source: "smoke",
};
const DEFAULT_MODEL = getModelName("tagger");
// Fetcher smoke reference: proves the rss-fetcher export is reachable and
// type-resolves from `worker` at compile time. Not invoked — no network.
const DEFAULT_FEED_URL = sanitizeUrlForLog("https://example.com/feed.xml");
// Scraper smoke reference: proves the scraper export is reachable and
// type-resolves from `worker` at compile time. Not invoked — no network.
const SCRAPER_FN = scrapeArticle;
// Tagger/LLM smoke reference: proves the tagger and llm-client exports are
// reachable and type-resolve from `worker` at compile time. Not instantiated
// — instantiating LLMClient would require OPENROUTER_API_KEY.
const TAGGER_INSTANCE: ArticleTagger | undefined = undefined;
const LLM_INSTANCE: LLMClient | undefined = undefined;
// Scorer smoke reference: proves the scorer export is reachable and
// type-resolves from `worker` at compile time. Not instantiated —
// instantiating would require OPENROUTER_API_KEY via LLMClient.
const SCORER_INSTANCE: ArticleScorer | undefined = undefined;
// MMR smoke reference: proves the mmr-selection export is reachable and
// type-resolves from `worker` at compile time. Not instantiated —
// instantiating would require OPENROUTER_API_KEY via LLMClient embeddings.
const MMR_INSTANCE: MMRSelector | undefined = undefined;
// Pipeline + drafter smoke reference: proves the orchestrator and drafter
// exports are reachable and type-resolve from `worker` at compile time. Not
// invoked — running the pipeline / instantiating the drafter would require
// OPENROUTER_API_KEY.
const PIPELINE_FN = runPipeline;
const DRAFTER_CTOR = NewsletterDrafter;

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
log(
  `pipeline smoke: model=${DEFAULT_MODEL} sample-title=${DEFAULT_ARTICLE.title} feed=${DEFAULT_FEED_URL} scraper=${typeof SCRAPER_FN} tagger=${typeof TAGGER_INSTANCE} llm=${typeof LLM_INSTANCE} scorer=${typeof SCORER_INSTANCE} mmr=${typeof MMR_INSTANCE} runPipeline=${typeof PIPELINE_FN} drafter=${typeof DRAFTER_CTOR}`,
);

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
  markFailed,
  pollMs,
  onLog: (message: string) => log(message),
});
poller.start();
log(`run poller started: pollMs=${pollMs}`);

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
