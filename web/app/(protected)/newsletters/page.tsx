import { redirect } from "next/navigation";
import {
  findActiveRunForNewsletter,
  getServerAppwrite,
  listAttachmentsForNewsletter,
  listFeeds,
  listNewsletters,
  NewsletterRepositoryError,
  type AttachmentRecord,
  type Feed,
  type Newsletter,
} from "@newsletter/shared";
import type { NewsletterFeedContext } from "@/components/newsletters/newsletter-feeds-section";
import type { ActiveRunState } from "@/components/newsletters/generate-newsletter-button";
import { NewslettersPagination } from "@/components/newsletters/newsletters-pagination";
import { NewslettersView } from "@/components/newsletters/newsletters-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isSafeNewsletterId } from "@/lib/newsletter-id";

const PAGE_SIZE = 20;

type NewslettersPageProps = {
  searchParams: Promise<{ page?: string; edit?: string }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

async function buildFeedContext(
  newsletters: Newsletter[],
  okFeeds: Feed[],
  libraryFeeds: Feed[],
): Promise<Record<string, NewsletterFeedContext>> {
  const feedsById = new Map<string, Feed>(libraryFeeds.map((feed) => [feed.$id, feed]));
  const entries = await Promise.all(
    newsletters.map(async (newsletter) => {
      let attached: AttachmentRecord[] = [];
      try {
        attached = await listAttachmentsForNewsletter(getServerAppwrite(), newsletter.$id, {
          feedsById,
        });
      } catch (err) {
        console.error(`[newsletters/page] listAttachmentsForNewsletter(${newsletter.$id})`, err);
      }
      const attachedIds = new Set(attached.map((a) => a.feedId));
      const eligible = okFeeds.filter((feed) => !attachedIds.has(feed.$id));
      return [newsletter.$id, { attached, eligible }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export default async function NewslettersPage({ searchParams }: NewslettersPageProps) {
  const { page: pageParam, edit: editParam } = await searchParams;
  const editId = editParam?.trim();
  // Compat: old `/newsletters?edit=<id>` bookmarks → dedicated edit page.
  // Only well-formed document ids — ignore path-escaping / malformed values (S2).
  if (editId && isSafeNewsletterId(editId)) {
    redirect(`/newsletters/${editId}`);
  }

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

  const total = allNewsletters.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total > 0 && requestedPage > totalPages) {
    redirect(totalPages === 1 ? "/newsletters" : `/newsletters?page=${totalPages}`);
  }

  const page = total === 0 ? 1 : requestedPage;
  const start = (page - 1) * PAGE_SIZE;
  const newsletters = allNewsletters.slice(start, start + PAGE_SIZE);

  let libraryFeeds: Feed[] = [];
  try {
    libraryFeeds = await listFeeds(getServerAppwrite());
  } catch (err) {
    console.error("[newsletters/page] listFeeds", err);
  }
  const okFeeds = libraryFeeds.filter((feed) => feed.status === "ok");

  let feedContextByNewsletter: Record<string, NewsletterFeedContext> = {};
  if (newsletters.length > 0) {
    feedContextByNewsletter = await buildFeedContext(newsletters, okFeeds, libraryFeeds);
  }

  let activeRunByNewsletterId: Record<string, ActiveRunState> = {};
  if (newsletters.length > 0) {
    const activeEntries = await Promise.all(
      newsletters.map(async (newsletter) => {
        try {
          const run = await findActiveRunForNewsletter(getServerAppwrite(), newsletter.$id);
          if (!run) return null;
          return [
            newsletter.$id,
            {
              runId: run.$id,
              status: run.status as "pending" | "running",
            },
          ] as const;
        } catch (err) {
          console.error(`[newsletters/page] findActiveRunForNewsletter(${newsletter.$id})`, err);
          return null;
        }
      }),
    );
    activeRunByNewsletterId = Object.fromEntries(
      activeEntries.filter((entry): entry is readonly [string, ActiveRunState] => entry !== null),
    );
  }

  return (
    <main>
      {loadError && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <NewslettersView
        newsletters={newsletters}
        total={total}
        feedContextByNewsletter={feedContextByNewsletter}
        activeRunByNewsletterId={activeRunByNewsletterId}
      />

      <NewslettersPagination page={page} totalPages={totalPages} total={total} />
    </main>
  );
}
