import type {
  NewsletterConfig,
  PipelineResult,
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
} from "./types";
import type { DateRange } from "./config";

import { fetchFeeds } from "./rss-fetcher";
import { scrapeAll } from "./scraper";
import { tagArticles } from "./tagger";
import { scoreArticles } from "./scorer";
import { selectDiverse } from "./mmr-selection";
import { NewsletterDrafter } from "./drafter";

/**
 * Injectable phase options for {@link runPipeline}. Each phase defaults to the
 * real implementation; tests inject mocks. The orchestrator calls the phases
 * with their natural args only — no `client`/options bags are forwarded (the
 * phases own their own LLM wiring).
 */
export interface PipelineOptions {
  fetcher?: (feeds: string[], options?: { dateRange?: DateRange }) => Promise<FetchResult>;
  scraper?: (
    items: {
      url: string;
      fallbackContent: string;
    }[],
  ) => Promise<ScrapeResult[]>;
  tagger?: (articles: Article[]) => Promise<TagResult>;
  scorer?: (
    articles: TaggedArticle[],
    topics: string[],
    dislikedTopics: string[],
  ) => Promise<ScoreResult>;
  selector?: (articles: ScoredArticle[], target: number) => Promise<SelectionResult>;
  drafter?: {
    draft: (
      articles: SelectedArticle[],
      newsletterName: string,
      topics: string[],
      count: number,
    ) => Promise<DraftResult>;
  };
}

// ---------------------------------------------------------------------------
// Shape-stable sentinels for phases that never ran. Keep `PipelineResult`
// field-complete on every code path so stage-03 run records are uniform.
// ---------------------------------------------------------------------------

const EMPTY_DRAFT: DraftResult = {
  markdown: "",
  articleCount: 0,
  empty: true,
  reason: "no-articles",
  attempts: 0,
};

const EMPTY_SCRAPE = { total: 0, extracted: 0, fallback: 0 };

function emptyTagResult(): TagResult {
  return {
    taggedArticles: [],
    failures: [],
    halted: false,
    haltReason: null,
    consecutiveErrors: 0,
    totalArticles: 0,
  };
}

function emptyScoreResult(): ScoreResult {
  return {
    scoredArticles: [],
    failures: [],
    halted: false,
    haltReason: null,
    consecutiveErrors: 0,
    totalArticles: 0,
  };
}

function emptySelectionResult(): SelectionResult {
  return {
    selectedArticles: [],
    failures: [],
    totalArticles: 0,
    candidateCount: 0,
    targetCount: 0,
    lambda: 0,
    minScore: 0,
  };
}

/**
 * Run the newsletter pipeline end-to-end. Phases run sequentially in
 * dependency order (fetch → scrape → tag → score → selection → draft). Each
 * fatal condition (fetch-zero, tag-halt, score-halt, selection-empty,
 * draft-empty) maps to a `failedPhase` + `failureReason` and a shape-stable
 * `PipelineResult` is returned (never thrown for phase failures). Unexpected
 * thrown exceptions propagate. No inter-phase delay.
 */
