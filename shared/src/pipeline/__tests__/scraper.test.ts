import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ArticleScraper, scrapeArticle, scrapeAll, cleanContent } from "../scraper";
import { fetchDispatch } from "../fetch-safety";
import type { DnsResolver } from "../../feeds/ssrf";
import type { ScrapeResult } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

const ARTICLE_HTML = readFileSync(join(FIXTURES, "article-sample.html"), "utf8");
const NON_ARTICLE_HTML = readFileSync(join(FIXTURES, "non-article.html"), "utf8");
const NO_TITLE_HTML = readFileSync(join(FIXTURES, "no-title-article.html"), "utf8");
const SHORT_ARTICLE_HTML = readFileSync(join(FIXTURES, "short-article.html"), "utf8");

const ARTICLE_TITLE = "Understanding Modern Pipeline Architecture";

// Hermetic DNS answers so no test depends on real DNS (fail-closed guard).
const PUBLIC_RESOLVER: DnsResolver = async () => ["93.184.216.34"];
const PRIVATE_RESOLVER: DnsResolver = async () => ["10.1.2.3"];

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type MockResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers?: Headers;
};

function okResponse(body: string): MockResponse {
  return { ok: true, status: 200, text: async () => body };
}

function notOkResponse(status: number): MockResponse {
  return { ok: false, status, text: async () => "" };
}

function oversizeResponse(contentLength: number): MockResponse {
  const headers = new Headers();
  headers.set("content-length", String(contentLength));
  return {
    ok: true,
    status: 200,
    text: async () => "<html></html>",
    headers,
  };
}

function asResponse(mock: MockResponse): Response {
  return mock as unknown as Response;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ===========================================================================
// cleanContent
// ===========================================================================

describe("cleanContent", () => {
  it("empty input -> empty string", () => {
    expect(cleanContent("")).toBe("");
  });

  it("strips URLs", () => {
    const out = cleanContent("hello https://example.com/foo bar");
    expect(out).not.toContain("https://example.com/foo");
    expect(out).toContain("bar");
  });

  it("collapses whitespace to single spaces", () => {
    const out = cleanContent("one    two\tthree\n\nfour");
    // After line-drop + join + collapse, runs of whitespace become a single
    // space.
    expect(out).not.toMatch(/\s{2,}/);
    expect(out).toContain("one");
    expect(out).toContain("four");
  });

  it("removes emoji across legacy unicode ranges", () => {
    // Emoticon 😀 (U+1F600), pictograph 🌰 (U+1F330), transport 🚀 (U+1F680),
    // flag 🇦🇨 (regional indicators), dingbat ✂ (U+2702), misc symbol ☀ (U+2600).
    const input = "Hello 😀 world 🌰 rocket 🚀 sun ☀ scissors ✂ done";
    const out = cleanContent(input);
    expect(out).not.toContain("😀");
    expect(out).not.toContain("🌰");
    expect(out).not.toContain("🚀");
    expect(out).not.toContain("☀");
    expect(out).not.toContain("✂");
    expect(out).toContain("Hello");
    expect(out).toContain("world");
    expect(out).toContain("done");
  });

  it("drops lines of length <= 3", () => {
    const out = cleanContent("ab\nthis is ten\nxy");
    expect(out).not.toContain("ab");
    expect(out).not.toContain("xy");
    expect(out).toContain("this is ten");
  });

  it("preserves markdown-link URLs (modified port)", () => {
    const out = cleanContent("see [related patterns](https://example.com/related) for more");
    expect(out).toContain("](https://example.com/related)");
    expect(out).toContain("[related patterns]");
  });

  it("never leaks a @@MDLINKURL sentinel token", () => {
    // A sentinel that was never registered (malformed link input, or a
    // restore that failed) must be stripped by the sentinel-leak guard.
    const out = cleanContent("hello @@MDLINKURL99@@ world text here ok");
    expect(out).not.toMatch(/@@MDLINKURL/);
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });
});

// ===========================================================================
// scrape — extraction success
// ===========================================================================

describe("scrape — extracted success", () => {
  it("returns source 'extracted' with title prepended and nav excluded", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "https://example.com/article",
      "fallback body",
      {
        resolver: PUBLIC_RESOLVER,
      },
    );

    expect(result.source).toBe("extracted");
    expect(result.url).toBe("https://example.com/article");
    expect(result.error).toBeUndefined();
    // Title prepended as `# {title}`.
    expect(result.content.startsWith(`# ${ARTICLE_TITLE}`)).toBe(true);
    // Nav / boilerplate text excluded.
    expect(result.content).not.toContain("Contact Us");
    expect(result.content).not.toContain("boilerplate");
  });

  it("converts <h2> to `## ...` and links to `[text](url)`", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape("https://example.com/article", "fallback", {
      resolver: PUBLIC_RESOLVER,
    });

    expect(result.source).toBe("extracted");
    // An <h2> from the fixture became a markdown level-2 heading.
    expect(result.content).toMatch(/##\s+.+/);
    // The related link became a markdown link.
    expect(result.content).toMatch(
      /\[related patterns[^\]]*\]\(https:\/\/example\.com\/related\)/i,
    );
  });

  it("does not prepend `# ...` when no title is present", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(NO_TITLE_HTML)));

    const result = await new ArticleScraper().scrape("https://example.com/no-title", "fallback", {
      resolver: PUBLIC_RESOLVER,
    });

    expect(result.source).toBe("extracted");
    expect(result.content.startsWith("#")).toBe(false);
  });
});

