import {
  AppPublicUrlError,
  appPublicUrlFromResolved,
  buildRssXml,
  getNewsletter,
  getServerAppwrite,
  listRssPublications,
  NewsletterRepositoryError,
  resolveOperatorSettings,
} from "@newsletter/shared";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ newsletterId: string }> },
) {
  const { newsletterId } = await params;
  const client = getServerAppwrite();

  let newsletter;
  try {
    newsletter = await getNewsletter(client, newsletterId);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError && err.code === "not_found") {
      return new Response(null, { status: 404 });
    }
    throw err;
  }

  // Stage 12 C3: single cascade read — last-N + public URL from one snapshot.
  const resolved = await resolveOperatorSettings(client);
  const publications = await listRssPublications(client, newsletterId, {
    limit: resolved.rssFeedMaxItems.value,
  });
  if (publications.length === 0) {
    return new Response(null, { status: 404 });
  }

  let baseUrl: string;
  try {
    baseUrl = appPublicUrlFromResolved(resolved.appPublicUrl);
  } catch (err) {
    if (err instanceof AppPublicUrlError) {
      return new Response(err.message, { status: 500 });
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
    },
  });
}
