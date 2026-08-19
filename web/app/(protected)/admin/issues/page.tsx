import { redirect } from "next/navigation";
import {
  getServerAppwrite,
  listIssues,
  listNewsletters,
  resolveIssueDisplayTitlesForRuns,
  RunRepositoryError,
  type Newsletter,
  type Run,
} from "@newsletter/shared";
import { IssuesView } from "@/components/issues/issues-view";
import { IssuesTable } from "@/components/issues/issues-table";
import { IssuesPagination } from "@/components/issues/issues-pagination";
import { buildIssuesHref } from "@/components/issues/issues-url";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 20;

type IssuesPageProps = {
  searchParams: Promise<{
    page?: string;
    newsletterId?: string;
  }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const { page: pageParam, newsletterId: newsletterIdParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  const newsletterId = newsletterIdParam || undefined;

  let allIssues: Run[] = [];
  let loadError: string | null = null;

  try {
    allIssues = await listIssues(getServerAppwrite(), { newsletterId });
  } catch (err) {
    loadError =
      err instanceof RunRepositoryError
        ? err.message
        : "Something went wrong while loading issues. Please try again.";
    console.error("[issues/page]", err);
  }

  let newsletters: Newsletter[] = [];
  let newsletterFilterFailed = false;
  try {
    newsletters = await listNewsletters(getServerAppwrite());
  } catch (err) {
    console.error("[issues/page] listNewsletters", err);
    newsletterFilterFailed = true;
  }

  const total = allIssues.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(
      buildIssuesHref({
        newsletterId,
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

      <IssuesView
        issues={issues}
        newsletters={newsletters}
        currentNewsletterId={newsletterId ?? ""}
        total={total}
        page={page}
        totalPages={totalPages}
        loadError={loadError}
        list={<IssuesTable issues={issues} titleByRunId={titleByRunId} />}
      />

      <IssuesPagination
        page={page}
        totalPages={totalPages}
        total={total}
        newsletterId={newsletterId}
      />
    </main>
  );
}