// ===========================================================================
// scrape — fallback paths
// ===========================================================================

describe("scrape — non-2xx fallback", () => {
  it("returns source 'fallback' with error set, does not throw", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(notOkResponse(500)));

    const fallback = "summary text here";
    const result = await new ArticleScraper().scrape("https://example.com/oops", fallback, {
      resolver: PUBLIC_RESOLVER,
    });

    expect(result.source).toBe("fallback");
    expect(result.error).toBeTruthy();
    expect(result.url).toBe("https://example.com/oops");
    // Content is the cleaned fallback (line-drop keeps lines > 3 chars).
    expect(result.content).toContain("summary text here");
  });
});

describe("scrape — network error fallback", () => {
  it("returns source 'fallback' with error set, does not throw", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await new ArticleScraper().scrape(
      "https://example.com/down",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
    expect(result.error).toBeTruthy();
  });
});

describe("scrape — timeout fallback", () => {
  it("returns source 'fallback' with error === 'timeout' on AbortError", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    vi.spyOn(fetchDispatch, "fetch").mockRejectedValueOnce(abortErr);

    const result = await new ArticleScraper().scrape(
      "https://example.com/slow",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
    expect(result.error).toBe("timeout");
  });
});

describe("scrape — empty body fallback", () => {
  it("returns source 'fallback' when body is empty", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse("")));

    const result = await new ArticleScraper().scrape(
      "https://example.com/empty",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
  });
});

describe("scrape — not readerable fallback", () => {
  it("returns source 'fallback' when parse() yields null", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(NON_ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "https://example.com/login",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
  });
});

// ===========================================================================
// scrape — SSRF / scheme guard (feature-08 S2/S3)
// ===========================================================================

