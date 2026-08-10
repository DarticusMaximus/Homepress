/**
 * RSS fetcher — pipeline phase 1.
 *
 * Concurrently fetches a list of feed URLs with native `fetch`, parses each
 * body with feedsmith's `parseFeed`, maps items to {@link Article} records,
 * filters by date range, and assembles a {@link FetchResult}. Per-feed errors
 * (HTTP non-2xx, network, timeout, parse) are isolated — a failed feed is
 * recorded as a {@link FeedFailure} and never aborts the run or affects
 * sibling feeds. Pure compute: no persistence, no LLM, no Appwrite.
 */

import { parseFeed } from "feedsmith";

import { getDateFilter, DEFAULT_MAX_FETCH_BYTES } from "./config";
import type { DateRange } from "./config";
import { fetchWithSizeLimit, UnsafeUrlError, OversizeBodyError } from "./fetch-safety";
import {
  createArticle,
  type Article,
  type FeedErrorType,
  type FeedFailure,
  type FetchResult,
} from "./types";

/** Per-feed request timeout (matches the spec / legacy default). */
const FEED_TIMEOUT_MS = 30_000;

/** Redaction placeholder used by {@link sanitizeUrlForLog}. */
const REDACTED = "[redacted]";

/** Safe placeholder returned when a URL cannot be parsed for logging. */
const INVALID_URL = "[invalid-url]";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface RSSFetcherOptions {
  /** Cap the number of articles taken from a single feed (first N in document order). */
  limitPerFeed?: number;
  /** Date range used to filter articles; defaults to `'yesterday'`. */
  dateRange?: DateRange;
}

/**
 * Fetch, parse, and filter a list of feeds concurrently with per-feed error
 * isolation. Equivalent to `new RSSFetcher(feeds, options).fetch()`.
 */
export async function fetchFeeds(
  feeds: string[],
  options?: RSSFetcherOptions,
): Promise<FetchResult> {
  return new RSSFetcher(feeds, options).fetch();
}

/**
 * Fetcher for a fixed list of feed URLs. Construct with a feed list and
 * optional `{ limitPerFeed, dateRange }`, then call {@link RSSFetcher.fetch}.
 */
export class RSSFetcher {
  constructor(
    private readonly feeds: string[],
    private readonly options?: RSSFetcherOptions,
  ) {}

  /** Fetch all feeds concurrently and return the assembled {@link FetchResult}. */
  async fetch(): Promise<FetchResult> {
    const settled = await Promise.allSettled(
      this.feeds.map((feedUrl) => this.fetchOneFeed(feedUrl)),
    );

    const articles: Article[] = [];
    const failedFeeds: FeedFailure[] = [];

    for (const result of settled) {
      // fetchOneFeed catches its own errors, so a rejection here would be a
      // catastrophic bug — surface it as a generic NetworkError failure so the
      // run is never aborted.
      if (result.status === "fulfilled") {
        if ("failure" in result.value) {
          failedFeeds.push(result.value.failure);
        } else {
          articles.push(...result.value.articles);
        }
      } else {
        // Defensive: should never happen because fetchOneFeed catches all.
        failedFeeds.push({
          feedUrl: "<unknown>",
          errorType: "NetworkError",
          errorMessage: String(result.reason),
        });
      }
    }

    return {
      articles: dedupeArticles(articles),
      failedFeeds,
      totalFeeds: this.feeds.length,
    };
  }

  // -------------------------------------------------------------------------
  // Per-feed work — NEVER throws. Returns either articles or a structured
  // failure so a single feed cannot affect its siblings.
  // -------------------------------------------------------------------------

  private async fetchOneFeed(
    feedUrl: string,
  ): Promise<{ articles: Article[] } | { failure: FeedFailure }> {
    let response: Response;
    let body: string;
    try {
      const result = await fetchWithSizeLimit(feedUrl, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        maxBytes: DEFAULT_MAX_FETCH_BYTES,
      });
      response = result.response;
      body = result.text;
    } catch (error) {
      return { failure: classifyFetchError(feedUrl, error) };
    }

    if (!response.ok) {
      return {
        failure: {
          feedUrl,
          errorType: "HttpError",
          errorMessage: `HTTP ${response.status} for ${sanitizeUrlForLog(feedUrl)}`,
          statusCode: response.status,
        },
      };
    }

    let parsed: ReturnType<typeof parseFeed>;
    try {
      parsed = parseFeed(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        failure: {
          feedUrl,
          errorType: "ParseError",
          errorMessage: message,
        },
      };
    }

