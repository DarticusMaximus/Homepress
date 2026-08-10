import { redirect } from "next/navigation";
import {
  getServerAppwrite,
  listDeliveryIssues,
  listNewsletters,
  resolveIssueDisplayTitlesForRuns,
  RunRepositoryError,
  type DeliveryOutcomeFilter,
  type Newsletter,
  type Run,
} from "@newsletter/shared";
import { DeliveryView } from "@/components/delivery/delivery-view";
import { DeliveryTable } from "@/components/delivery/delivery-table";
import { DeliveryPagination } from "@/components/delivery/delivery-pagination";
import { buildDeliveryHref } from "@/components/delivery/delivery-url";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 20;

const VALID_OUTCOMES: ReadonlySet<string> = new Set([
  "all",
  "any_failure",
  "email_failed",
  "rss_failed",
]);

type DeliveryPageProps = {
  searchParams: Promise<{
    page?: string;
    newsletterId?: string;
    outcome?: string;
  }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function parseOutcomeParam(raw: string | undefined): DeliveryOutcomeFilter {
  if (raw && VALID_OUTCOMES.has(raw)) {
    return raw as DeliveryOutcomeFilter;
  }
  return "all";
}

export default async function DeliveryPage({ searchParams }: DeliveryPageProps) {
  const {
    page: pageParam,
    newsletterId: newsletterIdParam,
    outcome: outcomeParam,
  } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  const newsletterId = newsletterIdParam || undefined;
  const outcome = parseOutcomeParam(outcomeParam);

  let allIssues: Run[] = [];
  let loadError: string | null = null;

  try {
    allIssues = await listDeliveryIssues(getServerAppwrite(), { newsletterId, outcome });
  } catch (err) {
    loadError =
      err instanceof RunRepositoryError
        ? err.message
        : "Something went wrong while loading delivery issues. Please try again.";
    console.error("[delivery/page]", err);
  }

  let newsletters: Newsletter[] = [];
  let newsletterFilterFailed = false;
  try {
    newsletters = await listNewsletters(getServerAppwrite());
  } catch (err) {
    console.error("[delivery/page] listNewsletters", err);
    newsletterFilterFailed = true;
  }

  const total = allIssues.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(
      buildDeliveryHref({
        newsletterId,
        outcome,
        page: totalPages === 1 ? undefined : totalPages,
      }),
    );
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  // Paginate first — draft title enrichment runs only on this page slice (≤ 20).
  const issues = allIssues.slice(start, start + PAGE_SIZE);

  const titleByRunId =
    issues.length > 0
      ? await resolveIssueDisplayTitlesForRuns(getServerAppwrite(), issues)
      : new Map<string, string>();

  return (
    <main>
      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {newsletterFilterFailed && (
        <Alert className="mb-6" role="status">
          <AlertDescription>
            Some data could not be loaded (newsletter filter). Parts of this page may be incomplete.
          </AlertDescription>
        </Alert>
      )}

      <DeliveryView
        issues={issues}
        newsletters={newsletters}
        currentNewsletterId={newsletterId ?? ""}
        currentOutcome={outcome}
        total={total}
        page={page}
        totalPages={totalPages}
        loadError={loadError}
        list={<DeliveryTable issues={issues} titleByRunId={titleByRunId} />}
      />

      <DeliveryPagination
        page={page}
        totalPages={totalPages}
        total={total}
        newsletterId={newsletterId}
        outcome={outcome}
      />
    </main>
  );
}
