import { describe, it, expect, vi } from "vitest";
import type {
  Article,
  FeedFailure,
  FetchResult,
  RSSFetcherOptions,
  ScrapeResult,
} from "../../pipeline";
import { qualifyFeed } from "../qualify";

const FEED_URL = "https://example.com/feed";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: "Test Article",
    link: "https://example.com/article",
    published: new Date("2026-01-01T00:00:00.000Z"),
    content: "Article body content",
    source: "test-feed",
    ...overrides,
  };
}

function makeFeedFailure(overrides: Partial<FeedFailure> = {}): FeedFailure {
  return {
    feedUrl: FEED_URL,
    errorType: "NetworkError",
    errorMessage: "connection reset",
    ...overrides,
  };
}

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    articles: [],
    failedFeeds: [],
    totalFeeds: 1,
    ...overrides,
  };
}

function makeScrapeResult(overrides: Partial<ScrapeResult> = {}): ScrapeResult {
  return {
    url: "https://example.com/article",
    content: "extracted article body",
    source: "extracted",
    ...overrides,
  };
}

function fetchReturning(result: FetchResult) {
  return vi.fn(
    async (_feeds: string[], _options?: RSSFetcherOptions): Promise<FetchResult> => result,
  );
}

function scrapeReturning(result: ScrapeResult) {
  return vi.fn(async (_url: string, _fallback: string): Promise<ScrapeResult> => result);
}

function publicResolver() {
  return vi.fn(async (_host: string) => ["93.184.216.34"]);
}

describe("qualifyFeed", () => {
  it("passes when a feed yields one article with an https link and scrape extracts it", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [makeArticle({ link: "https://example.com/article" })],
      }),
    );
    const scrapeMock = scrapeReturning(makeScrapeResult({ source: "extracted" }));

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]![0]).toEqual([FEED_URL]);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ dateRange: "all" });
  });

  it("fails with 'Could not fetch the RSS feed' when failedFeeds is non-empty (no detail for NetworkError)", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [],
        failedFeeds: [
          makeFeedFailure({ errorType: "NetworkError", errorMessage: "connection reset" }),
        ],
      }),
    );
    const scrapeMock = scrapeReturning(makeScrapeResult());

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    expect(result).toEqual({ ok: false, reason: "Could not fetch the RSS feed" });
    expect(scrapeMock).not.toHaveBeenCalled();
  });

  it("appends '(timed out)' detail on a TimeoutError feed failure", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [],
        failedFeeds: [
          makeFeedFailure({
            errorType: "TimeoutError",
            errorMessage: "timed out after 30000ms",
          }),
        ],
      }),
    );

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeReturning(makeScrapeResult()),
      resolver: publicResolver(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^Could not fetch the RSS feed/);
      expect(result.reason).toContain("(timed out)");
    }
  });

  it("appends '(HTTP 403)' detail on an HttpError feed failure with statusCode", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [],
        failedFeeds: [
          makeFeedFailure({
            errorType: "HttpError",
            errorMessage: "Forbidden",
            statusCode: 403,
          }),
        ],
      }),
    );

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeReturning(makeScrapeResult()),
      resolver: publicResolver(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^Could not fetch the RSS feed/);
      expect(result.reason).toContain("(HTTP 403)");
    }
  });

  it("fails with 'Feed has no articles' when articles and failedFeeds are both empty", async () => {
    const fetchMock = fetchReturning(makeFetchResult({ articles: [], failedFeeds: [] }));
    const scrapeMock = scrapeReturning(makeScrapeResult());

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    expect(result).toEqual({ ok: false, reason: "Feed has no articles" });
    expect(scrapeMock).not.toHaveBeenCalled();
  });

  it("fails with 'Feed items have no article links' when all links are unusable and does not throw", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [
          makeArticle({ link: "" }),
          makeArticle({ link: "ftp://example.com/file" }),
          makeArticle({ link: "/relative/path" }),
          makeArticle({ link: "not-a-url" }),
        ],
      }),
    );
    const scrapeMock = scrapeReturning(makeScrapeResult());

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    expect(result).toEqual({ ok: false, reason: "Feed items have no article links" });
    expect(scrapeMock).not.toHaveBeenCalled();
  });

  it("skips a bad link and qualifies using the next usable https link", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [
          makeArticle({ link: "not-a-url" }),
          makeArticle({ link: "ftp://example.com/file" }),
          makeArticle({ link: "https://example.com/article-3" }),
        ],
      }),
    );
    const scrapeMock = scrapeReturning(makeScrapeResult({ source: "extracted" }));

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    expect(result).toEqual({ ok: true });
    expect(scrapeMock.mock.calls).toHaveLength(1);
    expect(scrapeMock.mock.calls[0]![0]).toBe("https://example.com/article-3");
  });

  it("fails with 'Could not retrieve article content' when scrape returns fallback (not a pass)", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [makeArticle({ link: "https://example.com/article" })],
      }),
    );
    const scrapeMock = scrapeReturning(
      makeScrapeResult({ source: "fallback", content: "rss summary", error: "timeout" }),
    );

    const result = await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^Could not retrieve article content/);
    }
  });

  it("does not pass limitPerFeed: 1 to fetchFeeds", async () => {
    const fetchMock = fetchReturning(
      makeFetchResult({
        articles: [makeArticle({ link: "https://example.com/article" })],
      }),
    );
    const scrapeMock = scrapeReturning(makeScrapeResult({ source: "extracted" }));

    await qualifyFeed(FEED_URL, {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver: publicResolver(),
    });

    const options = fetchMock.mock.calls[0]![1];
    expect(options?.limitPerFeed).toBeUndefined();
  });

  it("returns a Promise", () => {
    const fetchMock = fetchReturning(makeFetchResult());
    const scrapeMock = scrapeReturning(makeScrapeResult());

    expect(
      qualifyFeed(FEED_URL, {
        fetchFeeds: fetchMock,
        scrapeArticle: scrapeMock,
        resolver: publicResolver(),
      }),
    ).toBeInstanceOf(Promise);
  });

  it("rejects a loopback feed URL via the SSRF guard before calling fetchFeeds", async () => {
    const fetchMock = fetchReturning(makeFetchResult());
    const scrapeMock = scrapeReturning(makeScrapeResult());
    const resolver = publicResolver();

    const result = await qualifyFeed("http://127.0.0.1/feed", {
      fetchFeeds: fetchMock,
      scrapeArticle: scrapeMock,
      resolver,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/publicly routable/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects a cloud-metadata URL via the SSRF guard before calling fetchFeeds", async () => {
    const fetchMock = fetchReturning(makeFetchResult());
    const resolver = publicResolver();

    const result = await qualifyFeed("http://169.254.169.254/latest/meta-data/", {
      fetchFeeds: fetchMock,
      resolver,
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects a hostname that DNS-resolves into a private range before calling fetchFeeds", async () => {
    const fetchMock = fetchReturning(makeFetchResult());
    const resolver = vi.fn(async (_host: string) => ["10.0.0.5"]);

    const result = await qualifyFeed("https://sneaky.example.com/feed", {
      fetchFeeds: fetchMock,
      resolver,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/publicly routable/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolver).toHaveBeenCalledWith("sneaky.example.com");
  });
});