    const articles = this.mapFeedToArticles(parsed, feedUrl);
    return { articles };
  }

  // -------------------------------------------------------------------------
  // Item mapping
  // -------------------------------------------------------------------------

  private mapFeedToArticles(parsed: ReturnType<typeof parseFeed>, feedUrl: string): Article[] {
    if (parsed.format === "rss") {
      const feed = parsed.feed;
      const source = feed.title ?? feedUrl;
      const items = feed.items ?? [];
      const limited =
        this.options?.limitPerFeed !== undefined
          ? items.slice(0, this.options.limitPerFeed)
          : items;
      return this.collectArticles(limited, (item) => ({
        title: item.title,
        link: item.link,
        published: parseDate(item.pubDate),
        content: item.content?.encoded ?? item.description ?? "",
        source,
      }));
    }

    if (parsed.format === "atom") {
      const feed = parsed.feed;
      const source = feed.title ?? feedUrl;
      const entries = feed.entries ?? [];
      const limited =
        this.options?.limitPerFeed !== undefined
          ? entries.slice(0, this.options.limitPerFeed)
          : entries;
      return this.collectArticles(limited, (entry) => ({
        title: entry.title,
        link: entry.links?.[0]?.href,
        published: parseDate(entry.published ?? entry.updated),
        content: entry.content ?? entry.summary ?? "",
        source,
      }));
    }

    // rdf / json feeds are not part of this feature's contract; treat as no
    // articles rather than a failure (the body parsed successfully).
    return [];
  }

  /**
   * Map each raw item to an {@link Article} via {@link createArticle}, applying
   * the date-range filter. Individual `createArticle` failures (e.g. empty
   * title) skip that article without failing the feed.
   */
  private collectArticles<T>(
    items: T[],
    toInput: (item: T) => {
      title: string | undefined;
      link: string | undefined;
      published: Date;
      content: string;
      source: string;
    },
  ): Article[] {
    const { start, end } = getDateFilter(this.options?.dateRange ?? "yesterday");
    const startTime = start.getTime();
    const endTime = end?.getTime() ?? null;

    const articles: Article[] = [];
    for (const item of items) {
      const input = toInput(item);
      let article: Article;
      try {
        article = createArticle({
          title: input.title ?? "",
          link: input.link ?? "",
          published: input.published,
          content: input.content,
          source: input.source,
        });
      } catch {
        continue;
      }
      const t = article.published.getTime();
      if (t < startTime) continue;
      if (endTime !== null && t > endTime) continue;
      articles.push(article);
    }
    return articles;
  }
}

// ---------------------------------------------------------------------------
// URL redaction for log output
// ---------------------------------------------------------------------------

/**
 * Redact the path and query of a feed URL for safe logging. Returns
 * `scheme://host/[redacted]`. Malformed input yields `'[invalid-url]'`.
 */
export function sanitizeUrlForLog(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return INVALID_URL;
  }
  const host = parsed.host;
  if (!host) return INVALID_URL;
  return `${parsed.protocol}//${host}/${REDACTED}`;
}

// ---------------------------------------------------------------------------
// Error classification & date helpers
// ---------------------------------------------------------------------------

/**
 * Classify a fetch-time error into a {@link FeedFailure}. SSRF-guard
 * ({@link UnsafeUrlError}) and body-cap ({@link OversizeBodyError}) failures
 * become `BlockedError`; abort/timeout → `TimeoutError`; other transport
 * errors → `NetworkError`. Never sets `statusCode`.
 */
function classifyFetchError(feedUrl: string, error: unknown): FeedFailure {
  if (error instanceof UnsafeUrlError || error instanceof OversizeBodyError) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      feedUrl,
      errorType: "BlockedError",
      errorMessage: message,
    };
  }
  return classifyTransportError(feedUrl, error);
}

/**
 * Deduplicate articles by a stable key: `article.link`, falling back to
 * `article.title` when `link` is empty/whitespace. Keeps the first occurrence
 * (document + feed order). Runs after concatenation, before returning
 * {@link FetchResult}.
 */
function dedupeArticles(articles: Article[]): Article[] {
  const seen = new Map<string, Article>();
  for (const article of articles) {
    const link = article.link.trim();
    const key = link !== "" ? link : article.title;
    if (!seen.has(key)) {
      seen.set(key, article);
    }
  }
  return [...seen.values()];
}

/**
 * Classify a transport (non-safety) error into a {@link FeedFailure}.
 * Abort/timeout → `TimeoutError`; other `TypeError`s → `NetworkError`; any
 * other thrown value → `NetworkError`. Never sets `statusCode`.
 */
function classifyTransportError(feedUrl: string, error: unknown): FeedFailure {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  let errorType: FeedErrorType;
  if (name === "AbortError" || name === "TimeoutError") {
    errorType = "TimeoutError";
  } else {
    errorType = "NetworkError";
  }

  return {
    feedUrl,
    errorType,
    errorMessage: message,
  };
}

/**
 * Parse an RSS/Atom date string into a `Date`. Missing or unparseable values
 * fall back to epoch (`new Date(0)`), mirroring the legacy `datetime.min`.
 */
function parseDate(value: string | undefined | null): Date {
  if (!value) return new Date(0);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date(0);
  return d;
}
