import { fetchFeeds, sanitizeUrlForLog, scrapeArticle } from "../pipeline";
import type { Article } from "../pipeline";
import { isPubliclyRoutableUrl, type DnsResolver } from "./ssrf";

export type QualifyFeedResult = { ok: true } | { ok: false; reason: string };

export async function qualifyFeed(
  url: string,
  deps?: {
    fetchFeeds?: typeof fetchFeeds;
    scrapeArticle?: typeof scrapeArticle;
    resolver?: DnsResolver;
  },
): Promise<QualifyFeedResult> {
  const routability = await isPubliclyRoutableUrl(url, deps?.resolver);
  if (!routability.ok) {
    return { ok: false, reason: routability.reason };
  }

  const fetch = deps?.fetchFeeds ?? fetchFeeds;
  const result = await fetch([url], { dateRange: "all" });

  if (result.failedFeeds.length > 0) {
    const failure = result.failedFeeds[0]!;
    let reason = "Could not fetch the RSS feed";
    if (failure.errorType === "TimeoutError") {
      reason += " (timed out)";
    } else if (failure.errorType === "HttpError" && failure.statusCode !== undefined) {
      reason += ` (HTTP ${failure.statusCode})`;
    }
    console.error({
      phase: "feed-qualify",
      feedUrl: sanitizeUrlForLog(url),
      errorType: failure.errorType,
      errorMessage: failure.errorMessage,
    });
    return { ok: false, reason };
  }

  if (result.articles.length === 0) {
    return { ok: false, reason: "Feed has no articles" };
  }

  let article: Article | undefined;
  for (const candidate of result.articles) {
    const link = candidate.link?.trim() ?? "";
    try {
      const parsed = new URL(link);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      article = candidate;
      break;
    } catch {
      continue;
    }
  }

  if (!article) {
    return { ok: false, reason: "Feed items have no article links" };
  }

  const scrape = deps?.scrapeArticle ?? scrapeArticle;
  const scraped = await scrape(article.link, article.content ?? "");

  if (scraped.source !== "extracted") {
    let reason = "Could not retrieve article content";
    const err = scraped.error;
    if (err === "timeout") {
      reason += " (timeout)";
    } else if (err !== undefined && /^HTTP \d+$/.test(err)) {
      reason += ` (${err})`;
    } else if (err === "not-readerable") {
      reason += " (not readable)";
    } else if (
      typeof err === "string" &&
      err.length > 0 &&
      err.length <= 40 &&
      !err.includes("\n") &&
      !/<[^>]+>/.test(err)
    ) {
      reason += ` (${err})`;
    }
    console.error({
      phase: "feed-qualify",
      feedUrl: sanitizeUrlForLog(article.link),
      scrapeError: scraped.error,
    });
    return { ok: false, reason };
  }

  return { ok: true };
}
