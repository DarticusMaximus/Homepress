import { redirect } from "next/navigation";
import {
  DEFAULT_RUN_RETENTION_DAYS,
  getOrCreateAppSettings,
  getServerAppwrite,
  listFeeds,
  listNewsletters,
  listRuns,
  parseRunFailedFeeds,
  parseSuppressSummary,
  RunRepositoryError,
  RUN_STATUSES,
  type Feed,
  type FeedFailure,
  type Newsletter,
  type Run,
  type RunStatus,
  type SuppressSummary,
} from "@newsletter/shared";
import { RunsView } from "@/components/runs/runs-view";
import { RunsPagination } from "@/components/runs/runs-pagination";
import { buildFeedLookup } from "@/components/runs/run-failed-feeds";
import type { RunLookup } from "@/components/runs/run-suppress-summary";
import { RunsAdvancedRetention } from "@/components/runs/runs-advanced-retention";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 20;
const VALID_STATUSES: ReadonlySet<string> = new Set(RUN_STATUSES);

type RunsPageProps = {
  searchParams: Promise<{
    page?: string;
    newsletterId?: string;
    status?: string;
  }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const {
    page: pageParam,
    newsletterId: newsletterIdParam,
    status: statusParam,
  } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  const newsletterId = newsletterIdParam || undefined;
  const status: RunStatus | undefined =
    statusParam && VALID_STATUSES.has(statusParam) ? (statusParam as RunStatus) : undefined;

  let allRuns: Run[] = [];
  let loadError: string | null = null;

  try {
    allRuns = await listRuns(getServerAppwrite(), { newsletterId, status });
  } catch (err) {
    loadError =
      err instanceof RunRepositoryError
        ? err.message
        : "Something went wrong while loading runs. Please try again.";
    console.error("[runs/page]", err);
  }

  const secondaryFailures: string[] = [];

  let newsletters: Newsletter[] = [];
  try {
    newsletters = await listNewsletters(getServerAppwrite());
  } catch (err) {
    console.error("[runs/page] listNewsletters", err);
    secondaryFailures.push("newsletter filter");
  }

  // Load feeds to resolve failed-feed URLs to names and to flag rows where a
  // failed feed is currently unhealthy. `listFeeds` caps at the V1 limit
  // (≤100); on failure we degrade gracefully to an empty lookup (URLs shown).
  let feeds: Feed[] = [];
  try {
    feeds = await listFeeds(getServerAppwrite());
  } catch (err) {
    console.error("[runs/page] listFeeds", err);
    secondaryFailures.push("feed names");
  }
  const feedLookup = buildFeedLookup(feeds);

  // Load retention window for the Advanced pocket below the list. Default to
  // 30 days if settings can't be read (defensive — page still renders).
  let retentionDays: number = DEFAULT_RUN_RETENTION_DAYS;
  try {
    const settings = await getOrCreateAppSettings(getServerAppwrite());
    retentionDays = settings.runRetentionDays;
  } catch (err) {
    console.error("[runs/page] getOrCreateAppSettings", err);
    secondaryFailures.push("retention window");
  }

  const secondaryDegraded = secondaryFailures.length > 0;

  const total = allRuns.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    const params = new URLSearchParams();
    if (totalPages > 1) params.set("page", String(totalPages));
    if (newsletterId) params.set("newsletterId", newsletterId);
    if (status) params.set("status", status);
    const qs = params.toString();
    redirect(qs ? `/admin/runs?${qs}` : "/admin/runs");
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const runs = allRuns.slice(start, start + PAGE_SIZE);

  // Parse each run's failedFeeds JSON on the server so the runtime shared
  // import stays off the client bundle; the typed FeedFailure[] is threaded to
  // the list components for display.
  const failedFeedsByRun: Record<string, FeedFailure[]> = {};
  for (const run of runs) {
    failedFeedsByRun[run.$id] = parseRunFailedFeeds(run.failedFeeds);
  }

  // Parse each page row's suppressSummary JSON on the server (same rationale:
  // keep the runtime shared import off the client bundle).
  const suppressSummaryByRun: Record<string, SuppressSummary> = {};
  for (const run of runs) {
    suppressSummaryByRun[run.$id] = parseSuppressSummary(run.suppressSummary);
  }

  // Build a run lookup from the full (pre-paginated) run list so suppressed
  // items can resolve their matched prior run to a human date. Keyed by `$id`
  // with the fields the display helper needs (`endedAt ?? startedAt`).
  const runLookup: RunLookup = {};
  for (const run of allRuns) {
    runLookup[run.$id] = { endedAt: run.endedAt, startedAt: run.startedAt };
  }

  return (
    <main>
      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {secondaryDegraded && (
        <Alert className="mb-6" role="status">
          <AlertDescription>
            Some data could not be loaded ({secondaryFailures.join(", ")}). Parts of this page may
            be incomplete or use default values.
          </AlertDescription>
        </Alert>
      )}

      <RunsView
        runs={runs}
        newsletters={newsletters}
        currentNewsletterId={newsletterId ?? ""}
        currentStatus={status ?? ""}
        total={total}
        page={page}
        totalPages={totalPages}
        loadError={loadError}
        feedLookup={feedLookup}
        failedFeedsByRun={failedFeedsByRun}
        suppressSummaryByRun={suppressSummaryByRun}
        runLookup={runLookup}
      />

      <RunsPagination
        page={page}
        totalPages={totalPages}
        total={total}
        newsletterId={newsletterId}
        status={status}
      />

      <RunsAdvancedRetention retentionDays={retentionDays} />
    </main>
  );
}
