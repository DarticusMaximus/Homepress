import { redirect } from "next/navigation";
import {
  getServerAppwrite,
  listNewsletters,
  NewsletterRepositoryError,
  type Newsletter,
} from "@newsletter/shared";
import { DomainListPagination } from "@/components/domain-list";
import { ChannelList } from "@/components/newsletters/channel-list";
import { buildReaderNewslettersHref } from "@/lib/channel-url";

const PAGE_SIZE = 20;

type NewslettersPageProps = {
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

function sortNewslettersByName(newsletters: Newsletter[]): Newsletter[] {
  return [...newsletters].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }
    return a.$id.localeCompare(b.$id);
  });
}

export default async function NewslettersPage({ searchParams }: NewslettersPageProps) {
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  let allNewsletters: Newsletter[] = [];
  let loadError: string | null = null;

  try {
    allNewsletters = await listNewsletters(getServerAppwrite());
  } catch (err) {
    loadError =
      err instanceof NewsletterRepositoryError
        ? err.message
        : "Something went wrong while loading newsletters. Please try again.";
    console.error("[newsletters/page]", err);
  }

  const sorted = sortNewslettersByName(allNewsletters);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(buildReaderNewslettersHref({ page: totalPages === 1 ? undefined : totalPages }));
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const newsletters = sorted.slice(start, start + PAGE_SIZE);

  return (
    <main>
      <ChannelList newsletters={newsletters} loadError={loadError} />
      <DomainListPagination
        ariaLabel="Newsletters pagination"
        page={page}
        totalPages={totalPages}
        total={total}
        noun="newsletters"
        buildPageHref={(p) => buildReaderNewslettersHref({ page: p })}
      />
    </main>
  );
}
