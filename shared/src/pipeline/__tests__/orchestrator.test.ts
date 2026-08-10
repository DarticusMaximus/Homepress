import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { runPipeline } from "../orchestrator";
import type { PipelineOptions } from "../orchestrator";
import type {
  Article,
  TaggedArticle,
  ScoredArticle,
  SelectedArticle,
  FetchResult,
  ScrapeResult,
  TagResult,
  ScoreResult,
  SelectionResult,
  DraftResult,
  FeedFailure,
} from "../types";
import { createArticle, createNewsletterConfig, type NewsletterConfig } from "../types";

// ---------------------------------------------------------------------------
// Fixtures & mock factories
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<NewsletterConfig> = {}): NewsletterConfig {
  return createNewsletterConfig({
    name: "Tech Trench",
    topics: ["AI", "Cloud"],
    dislikedTopics: ["Crypto"],
    feeds: ["https://a.example/feed", "https://b.example/feed"],
    newsItems: 8,
    dateRange: "yesterday",
    ...overrides,
  });
}

function makeArticle(i: number, overrides: Partial<Article> = {}): Article {
  return createArticle({
    title: `Article ${i}`,
    link: `https://example.com/${i}`,
    published: new Date("2025-01-01T00:00:00Z"),
    content: `feed content ${i}`,
    source: "feed",
    ...overrides,
  });
}

function makeTagged(article: Article, tags: string[] = ["AI"]): TaggedArticle {
  return { ...article, tags };
}

function makeScored(article: TaggedArticle, score = 8, embedding: number[] = []): ScoredArticle {
  return { ...article, score, ...(embedding.length ? { embedding } : {}) };
}

function makeSelected(article: ScoredArticle): SelectedArticle {
  return { ...article };
}

function emptyDraft(): DraftResult {
  return {
    markdown: "",
    articleCount: 0,
    empty: true,
    reason: "no-articles",
    attempts: 0,
  };
}

function okDraft(markdown = "# Newsletter"): DraftResult {
  return {
    markdown,
    articleCount: 2,
    empty: false,
    reason: null,
    attempts: 1,
    raw: { mocked: true },
  };
}

