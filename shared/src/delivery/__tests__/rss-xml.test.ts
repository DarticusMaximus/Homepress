import { describe, it, expect } from "vitest";

// Intentionally imports a module that does not exist yet (Task 3).
// Cases 1–4 fail red for missing module / unimplemented API.
import { buildRssXml } from "../rss-xml";

const FEED_URL = "https://news.example.com/rss/nl-1.xml";
const NEWSLETTER_NAME = "Tech Digest";
const HTML_BODY = "<h1>Hello Digest</h1><p>A paragraph with a <a href=\"https://example.com\">link</a>.</p>";
const ENDED_AT = "2026-07-01T11:00:00.000Z";
const EXPECTED_RFC822 = new Date(ENDED_AT).toUTCString();

function extractCdata(xml: string, tagName: string): string | null {
  // Match both namespaced (content:encoded) and plain tags; CDATA-wrapped body.
  const escaped = tagName.replace(/:/g, "\\:");
  const re = new RegExp(
    `<${escaped}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${escaped}>`,
    "i",
  );
  const match = xml.match(re);
  return match ? match[1]! : null;
}

function countItems(xml: string): number {
  return (xml.match(/<item\b/gi) ?? []).length;
}

describe("buildRssXml — channel", () => {
  it("emits channel title, absolute feed link, and description blurb", () => {
    const xml = buildRssXml({
      newsletterName: NEWSLETTER_NAME,
      feedUrl: FEED_URL,
      items: [
        {
          title: "Issue One",
          runId: "run-1",
          htmlBody: HTML_BODY,
          pubDate: ENDED_AT,
        },
      ],
    });

    expect(xml).toMatch(/<rss\b[^>]*version=["']2\.0["']/i);
    expect(xml).toMatch(
      new RegExp(`<title>\\s*${NEWSLETTER_NAME}\\s*</title>`, "i"),
    );
    expect(xml).toContain(`<link>${FEED_URL}</link>`);
    expect(xml).toContain(`${NEWSLETTER_NAME} — published issues`);
    expect(xml).toContain(`<lastBuildDate>${EXPECTED_RFC822}</lastBuildDate>`);
  });
});

describe("buildRssXml — item fields", () => {
  it("emits title, guid=runId, feed link, matching description/content:encoded HTML, and RFC 822 pubDate", () => {
    const xml = buildRssXml({
      newsletterName: NEWSLETTER_NAME,
      feedUrl: FEED_URL,
      items: [
        {
          title: "Weekly Tech Digest",
          runId: "run-42",
          htmlBody: HTML_BODY,
          pubDate: ENDED_AT,
        },
      ],
    });

    expect(xml).toMatch(/<title>\s*Weekly Tech Digest\s*<\/title>/i);
    expect(xml).toMatch(
      /<guid\b[^>]*isPermaLink=["']false["'][^>]*>\s*run-42\s*<\/guid>/i,
    );
    expect(xml).toContain(`<link>${FEED_URL}</link>`);
    expect(xml).toContain(`<pubDate>${EXPECTED_RFC822}</pubDate>`);

    const encoded = extractCdata(xml, "content:encoded");
    const description = extractCdata(xml, "description");
    expect(encoded).not.toBeNull();
    expect(description).not.toBeNull();
    expect(encoded).toContain(HTML_BODY);
    expect(description).toBe(encoded);
  });
});

describe("buildRssXml — order / max", () => {
  it("emits at most 10 items when the caller passes a pre-trimmed list of ≤10", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Issue ${i + 1}`,
      runId: `run-${i + 1}`,
      htmlBody: `<p>Body ${i + 1}</p>`,
      pubDate: new Date(Date.UTC(2026, 6, 17 - i)).toISOString(),
    }));

    // Caller may have trimmed from >10; builder receives the trimmed list.
    const xml = buildRssXml({
      newsletterName: NEWSLETTER_NAME,
      feedUrl: FEED_URL,
      items,
    });

    expect(countItems(xml)).toBeLessThanOrEqual(10);
    expect(countItems(xml)).toBe(10);
  });
});

describe("buildRssXml — escape", () => {
  it("escapes titles containing < and & so the XML remains well-formed", () => {
    const xml = buildRssXml({
      newsletterName: "A & B <Digest>",
      feedUrl: FEED_URL,
      items: [
        {
          title: "Foo <Bar> & Baz",
          runId: "run-escape",
          htmlBody: "<p>ok</p>",
          pubDate: ENDED_AT,
        },
      ],
    });

    // Raw angle brackets / ampersands must not appear unescaped in text titles.
    expect(xml).not.toMatch(/<title>\s*Foo <Bar>/);
    expect(xml).not.toMatch(/<title>\s*A & B </);
    expect(xml).toMatch(/Foo &lt;Bar&gt; &amp; Baz/);
    expect(xml).toMatch(/A &amp; B &lt;Digest&gt;/);

    // Document must still parse as XML (basic well-formedness).
    expect(() => {
      // DOMParser is unavailable in Node; a minimal check is balanced rss root.
      expect(xml).toMatch(/<rss[\s\S]*<\/rss>\s*$/);
    }).not.toThrow();
  });
});

describe("buildRssXml — CDATA safety", () => {
  it("neutralizes ]]> in htmlBody so CDATA cannot break out of description/content:encoded", () => {
    // Classic CDATA terminator breakout: early ]]> would leave the rest as raw XML.
    const poisonBody =
      '<p>before ]]> <script>alert(1)</script> after</p>';

    const xml = buildRssXml({
      newsletterName: NEWSLETTER_NAME,
      feedUrl: FEED_URL,
      items: [
        {
          title: "Poison Issue",
          runId: "run-cdata",
          htmlBody: poisonBody,
          pubDate: ENDED_AT,
        },
      ],
    });

    // Split strategy: ]]> becomes ]]]]><![CDATA[> so no single section terminates early.
    expect(xml).toContain("]]]]><![CDATA[>");

    // Outside CDATA sections, a breakout would surface the script as a real element.
    const outsideCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    expect(outsideCdata).not.toMatch(/<script\b/i);
    expect(outsideCdata).not.toContain("]]>");

    const itemBlock = xml.match(/<item>[\s\S]*?<\/item>/)?.[0];
    expect(itemBlock).toBeDefined();

    const descriptionInner = itemBlock!.match(
      /<description>([\s\S]*?)<\/description>/,
    )?.[1];
    const encodedInner = itemBlock!.match(
      /<content:encoded>([\s\S]*?)<\/content:encoded>/,
    )?.[1];
    expect(descriptionInner).toBeDefined();
    expect(encodedInner).toBeDefined();
    // description and content:encoded stay equal after the CDATA fix.
    expect(descriptionInner).toBe(encodedInner);

    // Concatenated CDATA sections reconstruct the original htmlBody (including ]]>).
    const cdataParts = [
      ...descriptionInner!.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g),
    ].map((m) => m[1]!);
    expect(cdataParts.join("")).toBe(poisonBody);

    expect(xml).toMatch(/<rss[\s\S]*<\/rss>\s*$/);
  });
});
