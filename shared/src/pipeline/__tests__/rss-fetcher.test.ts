import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { RSSFetcher, fetchFeeds, sanitizeUrlForLog } from "../rss-fetcher";
import { DEFAULT_MAX_FETCH_BYTES } from "../config";
import type { Article, FetchResult, FeedFailure } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

const RSS_XML = readFileSync(join(FIXTURES, "rss-sample.xml"), "utf8");
const ATOM_XML = readFileSync(join(FIXTURES, "atom-sample.xml"), "utf8");

// A pinned "now" for deterministic date filtering. 2026-06-30T12:00:00Z means:
//   - today     = 2026-06-30
//   - yesterday = 2026-06-29 (00:00:00 UTC .. 23:59:59.999 UTC under TZ=UTC)
//   - 3 days ago = 2026-06-27
const PINNED_NOW = new Date("2026-06-30T12:00:00Z");

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type MockResponse = {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  text: () => Promise<string>;
};

function okResponse(xml: string): MockResponse {
  return { ok: true, status: 200, text: async () => xml };
}

function notOkResponse(status: number): MockResponse {
  return { ok: false, status, text: async () => "" };
}

/** Build a `Response`-shaped mock the fetcher can `.text()`. */
function asResponse(mock: MockResponse): Response {
  const headers: Headers = {
    get(name: string): string | null {
      if (!mock.headers) return null;
      const found = Object.keys(mock.headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return found ? (mock.headers as Record<string, string>)[found] : null;
    },
  } as unknown as Headers;
  return { ...mock, headers } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test lifecycle: pin timezone + clock around every test, restore after.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ===========================================================================
// RSS 2.0 parsing
// ===========================================================================

describe("RSS parse", () => {
  it("maps items to Article with correct title/link/published/content/source", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "all",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const today = result.articles.find((a) => a.link === "https://example.com/today");
    expect(today).toBeDefined();
    expect(today as Article).toEqual({
      title: "Today Article",
      link: "https://example.com/today",
      published: new Date("Tue, 30 Jun 2026 09:00:00 GMT"),
      content: "<p>Full content for today article.</p>",
      source: "Sample RSS Feed",
    });
    expect(today?.published).toBeInstanceOf(Date);
  });

  it("prefers content:encoded over description when both present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "all",
    });

    const today = result.articles.find((a) => a.link === "https://example.com/today");
    // Today item has BOTH content:encoded and description — encoded wins.
    expect(today?.content).toBe("<p>Full content for today article.</p>");
  });

  it("falls back to description when content:encoded is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "all",
    });

    const yesterday = result.articles.find((a) => a.link === "https://example.com/yesterday");
    // Yesterday item has ONLY description (no content:encoded).
    expect(yesterday?.content).toBe("Description-only body for yesterday article.");
  });
});

// ===========================================================================
// Atom 1.0 parsing
// ===========================================================================

describe("Atom parse", () => {
  it("maps entries to Article with content from entry.content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(ATOM_XML)));

    const result = await fetchFeeds(["https://feed.example/atom"], {
      dateRange: "all",
    });

    const today = result.articles.find((a) => a.link === "https://example.com/atom-today");
    expect(today).toBeDefined();
    expect(today as Article).toEqual({
      title: "Atom Today Entry",
      link: "https://example.com/atom-today",
      published: new Date("2026-06-30T09:00:00Z"),
      content: "<p>Full atom content for today.</p>",
      source: "Sample Atom Feed",
    });
  });

  it("falls back to entry.summary when entry.content is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(ATOM_XML)));

    const result = await fetchFeeds(["https://feed.example/atom"], {
      dateRange: "all",
    });

    const yesterday = result.articles.find((a) => a.link === "https://example.com/atom-yesterday");
    expect(yesterday?.content).toBe("Summary-only atom entry for yesterday.");
  });

  it("uses feed title as source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(ATOM_XML)));

    const result = await fetchFeeds(["https://feed.example/atom"], {
      dateRange: "all",
    });

    for (const article of result.articles) {
      expect(article.source).toBe("Sample Atom Feed");
    }
  });
});

// ===========================================================================
// Date filtering
// ===========================================================================

describe("date filtering: yesterday", () => {
  it("returns only the item dated yesterday", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "yesterday",
    });

    const links = result.articles.map((a) => a.link).sort();
    // Yesterday = 2026-06-29. Both "Yesterday Article" (29 Jun 10:30) and
    // "Fifth Article" (29 Jun 16:00) fall within the window. Items dated today
    // (30 Jun), 3 days ago (27 Jun), and the no-date item are excluded.
    expect(links).toEqual(["https://example.com/fifth", "https://example.com/yesterday"]);
  });
});