describe("scrape — scheme guard", () => {
  it("rejects a file:// URL → fallback, never calls fetch, error set", async () => {
    const spy = vi
      .spyOn(fetchDispatch, "fetch")
      .mockResolvedValue(asResponse(okResponse(ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape("file:///etc/passwd", "fallback content");

    expect(result.source).toBe("fallback");
    expect(result.error).toBeTruthy();
    expect(result.url).toBe("file:///etc/passwd");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a redirect (blocked by redirect:'error') → fallback", async () => {
    // fetch-safety uses redirect:'error'; any redirect rejects the fetch
    // promise. We simulate that by rejecting fetch (the real behavior under
    // redirect:'error' when a 302 to file:// is attempted).
    vi.spyOn(fetchDispatch, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await new ArticleScraper().scrape(
      "https://example.com/redirects-to-file",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
    expect(result.error).toBeTruthy();
  });
});

// ===========================================================================
// scrape — body size cap (feature-08 P1)
// ===========================================================================

describe("scrape — oversize body fallback", () => {
  it("Content-Length > cap → fallback with error 'oversize'", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(oversizeResponse(6_000_000)));

    const result = await new ArticleScraper().scrape(
      "https://example.com/huge",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
    expect(result.error).toBe("oversize");
  });
});

// ===========================================================================
// scrape — configurable min extracted length (feature-08 N2)
// ===========================================================================

describe("scrape — SCRAPER_MIN_EXTRACTED_LENGTH", () => {
  it("extracts a short article when floor is lowered below its length", async () => {
    vi.stubEnv("SCRAPER_MIN_EXTRACTED_LENGTH", "50");
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(SHORT_ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "https://example.com/short",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("extracted");
  });

  it("falls back on the same short article at the default 200 floor", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(SHORT_ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "https://example.com/short",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(result.source).toBe("fallback");
    expect(result.error).toBe("not-readerable");
  });
});

// ===========================================================================
// scrape — timeout configuration
// ===========================================================================

describe("scrape — SCRAPER_TIMEOUT_MS", () => {
  // Strong test for T1-20260630: the prior test only asserted a signal was
  // forwarded and `!aborted` — which passes whether the scraper uses the env
  // value OR the hardcoded default. Here we spy on `AbortSignal.timeout` and
  // assert the exact ms argument it was called with, so the test fails if the
  // scraper ignores SCRAPER_TIMEOUT_MS. The spy returns a fresh non-aborting
  // signal so the rest of the scrape flow is unaffected.
  it("constructs AbortSignal.timeout with the env-configured ms, not the default", async () => {
    vi.stubEnv("SCRAPER_TIMEOUT_MS", "12345");
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    await new ArticleScraper().scrape("https://example.com/article", "fallback", {
      resolver: PUBLIC_RESOLVER,
    });

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const ms = timeoutSpy.mock.calls[0]?.[0];
    // Must be the configured 12345, NOT the default 30000.
    expect(ms).toBe(12345);
  });

  it("falls back to the default ms when SCRAPER_TIMEOUT_MS is unset", async () => {
    // Ensure the env var is absent (not stubbed).
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    await new ArticleScraper().scrape("https://example.com/article", "fallback", {
      resolver: PUBLIC_RESOLVER,
    });

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const ms = timeoutSpy.mock.calls[0]?.[0];
    expect(ms).toBe(30_000);
  });
});

// ===========================================================================
// scrapeArticle helper
// ===========================================================================

describe("scrapeArticle", () => {
  it("returns a ScrapeResult on success", async () => {
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    const result = await scrapeArticle("https://example.com/article", "fallback", {
      resolver: PUBLIC_RESOLVER,
    });

    expect(result.source).toBe("extracted");
    expect(result.url).toBe("https://example.com/article");
  });
});

// ===========================================================================
// scrape — per-article private-target trust (stage-16 S10)
// ===========================================================================

describe("scrape — per-article private-target trust", () => {
  it("blocked target (private resolver answer) → fallback with error 'blocked'", async () => {
    const spy = vi
      .spyOn(fetchDispatch, "fetch")
      .mockResolvedValue(asResponse(okResponse(ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "https://intranet.example/article",
      "fallback content",
      { resolver: PRIVATE_RESOLVER },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.source).toBe("fallback");
    expect(result.error).toBe("blocked");
    expect(result.content).toContain("fallback content");
  });

  it("literal private IP URL → fallback with error 'blocked'", async () => {
    const spy = vi
      .spyOn(fetchDispatch, "fetch")
      .mockResolvedValue(asResponse(okResponse(ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "http://10.0.0.7/article",
      "fallback content",
      { resolver: PUBLIC_RESOLVER },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.source).toBe("fallback");
    expect(result.error).toBe("blocked");
  });

  it("allowPrivateTarget: true → private answer proceeds to fetch and extracts", async () => {
    const spy = vi
      .spyOn(fetchDispatch, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    const result = await new ArticleScraper().scrape(
      "https://intranet.example/article",
      "fallback content",
      { resolver: PRIVATE_RESOLVER, allowPrivateTarget: true },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("extracted");
    expect(result.error).toBeUndefined();
  });

  it("scrapeArticle forwards opts (blocked without flag, allowed with flag)", async () => {
    const spy = vi
      .spyOn(fetchDispatch, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    const blocked = await scrapeArticle("https://intranet.example/a", "fb a", {
      resolver: PRIVATE_RESOLVER,
    });
    expect(blocked.source).toBe("fallback");
    expect(blocked.error).toBe("blocked");

    const allowed = await scrapeArticle("https://intranet.example/a", "fb a", {
      resolver: PRIVATE_RESOLVER,
      allowPrivateTarget: true,
    });
    expect(allowed.source).toBe("extracted");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("scrapeAll forwards per-item allowPrivateTarget", async () => {
    const spy = vi
      .spyOn(fetchDispatch, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)));

    const results = await scrapeAll(
      [
        { url: "https://intranet.example/a", fallbackContent: "fb a", allowPrivateTarget: true },
        { url: "https://intranet.example/b", fallbackContent: "fb b" },
      ],
      { resolver: PRIVATE_RESOLVER },
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ url: "https://intranet.example/a", source: "extracted" });
    expect(results[1]).toMatchObject({
      url: "https://intranet.example/b",
      source: "fallback",
      error: "blocked",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("https://intranet.example/a");
  });
});

// ===========================================================================
// scrapeAll
// ===========================================================================

describe("scrapeAll — concurrent, order-preserving, isolation", () => {
  it("returns one ScrapeResult per item in input order, isolating failures", async () => {
    vi.spyOn(fetchDispatch, "fetch")
      .mockResolvedValueOnce(asResponse(okResponse(ARTICLE_HTML)))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(asResponse(okResponse(NON_ARTICLE_HTML)));

    const results = await scrapeAll(
      [
        { url: "https://example.com/a", fallbackContent: "fb a" },
        { url: "https://example.com/b", fallbackContent: "fb b" },
        { url: "https://example.com/c", fallbackContent: "fb c" },
      ],
      { resolver: PUBLIC_RESOLVER },
    );

    expect(results).toHaveLength(3);
    const sources = results.map((r) => r.source);
    expect(sources).toEqual(["extracted", "fallback", "fallback"]);
    // Order preserved.
    expect(results[0].url).toBe("https://example.com/a");
    expect(results[1].url).toBe("https://example.com/b");
    expect(results[2].url).toBe("https://example.com/c");
    // Second item's failure set its error.
    expect(results[1].error).toBeTruthy();
  });

  it("empty input -> empty array", async () => {
    const results = await scrapeAll([]);
    expect(results).toEqual([] as ScrapeResult[]);
  });
});
