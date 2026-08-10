/**
 * Article scraper — pure-TypeScript port of the legacy Python scraper's
 * cleaning step, with a different extraction engine (Mozilla Readability +
 * jsdom + turndown instead of trafilatura).
 *
 * The cleaning step (`cleanContent`) is a **modified port** of
 * `scraper.py:_clean_content`: it preserves markdown-link URLs that the
 * legacy `_clean_content` destroyed (legacy parity is on end-result quality,
 * not byte-identical cleaning). The extraction step differs from the legacy
 * trafilatura path but produces the same kind of output (cleaned markdown of
 * the article main body) for downstream phases.
 *
 * Fetch ingress is scheme/redirect/size-guarded via the shared
 * {@link fetchWithSizeLimit} helper (no cross-scheme redirects, capped body).
 *
 * The scraper NEVER throws — every code path yields a usable
 * {@link ScrapeResult}, falling back to a cleaned RSS summary on any failure.
 */

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

import { DEFAULT_MAX_FETCH_BYTES } from "./config";
import {
  assertSafeFetchUrl,
  fetchWithSizeLimit,
  OversizeBodyError,
  UnsafeUrlError,
} from "./fetch-safety";
import type { ScrapeResult } from "./types";

// ---------------------------------------------------------------------------
// Patterns (parity-faithful port of scraper.py:12-32)
// ---------------------------------------------------------------------------

/** Match absolute http(s) URLs (the legacy Python `re.ASCII` URL_PATTERN). */
const URL_PATTERN = /https?:\/\/\S+/g;

/** Collapse runs of whitespace to a single space (legacy WHITESPACE_PATTERN). */
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Comprehensive emoji pattern covering all legacy Unicode ranges. Uses the `u`
 * flag and `]+` quantifier exactly as `scraper.py:18-32` does.
 */
const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}]+/gu;

// ---------------------------------------------------------------------------
// cleanContent — modified TS port of legacy scraper.py:_clean_content
// ---------------------------------------------------------------------------

/**
 * Modified TS port of the legacy `scraper.py:_clean_content`. Exact order of
 * operations:
 *
 * 1. Empty input → `""`.
 * 2. Split by `\n`; each line `.trim()`; keep only lines `length > 3`; rejoin with `\n`.
 * 3. **Modified step:** temporarily lift markdown-link URLs (`](https://...)`)
 *    into `@@MDLINKURL<n>@@` placeholders so the bare-URL strip below does not
 *    destroy them (the legacy `_clean_content` did destroy them — this port
 *    intentionally diverges to keep extracted links usable).
 * 4. Remove bare URLs (`https?://\S+`).
 * 5. Restore the preserved markdown-link URLs from their placeholders.
 * 6. **Sentinel-leak guard:** strip any `@@MDLINKURL<n>@@` token that failed
 *    to restore (defense-in-depth — the restore already maps unmatched
 *    indices to `""`, this guarantees no placeholder ever reaches downstream).
 * 7. Collapse whitespace runs to a single space (`\s+` → ` `).
 * 8. Remove emoji across the legacy Unicode ranges (`]+` quantifier, `u` flag).
 * 9. `.trim()` and return.
 */
export function cleanContent(content: string): string {
  if (!content) return "";

  // Step 2: line drop (Python's .strip() === JS .trim(); keep len > 3).
  const lines = content.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 3) kept.push(trimmed);
  }
  let text = kept.join("\n");

  // MODIFIED PORT (reconciliation): the legacy port strips ALL bare URLs
  // (step 4 below). That would also destroy the URL inside markdown link
  // syntax `[text](https://...)`, leaving `[text](` — which the scraper tests
  // require to survive (an extracted link must remain a usable link). The
  // legacy Python exhibited the same destruction, but the TS test contract
  // explicitly asserts `](https://example.com/related)` survives. To satisfy
  // BOTH the bare-URL strip (cleanContent unit test) AND markdown-link
  // preservation (scraper test), we temporarily lift markdown-link URLs out,
  // strip bare URLs, then restore them. Bare URLs outside link syntax are
  // still stripped exactly as the legacy port requires.
  //
  // The `@@MDLINKURL<n>@@` placeholder technique is documented as part of the
  // modified-port contract (feature-03 spec amendment N1-20260630).
  const linkUrls: string[] = [];
  text = text.replace(/\]\((https?:\/\/[^)\s]+)\)/g, (_m, url: string) => {
    const i = linkUrls.length;
    linkUrls.push(url);
    return `](@@MDLINKURL${i}@@)`;
  });

  // Step 4: strip URLs.
  text = text.replace(URL_PATTERN, "");

  // Step 5: restore preserved markdown-link URLs.
  text = text.replace(/@@MDLINKURL(\d+)@@/g, (_m, i: string) => linkUrls[Number(i)] ?? "");

  // Step 6: sentinel-leak guard — strip any placeholder that survived the
  // restore (defense-in-depth; never leak `@@MDLINKURL*@@` downstream).
  text = text.replace(/@@MDLINKURL\d+@@/g, "");

  // Step 7: collapse whitespace.
  text = text.replace(WHITESPACE_PATTERN, " ");

  // Step 8: strip emoji.
  text = text.replace(EMOJI_PATTERN, "");

  // Step 9: trim.
  return text.trim();
}

// ---------------------------------------------------------------------------
// ArticleScraper
// ---------------------------------------------------------------------------

