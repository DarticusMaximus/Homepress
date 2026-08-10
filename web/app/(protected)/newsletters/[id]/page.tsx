import { notFound } from "next/navigation";
import {
  AppPublicUrlError,
  getNewsletter,
  getServerAppwrite,
  listAttachmentsForNewsletter,
  listFeeds,
  NewsletterRepositoryError,
  resolveAppPublicUrl,
  type AttachmentRecord,
  type Feed,
  type Newsletter,
} from "@newsletter/shared";
import { NewsletterEditForm } from "@/components/newsletters/newsletter-edit-form";
import type { NewsletterFeedContext } from "@/components/newsletters/newsletter-feeds-section";

type NewsletterEditPageProps = {
  params: Promise<{ id: string }>;
};

function tryResolveAppPublicUrl(): string | null {
  try {
    return resolveAppPublicUrl();
  } catch (err) {
    if (err instanceof AppPublicUrlError) return null;
    throw err;
  }
}

async function loadFeedContext(newsletterId: string): Promise<NewsletterFeedContext> {
  let libraryFeeds: Feed[] = [];
  try {
    libraryFeeds = await listFeeds(getServerAppwrite());
  } catch (err) {
    console.error(`[newsletters/${newsletterId}] listFeeds`, err);
  }

  const feedsById = new Map<string, Feed>(libraryFeeds.map((feed) => [feed.$id, feed]));
  let attached: AttachmentRecord[] = [];
  try {
    attached = await listAttachmentsForNewsletter(getServerAppwrite(), newsletterId, {
      feedsById,
    });
  } catch (err) {
    console.error(`[newsletters/${newsletterId}] listAttachmentsForNewsletter`, err);
  }

  const attachedIds = new Set(attached.map((a) => a.feedId));
  const eligible = libraryFeeds.filter(
    (feed) => feed.status === "ok" && !attachedIds.has(feed.$id),
  );

  return { attached, eligible };
}

export default async function NewsletterEditPage({ params }: NewsletterEditPageProps) {
  const { id } = await params;

  let newsletter: Newsletter;
  try {
    newsletter = await getNewsletter(getServerAppwrite(), id);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError && err.code === "not_found") {
      notFound();
    }
    throw err;
  }

  const feeds = await loadFeedContext(newsletter.$id);

  return (
    <main>
      <NewsletterEditForm
        newsletter={newsletter}
        feeds={feeds}
        appPublicUrl={tryResolveAppPublicUrl()}
      />
    </main>
  );
}
