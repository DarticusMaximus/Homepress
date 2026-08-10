import type { Feed, FeedFailure } from "@newsletter/shared";
import { Badge } from "@/components/ui/badge";

/**
 * Compact URL-keyed feed reference built from `listFeeds` on the server page.
 * Kept serializable (plain object) so it can cross the RSC boundary.
 */
export type FeedLookup = Record<string, { name: string; unhealthy: boolean }>;

/**
 * Build a `url → { name, unhealthy }` lookup from the feeds list. Used by the
 * Runs page to resolve failed-feed URLs to human names and to flag rows where a
 * failed feed is currently unhealthy. Unhealthy here follows the feature spec
 * definition: `operationalHealth === "unhealthy"`.
 */
export function buildFeedLookup(feeds: Feed[]): FeedLookup {
  const lookup: FeedLookup = {};
  for (const feed of feeds) {
    lookup[feed.url] = {
      name: feed.name,
      unhealthy: feed.operationalHealth === "unhealthy",
    };
  }
  return lookup;
}

/**
 * Renders a run's Failed-feeds cell from already-parsed failures (the server
 * page runs `parseRunFailedFeeds` and passes the result down, keeping the
 * runtime shared import off the client bundle). Resolves URLs to feed names
 * when the lookup has them, shows a count summary for multiple failures (with a
 * tooltip listing all), and appends a destructive "Unhealthy" badge when any
 * failed URL is currently an unhealthy feed. Empty failures render an em-dash.
 * Used by both the Runs table and card so the two presentations stay in sync.
 */
export function RunFailedFeedsValue({
  failures,
  feedLookup,
}: {
  failures: FeedFailure[];
  feedLookup: FeedLookup;
}) {
  if (failures.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const resolved = failures.map((failure) => feedLookup[failure.feedUrl]?.name ?? failure.feedUrl);
  const title = resolved.join(", ");
  const hasUnhealthy = failures.some((failure) => feedLookup[failure.feedUrl]?.unhealthy === true);

  const label = failures.length === 1 ? resolved[0] : `${failures.length} feeds failed`;

  return (
    <span className="flex items-center gap-1.5">
      <span className="block max-w-[200px] truncate" title={title}>
        {label}
      </span>
      {hasUnhealthy ? (
        <Badge variant="destructive" data-testid="run-unhealthy-badge">
          Unhealthy
        </Badge>
      ) : null}
    </span>
  );
}