/** Default per-request timeout (ms) when SCRAPER_TIMEOUT_MS is unset. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Default minimum extracted text length when SCRAPER_MIN_EXTRACTED_LENGTH is unset. */
const DEFAULT_MIN_EXTRACTED_TEXT_LENGTH = 200;

/**
 * Minimum extracted text length (chars) to be considered a real article.
 * Readability will happily "parse" near-empty pages (e.g. a `<div>login</div>`
 * login screen) into a tiny fragment; the legacy trafilatura path returned
 * `None` for such pages (favor_precision). This threshold reconciles the
 * engines: extracted text shorter than this is treated as not-readerable and
 * falls back. This is a real feature — it drops ad/trash snippets. Configurable
 * via the `SCRAPER_MIN_EXTRACTED_LENGTH` env var (default `200`).
 */

/**
 * Classify a fetch/url error into a short diagnostic for the fallback
 * `ScrapeResult.error` field. Maps the shared safety errors and transport
 * errors to stable strings.
 */
function classifyFetchError(error: unknown): string {
  if (error instanceof UnsafeUrlError) {
    return `unsafe-url: ${error.message}`;
  }
  if (error instanceof OversizeBodyError) {
    return "oversize";
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return "timeout";
  }
  return error instanceof Error ? error.message || error.name : String(error);
}

/**
 * Scrapes article main content from a URL, falling back to `fallbackContent`
 * on any failure. NEVER throws.
 */
export class ArticleScraper {
  private readonly timeoutMs: number;
  private readonly minExtractedTextLength: number;

  constructor() {
    const env = process.env.SCRAPER_TIMEOUT_MS;
    const parsed = env !== undefined ? Number(env) : NaN;
    this.timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;

    const minEnv = process.env.SCRAPER_MIN_EXTRACTED_LENGTH;
    const minParsed = minEnv !== undefined ? Number(minEnv) : NaN;
    this.minExtractedTextLength =
      Number.isFinite(minParsed) && minParsed >= 0 ? minParsed : DEFAULT_MIN_EXTRACTED_TEXT_LENGTH;
  }

  async scrape(url: string, fallbackContent: string): Promise<ScrapeResult> {
    try {
      // Pre-validate the URL scheme (http/https). Throws UnsafeUrlError on a
      // non-http(s) or unparseable URL — caught below → fallback.
      assertSafeFetchUrl(url);

      // Shared capped fetch: redirect:'error' (no cross-scheme redirects) +
      // Content-Length / streaming body cap. Throws UnsafeUrlError /
      // OversizeBodyError / transport errors → caught below → fallback.
      let response: Response;
      let body: string;
      try {
        const result = await fetchWithSizeLimit(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          maxBytes: DEFAULT_MAX_FETCH_BYTES,
        });
        response = result.response;
        body = result.text;
      } catch (error) {
        return {
          url,
          content: cleanContent(fallbackContent),
          source: "fallback",
          error: classifyFetchError(error),
        };
      }

      if (!response.ok) {
        return {
          url,
          content: cleanContent(fallbackContent),
          source: "fallback",
          error: `HTTP ${response.status}`,
        };
      }

      if (!body) {
        return {
          url,
          content: cleanContent(fallbackContent),
          source: "fallback",
          error: "empty-body",
        };
      }

      // jsdom defaults: scripts do NOT run, remote resources are NOT fetched.
      const dom = new JSDOM(body, { url });
      const doc = dom.window.document;

      const article = new Readability(doc).parse();
      const textLength = article?.textContent?.trim().length ?? 0;
      if (article === null || !article.content || textLength < this.minExtractedTextLength) {
        return {
          url,
          content: cleanContent(fallbackContent),
          source: "fallback",
          error: "not-readerable",
        };
      }

      let md = new TurndownService({ headingStyle: "atx" }).turndown(article.content);
      if (article.title) {
        md = `# ${article.title}\n\n${md}`;
      }

      return {
        url,
        content: cleanContent(md),
        source: "extracted",
      };
    } catch (error) {
      // Defensive: NO code path should reach here, but the contract guarantees
      // the scraper never throws. Map any surprise to a fallback result.
      const diagnostic = classifyFetchError(error);
      return {
        url,
        content: cleanContent(fallbackContent),
        source: "fallback",
        error: diagnostic,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone wrappers
// ---------------------------------------------------------------------------

/** Standalone wrapper over `new ArticleScraper().scrape(...)`. */
export async function scrapeArticle(url: string, fallbackContent: string): Promise<ScrapeResult> {
  return new ArticleScraper().scrape(url, fallbackContent);
}

/**
 * Concurrent, order-preserving, isolated batch scraper. Uses `Promise.allSettled`
 * so a failure on one item never affects siblings. Because `scrape` never
 * throws, fulfilled entries are passed through directly; a (defensive)
 * rejected entry maps to a fallback ScrapeResult with `error: 'unexpected'`.
 */
export async function scrapeAll(
  items: { url: string; fallbackContent: string }[],
): Promise<ScrapeResult[]> {
  if (items.length === 0) return [];

  const settled = await Promise.allSettled(
    items.map((item) => new ArticleScraper().scrape(item.url, item.fallbackContent)),
  );

  const results: ScrapeResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      const item = items[i];
      results.push({
        url: item.url,
        content: cleanContent(item.fallbackContent),
        source: "fallback",
        error: "unexpected",
      });
    }
  }
  return results;
}