/** Build a full happy-path set of mock phases, each overridable. */
function makeHappyMocks(
  overrides: {
    fetch?: Partial<FetchResult>;
    scrape?: ScrapeResult[];
    tag?: Partial<TagResult>;
    score?: Partial<ScoreResult>;
    selection?: Partial<SelectionResult>;
    draft?: DraftResult;
  } = {},
): {
  options: PipelineOptions;
  mocks: {
    fetcher: ReturnType<typeof vi.fn>;
    scraper: ReturnType<typeof vi.fn>;
    tagger: ReturnType<typeof vi.fn>;
    scorer: ReturnType<typeof vi.fn>;
    selector: ReturnType<typeof vi.fn>;
    drafter: { draft: ReturnType<typeof vi.fn> };
  };
} {
  const articles = [makeArticle(1), makeArticle(2), makeArticle(3)];

  const fetchResult: FetchResult = {
    articles,
    failedFeeds: [],
    totalFeeds: 2,
    ...overrides.fetch,
  };
  const fetcher = vi.fn(async () => fetchResult);

  const scrapeResults: ScrapeResult[] =
    overrides.scrape ??
    articles.map((a, i) => ({
      url: a.link,
      content: `scraped content ${i + 1}`,
      source: i === 2 ? ("fallback" as const) : ("extracted" as const),
    }));
  const scraper = vi.fn(async () => scrapeResults);

  const tagged = articles.map((a) => makeTagged(a));
  const tagResult: TagResult = {
    taggedArticles: tagged,
    failures: [],
    halted: false,
    haltReason: null,
    consecutiveErrors: 0,
    totalArticles: 3,
    ...overrides.tag,
  };
  const tagger = vi.fn(async () => tagResult);

  const scored = tagged.map((t) => makeScored(t));
  const scoreResult: ScoreResult = {
    scoredArticles: scored,
    failures: [],
    halted: false,
    haltReason: null,
    consecutiveErrors: 0,
    totalArticles: 3,
    ...overrides.score,
  };
  const scorer = vi.fn(async () => scoreResult);

  const selected = scored.slice(0, 2).map(makeSelected);
  const selectionResult: SelectionResult = {
    selectedArticles: selected,
    failures: [
      {
        articleTitle: scored[2].title,
        articleLink: scored[2].link,
        reason: "not-selected",
        error: "not selected by MMR (target=8, candidates=3)",
      },
    ],
    totalArticles: 3,
    candidateCount: 3,
    targetCount: 8,
    lambda: 0.7,
    minScore: 7,
    ...overrides.selection,
  };
  const selector = vi.fn(async () => selectionResult);

  const draftResult = overrides.draft ?? okDraft();
  const draft = vi.fn(async () => draftResult);
  const drafter = { draft };

  return {
    options: { fetcher, scraper, tagger, scorer, selector, drafter },
    mocks: { fetcher, scraper, tagger, scorer, selector, drafter },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Happy path
// ===========================================================================

describe("runPipeline — happy path", () => {
  it("status ok, markdown from drafter, correct totals and scrape summary", async () => {
    const { options } = makeHappyMocks();
    const result = await runPipeline(makeConfig(), options);

    expect(result.status).toBe("ok");
    expect(result.markdown).toBe("# Newsletter");
    expect(result.totals).toEqual({
      fetched: 3,
      scraped: 3,
      tagged: 3,
      scored: 3,
      selected: 2,
    });
    expect(result.phases.scrape).toEqual({
      total: 3,
      extracted: 2,
      fallback: 1,
    });
    expect(result.failedPhase).toBeNull();
  });
});

// ===========================================================================
// 2. Scrape-merge
// ===========================================================================

describe("runPipeline — scrape content merged into tagger input", () => {
  it("articles handed to the tagger carry scraped content, not feed content", async () => {
    const { options, mocks } = makeHappyMocks();
    await runPipeline(makeConfig(), options);

    const taggerArgs = mocks.tagger.mock.calls[0]?.[0] as Article[] | undefined;
    expect(taggerArgs).toBeTruthy();
    const first = taggerArgs![0];
    expect(first?.content).toBe("scraped content 1");
    expect(first?.content).not.toBe("feed content 1");
  });
});

// ===========================================================================
// 3. Draft count arg
// ===========================================================================

describe("runPipeline — drafter called with selected count, not newsItems", () => {
  it("drafter.draft receives count === 2 (selected count)", async () => {
    const { options, mocks } = makeHappyMocks();
    await runPipeline(makeConfig(), options);

    const draftCallArgs = mocks.drafter.draft.mock.calls[0];
    expect(draftCallArgs).toBeTruthy();
    expect(draftCallArgs![3]).toBe(2);
  });
});

// ===========================================================================
// Feature 03 Task 1 — item 8: audience call-site wiring
// ===========================================================================

describe("runPipeline — drafter receives config.audience as 5th argument", () => {
  it("passes config.audience to drafter.draft", async () => {
    const { options, mocks } = makeHappyMocks();
    const config = makeConfig({ audience: "Tech leads and operators" });
    await runPipeline(config, options);

    const draftCallArgs = mocks.drafter.draft.mock.calls[0];
    expect(draftCallArgs).toBeTruthy();
    expect(draftCallArgs![4]).toBe("Tech leads and operators");
    expect(mocks.drafter.draft).toHaveBeenCalledWith(
      expect.any(Array),
      config.name,
      config.topics,
      2,
      config.audience,
    );
  });
});

// ===========================================================================
// 4. Fetch-zero fatal
// ===========================================================================

describe("runPipeline — fetch-zero fatal", () => {
  it("no articles fetched → failedPhase 'fetch', downstream mocks not called", async () => {
    const { options, mocks } = makeHappyMocks({
      fetch: { articles: [], failedFeeds: [], totalFeeds: 2 },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.failedPhase).toBe("fetch");
    expect(result.failureReason).toBe("no-articles-fetched");
    expect(mocks.tagger).not.toHaveBeenCalled();
    expect(mocks.scorer).not.toHaveBeenCalled();
    expect(mocks.selector).not.toHaveBeenCalled();
    expect(mocks.drafter.draft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. Tag-halt fatal
// ===========================================================================

describe("runPipeline — tag-halt fatal", () => {
  it("halted tagger → failedPhase 'tag'; scorer/selector/drafter not called", async () => {
    const { options, mocks } = makeHappyMocks({
      tag: {
        halted: true,
        haltReason: "3 consecutive errors",
        consecutiveErrors: 3,
        taggedArticles: [makeTagged(makeArticle(1))],
        failures: [],
        totalArticles: 3,
      },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.failedPhase).toBe("tag");
    expect(result.failureReason).toBe("tag-phase-halted");
    expect(mocks.scorer).not.toHaveBeenCalled();
    expect(mocks.selector).not.toHaveBeenCalled();
    expect(mocks.drafter.draft).not.toHaveBeenCalled();
    expect(result.phases.tag.halted).toBe(true);
  });
});

// ===========================================================================
// 6. Score-halt fatal
// ===========================================================================

describe("runPipeline — score-halt fatal", () => {
  it("halted scorer → failedPhase 'score'; selector/drafter not called", async () => {
    const { options, mocks } = makeHappyMocks({
      score: {
        halted: true,
        haltReason: "3 consecutive errors",
        consecutiveErrors: 3,
        scoredArticles: [],
        failures: [],
        totalArticles: 3,
      },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.failedPhase).toBe("score");
    expect(result.failureReason).toBe("score-phase-halted");
    expect(mocks.selector).not.toHaveBeenCalled();
    expect(mocks.drafter.draft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. Selection-empty fatal
// ===========================================================================

describe("runPipeline — selection-empty fatal", () => {
  it("no selected articles → failedPhase 'selection'; drafter not called", async () => {
    const { options, mocks } = makeHappyMocks({
      selection: {
        selectedArticles: [],
        failures: [
          {
            articleTitle: "a1",
            articleLink: "u1",
            reason: "below-threshold",
          },
          {
            articleTitle: "a2",
            articleLink: "u2",
            reason: "below-threshold",
          },
          {
            articleTitle: "a3",
            articleLink: "u3",
            reason: "below-threshold",
          },
        ],
        totalArticles: 3,
        candidateCount: 0,
        targetCount: 8,
        lambda: 0.7,
        minScore: 7,
      },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.failedPhase).toBe("selection");
    expect(result.failureReason).toBe("no-articles-after-selection");
    expect(mocks.drafter.draft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7b. Selection accounting invariant (feature 08, C7)
// ===========================================================================

describe("runPipeline — selection accounting invariant", () => {
  it("totals.selected + phases.selection.failures.length === totals.scored when target < candidateCount", async () => {
    // 3 scored articles, target (newsItems) 2 → candidateCount 3, selected 2,
    // 1 not-selected. Every scored article must be accounted for.
    const { options } = makeHappyMocks({
      selection: {
        selectedArticles: [
          makeSelected(makeScored(makeTagged(makeArticle(1)))),
          makeSelected(makeScored(makeTagged(makeArticle(2)))),
        ],
        failures: [
          {
            articleTitle: "a3",
            articleLink: "u3",
            reason: "not-selected",
            error: "not selected by MMR (target=2, candidates=3)",
          },
        ],
        totalArticles: 3,
        candidateCount: 3,
        targetCount: 2,
        lambda: 0.7,
        minScore: 7,
      },
    });
    const result = await runPipeline(makeConfig({ newsItems: 2 }), options);

    expect(result.totals.scored).toBe(3);
    expect(result.totals.selected).toBe(2);
    expect(result.phases.selection.failures).toHaveLength(1);
    expect(result.phases.selection.failures.every((f) => f.reason === "not-selected")).toBe(true);
    expect(result.totals.selected + result.phases.selection.failures.length).toBe(
      result.totals.scored,
    );
  });
});

// ===========================================================================
// 8. Draft-empty fatal
// ===========================================================================

describe("runPipeline — draft-empty fatal", () => {
  it("empty draft → failedPhase 'draft', reason 'empty-after-retry', markdown ''", async () => {
    const { options } = makeHappyMocks({
      draft: {
        markdown: "",
        articleCount: 2,
        empty: true,
        reason: "empty-after-retry",
        attempts: 2,
      },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.failedPhase).toBe("draft");
    expect(result.failureReason).toBe("empty-after-retry");
    expect(result.markdown).toBe("");
  });
});

// ===========================================================================
// 9. Per-feed failures NOT fatal
// ===========================================================================

describe("runPipeline — per-feed failures are not fatal", () => {
  it("failedFeeds present with articles → status ok; fetch.failedFeeds retained", async () => {
    const failedFeeds: FeedFailure[] = [
      {
        feedUrl: "x",
        errorType: "HttpError",
        errorMessage: "404",
        statusCode: 404,
      },
    ];
    const { options } = makeHappyMocks({
      fetch: {
        articles: [makeArticle(1), makeArticle(2)],
        failedFeeds,
        totalFeeds: 2,
      },
      selection: {
        selectedArticles: [makeSelected(makeScored(makeTagged(makeArticle(1))))],
        failures: [
          {
            articleTitle: "a2",
            articleLink: "u2",
            reason: "not-selected",
            error: "not selected by MMR (target=8, candidates=2)",
          },
        ],
        totalArticles: 2,
        candidateCount: 2,
        targetCount: 8,
        lambda: 0.7,
        minScore: 7,
      },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.status).toBe("ok");
    expect(result.phases.fetch.failedFeeds).toHaveLength(1);
  });
});

// ===========================================================================
// 10. Shape stability on a tag-halt
// ===========================================================================

describe("runPipeline — shape stability on tag-halt", () => {
  it("every phases.* key exists; phases.draft is the no-articles sentinel", async () => {
    const { options } = makeHappyMocks({
      tag: {
        halted: true,
        haltReason: "3 consecutive errors",
        consecutiveErrors: 3,
        taggedArticles: [],
        failures: [],
        totalArticles: 3,
      },
    });
    const result = await runPipeline(makeConfig(), options);

    expect(result.phases).toHaveProperty("fetch");
    expect(result.phases).toHaveProperty("scrape");
    expect(result.phases).toHaveProperty("tag");
    expect(result.phases).toHaveProperty("score");
    expect(result.phases).toHaveProperty("selection");
    expect(result.phases).toHaveProperty("draft");
    expect(result.phases.draft).toEqual(emptyDraft());
  });
});

// ===========================================================================
// 11. No inter-phase delay
// ===========================================================================

describe("runPipeline — no inter-phase delay", () => {
  it("does not schedule any setTimeout during a happy-path run", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { options } = makeHappyMocks();
    await runPipeline(makeConfig(), options);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 12. PipelineResult.newsletter echo
// ===========================================================================

describe("runPipeline — newsletter config echo", () => {
  it("result.newsletter deep-equals {name, newsItems, dateRange}", async () => {
    const config = makeConfig();
    const { options } = makeHappyMocks();
    const result = await runPipeline(config, options);

    expect(result.newsletter).toEqual({
      name: config.name,
      newsItems: config.newsItems,
      dateRange: config.dateRange,
    });
  });
});
