import { redirect } from "next/navigation";
import {
  getServerAppwrite,
  listIssues,
  resolveIssueCardMetaForRuns,
  RunRepositoryError,
  type IssueCardMeta,
  type Run,
} from "@newsletter/shared";
import { DomainListPagination } from "@/components/domain-list";
import { HomeInbox } from "@/components/home/home-inbox";
import { buildHomeHref } from "@/lib/home-url";

const PAGE_SIZE = 20;

type HomePageProps = {
  searchParams: Promise<{
    page?: string;
  }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

export default async function Home({ searchParams }: HomePageProps) {
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  let allIssues: Run[] = [];
  let loadError: string | null = null;

  try {
    allIssues = await listIssues(getServerAppwrite());
  } catch (err) {
    loadError =
      err instanceof RunRepositoryError
        ? err.message
        : "Something went wrong while loading issues. Please try again.";
    console.error("[home/page]", err);
  }

  const total = allIssues.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(buildHomeHref({ page: totalPages === 1 ? undefined : totalPages }));
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const issues = allIssues.slice(start, start + PAGE_SIZE);

  const metaByRunId =
    issues.length > 0
      ? await resolveIssueCardMetaForRuns(getServerAppwrite(), issues)
      : new Map<string, IssueCardMeta>();

  return (
    <main>
      <HomeInbox issues={issues} metaByRunId={metaByRunId} loadError={loadError} />
      <DomainListPagination
        ariaLabel="Issues pagination"
        page={page}
        totalPages={totalPages}
        total={total}
        noun="issues"
        buildPageHref={(p) => buildHomeHref({ page: p })}
      />
    </main>
  );
}