export async function runPipeline(
  config: NewsletterConfig,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const {
    fetcher = fetchFeeds,
    scraper = scrapeAll,
    tagger = tagArticles,
    scorer = scoreArticles,
    selector = selectDiverse,
    drafter = new NewsletterDrafter(),
  } = options ?? {};

  const newsletter = {
    name: config.name,
    newsItems: config.newsItems,
    dateRange: config.dateRange,
  };

  // ----- 1. Fetch -----
  const fetchResult = await fetcher(config.feeds, {
    dateRange: config.dateRange,
  });

  if (fetchResult.articles.length === 0) {
    return {
      status: "failed",
      markdown: "",
      failedPhase: "fetch",
      failureReason: "no-articles-fetched",
      newsletter,
      phases: {
        fetch: fetchResult,
        scrape: EMPTY_SCRAPE,
        tag: emptyTagResult(),
        score: emptyScoreResult(),
        selection: emptySelectionResult(),
        draft: EMPTY_DRAFT,
      },
      totals: {
        fetched: 0,
        scraped: 0,
        tagged: 0,
        scored: 0,
        selected: 0,
      },
    };
  }

  // ----- 2. Scrape (merge content) -----
  const scrapeResults = await scraper(
    fetchResult.articles.map((a) => ({
      url: a.link,
      fallbackContent: a.content,
    })),
  );
  const scrapedArticles: Article[] = fetchResult.articles.map((a, i) => ({
    ...a,
    content: scrapeResults[i].content,
  }));
  const scrapeSummary = {
    total: scrapeResults.length,
    extracted: scrapeResults.filter((s) => s.source === "extracted").length,
    fallback: scrapeResults.filter((s) => s.source === "fallback").length,
  };

  // ----- 3. Tag -----
  const tagResult = await tagger(scrapedArticles);

  if (tagResult.halted) {
    return {
      status: "failed",
      markdown: "",
      failedPhase: "tag",
      failureReason: "tag-phase-halted",
      newsletter,
      phases: {
        fetch: fetchResult,
        scrape: scrapeSummary,
        tag: tagResult,
        score: emptyScoreResult(),
        selection: emptySelectionResult(),
        draft: EMPTY_DRAFT,
      },
      totals: {
        fetched: fetchResult.articles.length,
        scraped: scrapedArticles.length,
        tagged: tagResult.taggedArticles.length,
        scored: 0,
        selected: 0,
      },
    };
  }

  // ----- 4. Score -----
  const scoreResult = await scorer(tagResult.taggedArticles, config.topics, config.dislikedTopics);

  if (scoreResult.halted) {
    return {
      status: "failed",
      markdown: "",
      failedPhase: "score",
      failureReason: "score-phase-halted",
      newsletter,
      phases: {
        fetch: fetchResult,
        scrape: scrapeSummary,
        tag: tagResult,
        score: scoreResult,
        selection: emptySelectionResult(),
        draft: EMPTY_DRAFT,
      },
      totals: {
        fetched: fetchResult.articles.length,
        scraped: scrapedArticles.length,
        tagged: tagResult.taggedArticles.length,
        scored: scoreResult.scoredArticles.length,
        selected: 0,
      },
    };
  }

  // ----- 5. Selection (MMR) -----
  const selectionResult = await selector(scoreResult.scoredArticles, config.newsItems);

  // Defensive invariant check (feature 08, C7): every scored article must now
  // be accounted for — `selectedArticles.length + failures.length` must equal
  // `totalArticles` (the count handed to the selector). With the
  // `not-selected` failure category this should always hold; the warning is a
  // safety net that surfaces a selector implementation bug loudly rather than
  // silently dropping articles from the stage-03 run records.
  if (
    selectionResult.selectedArticles.length + selectionResult.failures.length !==
    selectionResult.totalArticles
  ) {
    console.warn(
      `[pipeline] selection invariant violation: selectedArticles(${selectionResult.selectedArticles.length}) + failures(${selectionResult.failures.length}) !== totalArticles(${selectionResult.totalArticles})`,
    );
  }

  if (selectionResult.selectedArticles.length === 0) {
    return {
      status: "failed",
      markdown: "",
      failedPhase: "selection",
      failureReason: "no-articles-after-selection",
      newsletter,
      phases: {
        fetch: fetchResult,
        scrape: scrapeSummary,
        tag: tagResult,
        score: scoreResult,
        selection: selectionResult,
        draft: EMPTY_DRAFT,
      },
      totals: {
        fetched: fetchResult.articles.length,
        scraped: scrapedArticles.length,
        tagged: tagResult.taggedArticles.length,
        scored: scoreResult.scoredArticles.length,
        selected: 0,
      },
    };
  }

  // ----- 6. Draft (count = selectedArticles.length) -----
  const draftResult = await drafter.draft(
    selectionResult.selectedArticles,
    config.name,
    config.topics,
    selectionResult.selectedArticles.length,
    config.audience,
  );

  if (draftResult.empty) {
    return {
      status: "failed",
      markdown: "",
      failedPhase: "draft",
      failureReason: draftResult.reason ?? "empty-draft",
      newsletter,
      phases: {
        fetch: fetchResult,
        scrape: scrapeSummary,
        tag: tagResult,
        score: scoreResult,
        selection: selectionResult,
        draft: draftResult,
      },
      totals: {
        fetched: fetchResult.articles.length,
        scraped: scrapedArticles.length,
        tagged: tagResult.taggedArticles.length,
        scored: scoreResult.scoredArticles.length,
        selected: selectionResult.selectedArticles.length,
      },
    };
  }

  // ----- 7. Success -----
  return {
    status: "ok",
    markdown: draftResult.markdown,
    failedPhase: null,
    failureReason: null,
    newsletter,
    phases: {
      fetch: fetchResult,
      scrape: scrapeSummary,
      tag: tagResult,
      score: scoreResult,
      selection: selectionResult,
      draft: draftResult,
    },
    totals: {
      fetched: fetchResult.articles.length,
      scraped: scrapedArticles.length,
      tagged: tagResult.taggedArticles.length,
      scored: scoreResult.scoredArticles.length,
      selected: selectionResult.selectedArticles.length,
    },
  };
}
