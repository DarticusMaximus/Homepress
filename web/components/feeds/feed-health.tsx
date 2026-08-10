import type { Feed } from "@newsletter/shared";
import { Badge } from "@/components/ui/badge";
import { formatFeedHealthLabel } from "@/lib/status-labels";

const HEALTH_BADGE_VARIANT = {
  healthy: "default",
  unhealthy: "destructive",
} as const;

export function FeedHealthBadge({ feed }: { feed: Pick<Feed, "operationalHealth"> }) {
  const health = feed.operationalHealth;
  const variant = HEALTH_BADGE_VARIANT[health] ?? "default";
  return (
    <Badge variant={variant} data-testid="feed-health-badge">
      {formatFeedHealthLabel(health)}
    </Badge>
  );
}

export function FeedFetchFailuresValue({
  feed,
}: {
  feed: Pick<Feed, "consecutiveFetchFailures" | "lastFetchError" | "operationalHealth">;
}) {
  const { consecutiveFetchFailures, lastFetchError, operationalHealth } = feed;
  const showFailures = consecutiveFetchFailures > 0 || operationalHealth === "unhealthy";

  if (!showFailures) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="flex flex-col gap-0.5">
      <span>{consecutiveFetchFailures}</span>
      {lastFetchError ? (
        <span
          className="block max-w-[220px] truncate text-xs text-muted-foreground"
          title={lastFetchError}
        >
          {lastFetchError}
        </span>
      ) : null}
    </span>
  );
}