describe("date filtering: all", () => {
  it("returns all items regardless of date", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "all",
    });

    // All 5 items present (including the no-date one, which becomes epoch and
    // is included under 'all').
    expect(result.articles).toHaveLength(5);
  });
});

describe("null published -> epoch", () => {
  it("is excluded under yesterday", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "yesterday",
    });

    const noDate = result.articles.find((a) => a.link === "https://example.com/no-date");
    expect(noDate).toBeUndefined();
  });

  it("is included under all (epoch 0)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "all",
    });

    const noDate = result.articles.find((a) => a.link === "https://example.com/no-date");
    expect(noDate).toBeDefined();
    expect(noDate?.published).toEqual(new Date(0));
  });
});

// ===========================================================================
// Error isolation
// ===========================================================================

describe("HTTP 404 isolation", () => {
  it("records a HttpError failure with statusCode, does not abort sibling feeds", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(notOkResponse(404)))
      .mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/dead", "https://feed.example/live"], {
      dateRange: "all",
    });

    expect(result.totalFeeds).toBe(2);
    expect(result.failedFeeds).toHaveLength(1);
    const failure = result.failedFeeds[0] as FeedFailure;
    expect(failure).toEqual({
      feedUrl: "https://feed.example/dead",
      errorType: "HttpError",
      errorMessage: expect.any(String),
      statusCode: 404,
    });
    // Sibling feed still contributed articles.
    expect(result.articles.length).toBeGreaterThan(0);
    expect(result.articles.every((a) => a.source === "Sample RSS Feed")).toBe(true);
  });
});

describe("network error isolation", () => {
  it("records a NetworkError with no statusCode, sibling unaffected", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/down", "https://feed.example/live"], {
      dateRange: "all",
    });

    expect(result.totalFeeds).toBe(2);
    expect(result.failedFeeds).toHaveLength(1);
    const failure = result.failedFeeds[0] as FeedFailure;
    expect(failure.errorType).toBe("NetworkError");
    expect(failure.statusCode).toBeUndefined();
    expect(failure.feedUrl).toBe("https://feed.example/down");
    expect(result.articles.length).toBeGreaterThan(0);
  });
});

describe("timeout isolation", () => {
  it("records a TimeoutError on AbortError rejection", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/slow", "https://feed.example/live"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(1);
    const failure = result.failedFeeds[0] as FeedFailure;
    expect(failure.errorType).toBe("TimeoutError");
    expect(failure.statusCode).toBeUndefined();
    expect(failure.feedUrl).toBe("https://feed.example/slow");
  });
});

describe("parse error", () => {
  it("records a ParseError for non-feed body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      asResponse(okResponse("<html><body>not a feed</body></html>")),
    );

    const result = await fetchFeeds(["https://feed.example/html"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(1);
    const failure = result.failedFeeds[0] as FeedFailure;
    expect(failure.errorType).toBe("ParseError");
    expect(failure.statusCode).toBeUndefined();
    expect(result.articles).toHaveLength(0);
  });
});

// ===========================================================================
// Empty feed
// ===========================================================================

describe("empty feed", () => {
  it("is not a failure and yields zero articles", async () => {
    const emptyRss =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0"><channel>' +
      "<title>Empty Feed</title><link>https://example.com</link>" +
      "<description>no items</description>" +
      "</channel></rss>";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(emptyRss)));

    const result = await fetchFeeds(["https://feed.example/empty"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(0);
    expect(result.articles).toHaveLength(0);
    expect(result.totalFeeds).toBe(1);
  });
});

// ===========================================================================
// limitPerFeed
// ===========================================================================

describe("limitPerFeed", () => {
  it("caps articles per feed in document order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["https://feed.example/rss"], {
      dateRange: "all",
      limitPerFeed: 2,
    });

    expect(result.articles).toHaveLength(2);
    // Document order preserved: first two items are "Today Article" then
    // "Yesterday Article".
    expect(result.articles.map((a) => a.title)).toEqual(["Today Article", "Yesterday Article"]);
  });
});

// ===========================================================================
// sanitizeUrlForLog
// ===========================================================================

