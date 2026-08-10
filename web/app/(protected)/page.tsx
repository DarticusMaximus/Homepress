import {
  FeedRepositoryError,
  getServerAppwrite,
  runHealthCheck,
  listDeliveryIssues,
  listFeeds,
  listIssues,
  listRuns,
  countUnhealthyFeeds,
  resolveIssueDisplayTitlesForRuns,
  RunRepositoryError,
  sanitizeAppwriteMessageForLog,
  type Feed,
  type HealthCheckResult,
  type Run,
} from "@newsletter/shared";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  buildAttentionItems,
  computeAttentionCounts,
  selectFailedDeliveryIssues,
  selectRecentIssues,
  selectRecentRuns,
} from "@/lib/dashboard-data";

type PageHealthResult = HealthCheckResult & { error?: string };

const SAFE_ISSUES_ERROR = "Unable to load recent issues";
const SAFE_RUNS_ERROR = "Unable to load recent runs";
const SAFE_FEEDS_ERROR = "Unable to load feed health";
const SAFE_HEALTH_ERROR = "Unable to run database health check";

type AppwriteExceptionLike = {
  code?: unknown;
  message?: unknown;
};

/** Structured dashboard log — message/code only, matching repository wrapAppwriteError. */
function logDashboardError(phase: string, err: unknown): void {
  let message: string;
  let code: number | undefined;
  if (err && typeof err === "object") {
    const e = err as AppwriteExceptionLike;
    code = typeof e.code === "number" ? e.code : undefined;
    message =
      typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
  } else {
    message = String(err);
  }
  console.error({
    phase: `dashboard-${phase}`,
    code,
    message: sanitizeAppwriteMessageForLog(message),
  });
}

function settledError(result: PromiseRejectedResult): unknown {
  return result.reason;
}

export default async function Home() {
  const client = getServerAppwrite();

  // Independent section fetches — do not await each other end-to-end (P1).
  const [healthSettled, feedsSettled, runsSettled, failedRunsSettled, issuesSettled] =
    await Promise.allSettled([
      runHealthCheck(client),
      listFeeds(client),
      listRuns(client, { limit: 100 }),
      listRuns(client, { status: "failed", limit: 100 }),
      listIssues(client),
    ]);

  // --- DB health ---
  let healthResult: PageHealthResult;
  if (healthSettled.status === "fulfilled") {
    healthResult = healthSettled.value;
  } else {
    logDashboardError("runHealthCheck", settledError(healthSettled));
    healthResult = {
      status: "failed",
      steps: [
        {
          step: "create",
          status: "failed",
          durationMs: 0,
          errorMessage: SAFE_HEALTH_ERROR,
          errorCode: undefined,
        },
      ],
      checkedAt: new Date().toISOString(),
      error: SAFE_HEALTH_ERROR,
    };
  }

  // --- Feeds (health strip + attention unhealthy count) ---
  let feeds: Feed[] = [];
  let feedsUnhealthyCount = 0;
  let feedsError: string | undefined;
  if (feedsSettled.status === "fulfilled") {
    feeds = feedsSettled.value;
    feedsUnhealthyCount = countUnhealthyFeeds(feeds);
  } else {
    const err = settledError(feedsSettled);
    logDashboardError("listFeeds", err);
    feedsError = err instanceof FeedRepositoryError ? err.message : SAFE_FEEDS_ERROR;
  }

  // --- Runs (Recent runs snapshot; unfiltered window-oriented fetch) ---
  let allRuns: Run[] = [];
  let runsError: string | null = null;
  if (runsSettled.status === "fulfilled") {
    allRuns = runsSettled.value;
  } else {
    const err = settledError(runsSettled);
    logDashboardError("listRuns", err);
    runsError = err instanceof RunRepositoryError ? err.message : SAFE_RUNS_ERROR;
  }
  const recentRuns = selectRecentRuns(allRuns);

  // --- Failed runs (attention only; dedicated status filter — C2) ---
  let failedRunsForAttention: Run[] = [];
  if (failedRunsSettled.status === "fulfilled") {
    failedRunsForAttention = failedRunsSettled.value;
  } else {
    logDashboardError("listRuns-failed", settledError(failedRunsSettled));
    // Leave empty — other sections / attention signals can still surface.
  }

  // --- Issues (recent issues + titles for the slice only) ---
  let allIssues: Run[] | null = null;
  let recentIssues: Run[] = [];
  let titleByRunId = new Map<string, string>();
  let issuesError: string | null = null;
  if (issuesSettled.status === "fulfilled") {
    allIssues = issuesSettled.value;
    recentIssues = selectRecentIssues(allIssues);
    if (recentIssues.length > 0) {
      try {
        titleByRunId = await resolveIssueDisplayTitlesForRuns(client, recentIssues);
      } catch (err) {
        logDashboardError("resolveIssueDisplayTitles", err);
        issuesError = err instanceof RunRepositoryError ? err.message : SAFE_ISSUES_ERROR;
        recentIssues = [];
      }
    }
  } else {
    const err = settledError(issuesSettled);
    logDashboardError("listIssues", err);
    issuesError = err instanceof RunRepositoryError ? err.message : SAFE_ISSUES_ERROR;
  }

  // --- Delivery failures (attention only) ---
  // Prefer reusing the already-loaded issues list (P1); fall back only when issues failed.
  let deliveryIssues: Run[] = [];
  if (allIssues !== null) {
    deliveryIssues = selectFailedDeliveryIssues(allIssues);
  } else {
    try {
      deliveryIssues = await listDeliveryIssues(client, { outcome: "any_failure" });
    } catch (err) {
      logDashboardError("listDeliveryIssues", err);
      // Leave empty — other attention signals can still surface.
    }
  }

  const attentionItems = buildAttentionItems(
    computeAttentionCounts({
      feeds,
      runs: failedRunsForAttention,
      issues: deliveryIssues,
    }),
  );

  return (
    <DashboardView
      attentionItems={attentionItems}
      recentIssues={recentIssues}
      titleByRunId={titleByRunId}
      issuesError={issuesError}
      recentRuns={recentRuns}
      runsError={runsError}
      healthResult={healthResult}
      feedsUnhealthyCount={feedsUnhealthyCount}
      feedsError={feedsError}
    />
  );
}
