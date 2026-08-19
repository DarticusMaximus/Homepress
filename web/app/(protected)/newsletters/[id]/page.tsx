import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getNewsletter,
  getServerAppwrite,
  listIssues,
  NewsletterRepositoryError,
  resolveIssueCardMetaForRuns,
  RunRepositoryError,
  type IssueCardMeta,
  type Newsletter,
  type Run,
} from "@newsletter/shared";
import { DomainListPagination } from "@/components/domain-list";
import { HomeInbox } from "@/components/home/home-inbox";
import { buildChannelHref } from "@/lib/channel-url";
import { isSafeNewsletterId } from "@/lib/newsletter-id";

const PAGE_SIZE = 20;

type ChannelPageProps = {
  params: Promise<{ id: string }>;
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

export default async function ChannelPage({ params, searchParams }: ChannelPageProps) {
  const { id } = await params;
  if (!isSafeNewsletterId(id)) {
    notFound();
  }

  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  const client = getServerAppwrite();

  let newsletter: Newsletter;
  try {
    newsletter = await getNewsletter(client, id);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError && err.code === "not_found") {
      notFound();
    }
    throw err;
  }

  let allIssues: Run[] = [];
  let loadError: string | null = null;

  try {
    allIssues = await listIssues(client, { newsletterId: id });
  } catch (err) {
    loadError =
      err instanceof RunRepositoryError
        ? err.message
        : "Something went wrong while loading issues. Please try again.";
    console.error(`[newsletters/${id}]`, err);
  }

  const total = allIssues.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(buildChannelHref(id, { page: totalPages === 1 ? undefined : totalPages }));
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const issues = allIssues.slice(start, start + PAGE_SIZE);

  const metaByRunId =
    issues.length > 0
      ? await resolveIssueCardMetaForRuns(client, issues)
      : new Map<string, IssueCardMeta>();

  return (
    <main>
      <Link
        href="/newsletters"
        className="text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        Back to Newsletters
      </Link>
      <HomeInbox
        heading={newsletter.name}
        issues={issues}
        metaByRunId={metaByRunId}
        loadError={loadError}
      />
      <DomainListPagination
        ariaLabel="Issues pagination"
        page={page}
        totalPages={totalPages}
        total={total}
        noun="issues"
        buildPageHref={(p) => buildChannelHref(id, { page: p })}
      />
    </main>
  );
}