describe("sanitizeUrlForLog", () => {
  it("redacts path and query, keeps scheme + host", () => {
    const redacted = sanitizeUrlForLog("https://example.com/feed?secret=abc");
    // scheme + host preserved, path/query replaced with a redaction marker.
    expect(redacted).toMatch(/^https:\/\/example\.com\//);
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("feed?secret=abc");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts cleanly when there is no path", () => {
    const redacted = sanitizeUrlForLog("https://example.com");
    expect(redacted).toMatch(/^https:\/\/example\.com\//);
    expect(redacted).toContain("[redacted]");
  });
});

// ===========================================================================
// FetchResult shape
// ===========================================================================

describe("FetchResult shape", () => {
  it("totalFeeds equals input length; articles/failedFeeds partition correctly", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(notOkResponse(404)))
      .mockResolvedValueOnce(asResponse(okResponse(RSS_XML)))
      .mockResolvedValueOnce(asResponse(okResponse("<html>not a feed</html>")));

    const result: FetchResult = await fetchFeeds(
      ["https://feed.example/dead", "https://feed.example/live", "https://feed.example/bad"],
      { dateRange: "all" },
    );

    expect(result.totalFeeds).toBe(3);
    expect(result.failedFeeds).toHaveLength(2);
    // All articles come from the one live feed.
    expect(result.articles.every((a) => a.source === "Sample RSS Feed")).toBe(true);
    // Partition: a feed is either failed (in failedFeeds) or contributing
    // (its articles are present), never both, never neither (except empty).
    const failedUrls = new Set(result.failedFeeds.map((f) => f.feedUrl));
    expect(failedUrls.has("https://feed.example/dead")).toBe(true);
    expect(failedUrls.has("https://feed.example/bad")).toBe(true);
    expect(failedUrls.has("https://feed.example/live")).toBe(false);
  });
});

// ===========================================================================
// Standalone helper + class parity
// ===========================================================================

describe("RSSFetcher class", () => {
  it("RSSFetcher.fetch returns the same shape as fetchFeeds helper", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const fetcher = new RSSFetcher(["https://feed.example/rss"], {
      dateRange: "all",
    });
    const result = await fetcher.fetch();

    expect(result.totalFeeds).toBe(1);
    expect(result.failedFeeds).toHaveLength(0);
    expect(result.articles.length).toBeGreaterThan(0);
    expect(result.articles.every((a) => a.published instanceof Date)).toBe(true);
  });
});

// ===========================================================================
// Fetch safety: scheme guard + redirect + body cap (S2, P1)
// ===========================================================================

describe("scheme guard: non-http(s) feed URL", () => {
  it("rejects file:/// URL as a BlockedError FeedFailure without calling fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["file:///etc/passwd"], {
      dateRange: "all",
    });

    expect(spy).not.toHaveBeenCalled();
    expect(result.failedFeeds).toHaveLength(1);
    const failure = result.failedFeeds[0] as FeedFailure;
    expect(failure.errorType).toBe("BlockedError");
    expect(failure.feedUrl).toBe("file:///etc/passwd");
    expect(result.articles).toHaveLength(0);
  });

  it("rejects ftp:// URL as a BlockedError FeedFailure", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["ftp://example.com/feed"], {
      dateRange: "all",
    });

    expect(spy).not.toHaveBeenCalled();
    expect(result.failedFeeds[0]?.errorType).toBe("BlockedError");
  });

  it("rejects a non-parseable URL as a BlockedError FeedFailure", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["not a url at all"], {
      dateRange: "all",
    });

    expect(spy).not.toHaveBeenCalled();
    expect(result.failedFeeds[0]?.errorType).toBe("BlockedError");
  });
});

describe("scheme guard: link-local / private IPs are NOT blocked", () => {
  it("fetches http://169.254.169.254 (operator-owned, allowed)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["http://169.254.169.254/latest/meta-data"], {
      dateRange: "all",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.failedFeeds).toHaveLength(0);
    expect(result.articles.length).toBeGreaterThan(0);
  });

  it("fetches http://10.0.0.1 internal host (allowed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(okResponse(RSS_XML)));

    const result = await fetchFeeds(["http://10.0.0.1/feed.xml"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(0);
    expect(result.articles.length).toBeGreaterThan(0);
  });
});

