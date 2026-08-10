import { redirect } from "next/navigation";
import { FeedRepositoryError, getServerAppwrite, listFeeds, type Feed } from "@newsletter/shared";
import { FeedsPagination } from "@/components/feeds/feeds-pagination";
import { FeedsView } from "@/components/feeds/feeds-view";
import { buildFeedsHref, isHealthFilter } from "@/components/feeds/feeds-url";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 20;

type FeedsPageProps = {
  searchParams: Promise<{ page?: string; health?: string }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

export default async function FeedsPage({ searchParams }: FeedsPageProps) {
  const { page: pageParam, health: healthParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  const health = isHealthFilter(healthParam) ? healthParam : undefined;

  let allFeeds: Feed[] = [];
  let loadError: string | null = null;

  try {
    allFeeds = await listFeeds(getServerAppwrite());
  } catch (err) {
    loadError =
      err instanceof FeedRepositoryError
        ? err.message
        : "Something went wrong while loading feeds. Please try again.";
    console.error("[feeds/page]", err);
  }

  // Apply the optional health filter BEFORE pagination so the dashboard
  // `/feeds?health=unhealthy` deep-link shows only unhealthy feeds and the
  // page clamp is computed against the filtered set.
  const filteredFeeds = health
    ? allFeeds.filter((feed) => feed.operationalHealth === "unhealthy")
    : allFeeds;

  const total = filteredFeeds.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(
      buildFeedsHref({
        health,
        page: totalPages === 1 ? undefined : totalPages,
      }),
    );
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const feeds = filteredFeeds.slice(start, start + PAGE_SIZE);

  return (
    <main>
      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <FeedsView feeds={feeds} total={total} health={health} />

      <FeedsPagination page={page} totalPages={totalPages} total={total} health={health} />
    </main>
  );
}
