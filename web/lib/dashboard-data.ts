import { hasDeliveryAttempt, type Feed, type Run } from "@newsletter/shared";
import { buildDeliveryHref } from "@/components/delivery/delivery-url";
import { buildFeedsHref } from "@/components/feeds/feeds-url";
import { buildRunsHref } from "@/lib/runs-url";

/** Recent issues limit (newest first). */
export const DASHBOARD_RECENT_ISSUES_LIMIT = 5;

/** Rolling recent-runs window in milliseconds (7 days from “now”). */
const DASHBOARD_RECENT_RUNS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Cap on recent-runs rows after the window filter. */
export const DASHBOARD_RECENT_RUNS_CAP = 10;

export type DashboardAttentionCounts = {
  unhealthyFeeds: number;
  failedRuns: number;
  failedDelivery: number;
};

export type DashboardAttentionKind = "unhealthy_feeds" | "failed_runs" | "failed_delivery";

export type DashboardAttentionItem = {
  kind: DashboardAttentionKind;
  count: number;
  href: string;
};

function toNowMs(now?: Date | string | number): number {
  if (now === undefined) return Date.now();
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  return new Date(now).getTime();
}

function windowStartMs(now?: Date | string | number): number {
  return toNowMs(now) - DASHBOARD_RECENT_RUNS_WINDOW_MS;
}

/** True when `iso` is within the rolling 7-day window ending at `now`. */
function isWithinRecentWindow(iso: string, now?: Date | string | number): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= windowStartMs(now) && t <= toNowMs(now);
}

/**
 * Keep runs whose `startedAt` falls in the rolling last 7 days, newest first,
 * capped at {@link DASHBOARD_RECENT_RUNS_CAP}.
 */
export function selectRecentRuns(runs: Run[], now?: Date | string | number): Run[] {
  const filtered = runs.filter((run) => isWithinRecentWindow(run.startedAt, now));
  filtered.sort((a, b) => {
    const byStarted = b.startedAt.localeCompare(a.startedAt);
    if (byStarted !== 0) return byStarted;
    return b.$id.localeCompare(a.$id);
  });
  return filtered.slice(0, DASHBOARD_RECENT_RUNS_CAP);
}

/**
 * Take the newest {@link DASHBOARD_RECENT_ISSUES_LIMIT} issues.
 * Re-sorts by `(endedAt ?? startedAt)` desc so callers need not pre-sort.
 */
export function selectRecentIssues(issues: Run[]): Run[] {
  const sorted = [...issues].sort((a, b) => {
    const aKey = a.endedAt ?? a.startedAt;
    const bKey = b.endedAt ?? b.startedAt;
    const byDate = bKey.localeCompare(aKey);
    if (byDate !== 0) return byDate;
    return b.$id.localeCompare(a.$id);
  });
  return sorted.slice(0, DASHBOARD_RECENT_ISSUES_LIMIT);
}

/**
 * Delivery any_failure rows from an already-loaded eligible-issues list
 * (Feature 06 membership + outcome). Prefer this over a second
 * `listDeliveryIssues` → `listIssues` expansion when issues already loaded.
 */
export function selectFailedDeliveryIssues(issues: Run[]): Run[] {
  return issues.filter(
    (run) =>
      hasDeliveryAttempt(run) &&
      (run.emailDeliveryStatus === "failed" || run.rssDeliveryStatus === "failed"),
  );
}

/**
 * Attention counts for the dashboard:
 * - unhealthy feeds: current `operationalHealth === "unhealthy"` (no time window)
 * - failed runs: `status === "failed"` with `startedAt` in the 7-day window
 * - failed delivery: eligible issues with email/rss `"failed"` and
 *   `(endedAt ?? startedAt)` in the 7-day window
 *
 * Pass `runs` from a dedicated status-filtered failed-runs fetch
 * (`listRuns({ status: "failed", limit: 100 })`), not the mixed newest-100
 * Recent-runs pool — otherwise newer non-failed rows can undercount the badge.
 */
export function computeAttentionCounts(input: {
  feeds: Pick<Feed, "operationalHealth">[];
  /** Prefer a dedicated failed-status query result (see C2). */
  runs: Run[];
  issues: Run[];
  now?: Date | string | number;
}): DashboardAttentionCounts {
  const { feeds, runs, issues, now } = input;

  // Same rule as shared `countUnhealthyFeeds` — count current unhealthy only.
  const unhealthyFeeds = feeds.filter((f) => f.operationalHealth === "unhealthy").length;

  const failedRuns = runs.filter(
    (run) => run.status === "failed" && isWithinRecentWindow(run.startedAt, now),
  ).length;

  const failedDelivery = issues.filter((issue) => {
    const deliveryFailed =
      issue.emailDeliveryStatus === "failed" || issue.rssDeliveryStatus === "failed";
    if (!deliveryFailed) return false;
    const dateIso = issue.endedAt ?? issue.startedAt;
    return isWithinRecentWindow(dateIso, now);
  }).length;

  return { unhealthyFeeds, failedRuns, failedDelivery };
}

/**
 * Attention rows for counts > 0 only (no “0 failed” noise), with pinned deep links.
 */
export function buildAttentionItems(counts: DashboardAttentionCounts): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  if (counts.unhealthyFeeds > 0) {
    items.push({
      kind: "unhealthy_feeds",
      count: counts.unhealthyFeeds,
      href: buildFeedsHref({ health: "unhealthy" }),
    });
  }
  if (counts.failedRuns > 0) {
    items.push({
      kind: "failed_runs",
      count: counts.failedRuns,
      href: buildRunsHref({ status: "failed" }),
    });
  }
  if (counts.failedDelivery > 0) {
    items.push({
      kind: "failed_delivery",
      count: counts.failedDelivery,
      href: buildDeliveryHref({ outcome: "any_failure" }),
    });
  }

  return items;
}