describe("redirect guard", () => {
  it("rejects a feed that 302-redirects (redirect:'error') as a FeedFailure", async () => {
    // With redirect: 'error', fetch rejects on ANY redirect (including a
    // 302 to file://). Mock the runtime's rejection.
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("Failed to fetch: redirect not followed"),
    );

    const result = await fetchFeeds(["https://feed.example/redirect"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(1);
    expect(result.articles).toHaveLength(0);
  });
});

describe("body size cap (Content-Length)", () => {
  it("rejects a feed declaring Content-Length above the cap as a BlockedError", async () => {
    const oversize: MockResponse = {
      ok: true,
      status: 200,
      headers: { "content-length": "500000000" },
      text: async () => "x".repeat(1000),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(oversize));

    const result = await fetchFeeds(["https://feed.example/huge"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(1);
    expect(result.failedFeeds[0]?.errorType).toBe("BlockedError");
    expect(result.articles).toHaveLength(0);
  });

  it("does not buffer the body when Content-Length exceeds the cap", async () => {
    const textSpy = vi.fn(async () => {
      throw new Error("body should not be read");
    });
    const oversize: MockResponse = {
      ok: true,
      status: 200,
      headers: { "content-length": "500000000" },
      text: textSpy,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(oversize));

    const result = await fetchFeeds(["https://feed.example/huge"], {
      dateRange: "all",
    });

    expect(textSpy).not.toHaveBeenCalled();
    expect(result.failedFeeds).toHaveLength(1);
  });
});

describe("body size cap (streaming body without Content-Length)", () => {
  it("rejects an oversized body read via response.text fallback", async () => {
    // maxBytes is DEFAULT_MAX_FETCH_BYTES (5MB). Serve a body larger
    // than that with no Content-Length header so the fallback path enforces.
    const big = "a".repeat(DEFAULT_MAX_FETCH_BYTES + 1000);
    const oversize: MockResponse = {
      ok: true,
      status: 200,
      text: async () => big,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(asResponse(oversize));

    const result = await fetchFeeds(["https://feed.example/big-stream"], {
      dateRange: "all",
    });

    expect(result.failedFeeds).toHaveLength(1);
    expect(result.failedFeeds[0]?.errorType).toBe("BlockedError");
  });
});

// ===========================================================================
// Cross-feed dedup (C5)
// ===========================================================================

describe("cross-feed dedup (C5)", () => {
  it("collapses the same article link across two feeds to one occurrence", async () => {
    const dupRss =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0"><channel>' +
      "<title>Dup Feed</title><link>https://example.com</link>" +
      "<description>dup</description>" +
      "<item>" +
      "<title>Shared Article</title>" +
      "<link>https://example.com/shared</link>" +
      "<pubDate>Tue, 30 Jun 2026 09:00:00 GMT</pubDate>" +
      "<description>body</description>" +
      "</item>" +
      "</channel></rss>";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(dupRss)))
      .mockResolvedValueOnce(asResponse(okResponse(dupRss)));

    const result = await fetchFeeds(["https://feed.example/a", "https://feed.example/b"], {
      dateRange: "all",
    });

    const shared = result.articles.filter((a) => a.link === "https://example.com/shared");
    expect(shared).toHaveLength(1);
    expect(result.totalFeeds).toBe(2);
    expect(result.failedFeeds).toHaveLength(0);
  });

  it("keeps both articles when they share a title but have different links", async () => {
    const feedA =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0"><channel>' +
      "<title>Feed A</title><link>https://example.com</link><description>a</description>" +
      "<item><title>Same Title</title>" +
      "<link>https://example.com/a-same-title</link>" +
      "<pubDate>Tue, 30 Jun 2026 09:00:00 GMT</pubDate>" +
      "<description>body</description></item>" +
      "</channel></rss>";
    const feedB =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0"><channel>' +
      "<title>Feed B</title><link>https://example.com</link><description>b</description>" +
      "<item><title>Same Title</title>" +
      "<link>https://example.com/b-same-title</link>" +
      "<pubDate>Tue, 30 Jun 2026 09:00:00 GMT</pubDate>" +
      "<description>body</description></item>" +
      "</channel></rss>";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(feedA)))
      .mockResolvedValueOnce(asResponse(okResponse(feedB)));

    const result = await fetchFeeds(["https://feed.example/a", "https://feed.example/b"], {
      dateRange: "all",
    });

    const titles = result.articles.map((a) => a.link).sort();
    expect(titles).toEqual([
      "https://example.com/a-same-title",
      "https://example.com/b-same-title",
    ]);
    expect(result.articles).toHaveLength(2);
  });

  it("keeps the first occurrence across feeds (document + feed order)", async () => {
    const feedA =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0"><channel>' +
      "<title>Feed A</title><link>https://example.com</link><description>a</description>" +
      "<item><title>From A</title>" +
      "<link>https://example.com/dup</link>" +
      "<pubDate>Tue, 30 Jun 2026 09:00:00 GMT</pubDate>" +
      "<description>body-a</description></item>" +
      "</channel></rss>";
    const feedB =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0"><channel>' +
      "<title>Feed B</title><link>https://example.com</link><description>b</description>" +
      "<item><title>From B</title>" +
      "<link>https://example.com/dup</link>" +
      "<pubDate>Tue, 30 Jun 2026 09:00:00 GMT</pubDate>" +
      "<description>body-b</description></item>" +
      "</channel></rss>";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(feedA)))
      .mockResolvedValueOnce(asResponse(okResponse(feedB)));

    const result = await fetchFeeds(["https://feed.example/a", "https://feed.example/b"], {
      dateRange: "all",
    });

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.title).toBe("From A");
  });
});
