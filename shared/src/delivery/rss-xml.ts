export type RssFeedItem = {
  title: string;
  runId: string;
  htmlBody: string;
  pubDate: string;
};

export type BuildRssXmlInput = {
  newsletterName: string;
  feedUrl: string;
  items: RssFeedItem[];
};

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

function cdata(html: string): string {
  // Caller HTML is treated as opaque; wrap in CDATA for description / content:encoded.
  // Neutralize ]]> so a terminator in htmlBody cannot close the section early
  // (split into adjacent CDATA sections that concatenate to the original).
  const safe = html.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

/**
 * Build an RSS 2.0 XML document from publication snapshots.
 * Caller is expected to pass a pre-trimmed list (≤10); the builder emits
 * exactly the items it receives.
 */
export function buildRssXml(input: BuildRssXmlInput): string {
  const { newsletterName, feedUrl, items } = input;
  const escapedName = escapeXmlText(newsletterName);
  const escapedFeedUrl = escapeXmlText(feedUrl);
  const description = escapeXmlText(`${newsletterName} — published issues`);

  const lastBuildDate =
    items.length > 0 ? toRfc822(items[0]!.pubDate) : undefined;

  const itemXml = items
    .map((item) => {
      const title = escapeXmlText(item.title);
      const guid = escapeXmlText(item.runId);
      const pubDate = toRfc822(item.pubDate);
      const body = cdata(item.htmlBody);
      return [
        "    <item>",
        `      <title>${title}</title>`,
        `      <link>${escapedFeedUrl}</link>`,
        `      <guid isPermaLink="false">${guid}</guid>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <description>${body}</description>`,
        `      <content:encoded>${body}</content:encoded>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const channelParts = [
    `    <title>${escapedName}</title>`,
    `    <link>${escapedFeedUrl}</link>`,
    `    <description>${description}</description>`,
  ];
  if (lastBuildDate !== undefined) {
    channelParts.push(`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`);
  }
  if (itemXml.length > 0) {
    channelParts.push(itemXml);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "  <channel>",
    ...channelParts,
    "  </channel>",
    "</rss>",
  ].join("\n");
}
