import {
  AppPublicUrlError,
  appPublicUrlFromResolved,
  buildRssXml,
  getNewsletter,
  getServerAppwrite,
  listRssPublications,
  NewsletterRepositoryError,
  resolveOperatorSettings,
  sanitizeAppwriteMessageForLog,
} from "@newsletter/shared";
import { isSafeNewsletterId } from "@/lib/newsletter-id";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ newsletterId: string }> },
) {
  const { newsletterId } = await params;
  if (!isSafeNewsletterId(newsletterId) || newsletterId.length > 36) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS });
  }
  const client = getServerAppwrite();

  let newsletter;
  try {
    newsletter = await getNewsletter(client, newsletterId);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError && err.code === "not_found") {
      return new Response(null, { status: 404, headers: NO_STORE_HEADERS });
    }
    throw err;
  }

  // Stage 12 C3: single cascade read — last-N + public URL from one snapshot.
  const resolved = await resolveOperatorSettings(client);
  const publications = await listRssPublications(client, newsletterId, {
    limit: resolved.rssFeedMaxItems.value,
  });
  if (publications.length === 0) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS });
  }

  let baseUrl: string;
  try {
    baseUrl = appPublicUrlFromResolved(resolved.appPublicUrl);
  } catch (err) {
    if (err instanceof AppPublicUrlError) {
      console.error({
        phase: "rss-route-public-url",
        message: sanitizeAppwriteMessageForLog(err.message),
      });
      return new Response("RSS feed is temporarily unavailable.", {
        status: 500,
        headers: NO_STORE_HEADERS,
      });
    }
    throw err;
  }

  const feedUrl = `${baseUrl}/rss/${newsletterId}.xml`;
  const xml = buildRssXml({
    newsletterName: newsletter.name,
    feedUrl,
    items: publications.map((pub) => ({
      title: pub.title,
      runId: pub.runId,
      htmlBody: pub.htmlBody,
      pubDate: pub.pubDate,
    })),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
