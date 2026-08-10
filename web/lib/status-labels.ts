import type { FeedOperationalHealth, FeedStatus, RunStatus } from "@newsletter/shared";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const FEED_STATUS_LABELS: Record<FeedStatus, string> = {
  untested: "Untested",
  ok: "Ok",
  failed: "Failed",
};

const FEED_HEALTH_LABELS: Record<FeedOperationalHealth, string> = {
  healthy: "Healthy",
  unhealthy: "Unhealthy",
};

/** Title-case label for a run status. Stored/query values stay lowercase. */
export function formatRunStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status];
}

/** Title-case label for a feed qualification status. */
export function formatFeedStatusLabel(status: FeedStatus): string {
  return FEED_STATUS_LABELS[status];
}

/** Title-case label for feed operational health. */
export function formatFeedHealthLabel(health: FeedOperationalHealth): string {
  return FEED_HEALTH_LABELS[health];
}
