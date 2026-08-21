import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  markRunning: vi.fn(),
  markFailed: vi.fn(),
  markCompleted: vi.fn(),
  restoreCompleted: vi.fn(),
  savePhaseCheckpoint: vi.fn(),
  loadPhaseCheckpoint: vi.fn(),
  buildPipelineConfigForNewsletter: vi.fn(),
  applyFeedFetchOutcomes: vi.fn(),
  loadLookbackTopics: vi.fn(),
  saveSuppressSummary: vi.fn(),
  listPromptTemplates: vi.fn(),
  getOrCreateAppSettings: vi.fn(),
  resolveOperatorSettings: vi.fn(),
  LLMClientCtor: vi.fn(),
  tagArticles: vi.fn(),
  scoreArticles: vi.fn(),
  selectDiverse: vi.fn(),
  suppressCrossRunTopics: vi.fn(),
  NewsletterDrafterCtor: vi.fn(),
  drafterDraft: vi.fn(),
  chatCompletion: vi.fn(),
  buildIssueMetadataFromMarkdown: vi.fn(),
  actualBuildIssueMetadataFromMarkdown: undefined as
    | ((markdown: string) => { issueTitle: string; issueDek: string })
    | undefined,
}));

vi.mock("../repository", () => ({
  getRun: mocks.getRun,
  markRunning: mocks.markRunning,
  markFailed: mocks.markFailed,
  markCompleted: mocks.markCompleted,
  restoreCompleted: mocks.restoreCompleted,
  savePhaseCheckpoint: mocks.savePhaseCheckpoint,
  loadPhaseCheckpoint: mocks.loadPhaseCheckpoint,
  saveSuppressSummary: mocks.saveSuppressSummary,
}));

vi.mock("../lookback-topics", () => ({
  loadLookbackTopics: mocks.loadLookbackTopics,
}));

vi.mock("../start", () => ({
  buildPipelineConfigForNewsletter: mocks.buildPipelineConfigForNewsletter,
}));

vi.mock("../../feeds/health", () => ({
  applyFeedFetchOutcomes: mocks.applyFeedFetchOutcomes,
}));

vi.mock("../../prompts/repository", () => ({
  listPromptTemplates: mocks.listPromptTemplates,
}));

vi.mock("../../settings/repository", () => ({
  getOrCreateAppSettings: mocks.getOrCreateAppSettings,
}));

vi.mock("../../settings/resolve-operator-settings", () => ({
  resolveOperatorSettings: mocks.resolveOperatorSettings,
}));

vi.mock("../../pipeline/llm-client", async (importActual) => {
  const actual = await importActual<typeof import("../../pipeline/llm-client")>();
  return {
    ...actual,
    LLMClient: class MockLLMClient {
      constructor(opts?: unknown) {
        mocks.LLMClientCtor(opts);
      }
      async chatCompletion(opts: unknown) {
        mocks.chatCompletion(opts);
        const n = mocks.chatCompletion.mock.calls.length;
        if (n === 1) {
          return { content: "Canary Title", raw: {} };
        }
        return { content: "Canary dek here.", raw: {} };
      }
    },
  };
});

vi.mock("../../pipeline/tagger", () => ({
  tagArticles: (...args: unknown[]) => mocks.tagArticles(...args),
}));

vi.mock("../../pipeline/scorer", () => ({
  scoreArticles: (...args: unknown[]) => mocks.scoreArticles(...args),
}));

vi.mock("../../pipeline/mmr-selection", () => ({
  selectDiverse: (...args: unknown[]) => mocks.selectDiverse(...args),
}));

vi.mock("../../pipeline/cross-run-suppress", () => ({
  suppressCrossRunTopics: (...args: unknown[]) => mocks.suppressCrossRunTopics(...args),
}));

vi.mock("../../pipeline/drafter", async (importActual) => {
  const actual = await importActual<typeof import("../../pipeline/drafter")>();
  return {
    ...actual,
    NewsletterDrafter: class NewsletterDrafter {
      draft: typeof mocks.drafterDraft;
      constructor(opts?: unknown) {
        mocks.NewsletterDrafterCtor(opts);
        this.draft = mocks.drafterDraft;
      }
    },
  };
});

vi.mock("../issues", async (importActual) => {
  const actual = await importActual<typeof import("../issues")>();
  mocks.actualBuildIssueMetadataFromMarkdown = actual.buildIssueMetadataFromMarkdown;
  mocks.buildIssueMetadataFromMarkdown.mockImplementation(actual.buildIssueMetadataFromMarkdown);
  return {
    ...actual,
    buildIssueMetadataFromMarkdown: (markdown: string) =>
      mocks.buildIssueMetadataFromMarkdown(markdown),
  };
});

import { executeRun } from "../execute-run";
import type { ExecuteRunOptions } from "../execute-run";
import { createNewsletterConfig } from "../../pipeline/types";
import { resumeStartPhase } from "../phases";
import {
  buildEmptySelectionFailureMessage,
  buildFullSuppressFailureMessage,
  buildHaltFailureMessage,
  buildPhaseFailureSummary,
  FAILURE_MESSAGE_SAMPLE_MAX,
} from "../phase-failure-summary";
import { RunRepositoryError } from "../types";
import type { Article, TaggedArticle, ScoredArticle, SelectedArticle } from "../../pipeline/types";
import type { Run } from "../types";
import type { LookbackTopic } from "../lookback-topics";
import type { Client } from "node-appwrite";
import type { ResolvedOperatorSettings } from "../../settings/resolve-operator-settings";
import {
  DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
  DEFAULT_MODELS,
  DEFAULT_SCORE_THRESHOLD,
} from "../../pipeline/config";
import { TITLE_DEK_MAX_COMPLETION_TOKENS } from "../../pipeline/issue-metadata";
import {
  DRAFTER_MAX_COMPLETION_TOKENS,
  DRAFTER_REASONING_EFFORT,
} from "../../pipeline/drafter";
import { ISSUE_DEK_ATTR_SIZE, RSS_FEED_MAX_ITEMS } from "../../schema/declarations";

const client = {} as Client;

/** Distinctive GUI key — must never appear in logs or failure messages. */
const GUI_OPENROUTER_KEY = "sk-gui-openrouter-secret-do-not-log";

function defaultOperatorSnapshot(
  overrides: Partial<ResolvedOperatorSettings> = {},
): ResolvedOperatorSettings {
  return {
    openRouterApiKey: { value: "sk-test-openrouter-default", source: "env" },
    smtp: { value: null, source: "none" },
    appPublicUrl: { value: null, source: "none" },
    scoreThreshold: { value: DEFAULT_SCORE_THRESHOLD, source: "default" },
    crossRunSimilarityThreshold: {
      value: DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
      source: "default",
    },
    rssFeedMaxItems: { value: RSS_FEED_MAX_ITEMS, source: "default" },
    drafterReasoningEffort: { value: DRAFTER_REASONING_EFFORT, source: "default" },
    drafterMaxCompletionTokens: {
      value: DRAFTER_MAX_COMPLETION_TOKENS,
      source: "default",
    },
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Test Newsletter",
    status: "pending",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "",
    failedPhase: "",
    failureMessage: "",
    startedAt: "2024-01-01T10:00:00.000Z",
    endedAt: null,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    ...overrides,
  };
}

const PUBLISHED = new Date("2024-01-15T10:00:00.000Z");

function makeArticle(i: number): Article {
  return {
    title: `Article ${i}`,
    link: `https://example.com/article-${i}`,
    published: PUBLISHED,
    content: `Content for article ${i}`,
    source: "feed-1",
  };
}

const ARTICLES = [makeArticle(1), makeArticle(2), makeArticle(3)];

const TAGGED_ARTICLES: TaggedArticle[] = ARTICLES.map((a, i) => ({
  ...a,
  tags: [`tag-${i + 1}`],
}));

const SCORED_ARTICLES: ScoredArticle[] = TAGGED_ARTICLES.map((a, i) => ({
  ...a,
  score: 0.9 - i * 0.1,
  embedding: [0.1 * (i + 1), 0.2 * (i + 1)],
}));

const SELECTED_ARTICLES: SelectedArticle[] = SCORED_ARTICLES.slice(0, 2);

function makeConfig() {
  return createNewsletterConfig({
    name: "Test Newsletter",
    topics: ["AI", "Climate"],
    dislikedTopics: ["Crypto"],
    newsItems: 5,
    feeds: ["https://feed-a.example/rss", "https://feed-b.example/rss"],
    dateRange: "last_3_days",
  });
}

function okBuildResult() {
  return {
    ok: true as const,
    newsletter: {
      $id: "nl-1",
      name: "Test Newsletter",
      topics: ["AI", "Climate"],
      dislikedTopics: ["Crypto"],
      audience: "Engineers",
      newsItems: 5,
      dateRange: "last_3_days" as const,
      lookback: 3,
      taggerModel: "nl/tagger-model",
      scorerModel: "nl/scorer-model",
      drafterModel: "nl/drafter-model",
      embedderModel: "nl/embedder-model",
      titleDekModel: "",
      drafterPrompt: "",
      scheduleEnabled: false,
      scheduleCron: "",
      scheduleTimezone: "UTC",
      scheduleLastFiredAt: null,
      recipientEmails: [],
      autoEmail: false,
      autoRss: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    feedUrls: ["https://feed-a.example/rss", "https://feed-b.example/rss"],
    config: makeConfig(),
  };
}

const TITLE_PROMPT_CANARY = "TITLE_PROMPT_CANARY";
const DEK_PROMPT_CANARY = "DEK_PROMPT_CANARY";
const DEFAULT_TITLE_PROMPT_BODY = `${TITLE_PROMPT_CANARY} Write a title. {draft} {newsletter_name}`;
const DEFAULT_DEK_PROMPT_BODY = `${DEK_PROMPT_CANARY} Write a dek. {draft} {newsletter_name}`;

function stubIssueMetadataGenerators(): Pick<
  ExecuteRunOptions,
  "generateIssueTitle" | "generateIssueDek"
> {
  return {
    generateIssueTitle: vi.fn().mockResolvedValue(null),
    generateIssueDek: vi.fn().mockResolvedValue(null),
  };
}

function defaultPromptTemplates() {
  return [
    {
      role: "tagger" as const,
      body: "TAGGER prompt body {title} {truncated_content}",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      role: "scorer" as const,
      body: "SCORER prompt body {topics} {title}",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      role: "drafter" as const,
      body: "DRAFTER prompt body {newsletter_name} {articles_json}",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      role: "title" as const,
      body: DEFAULT_TITLE_PROMPT_BODY,
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      role: "dek" as const,
      body: DEFAULT_DEK_PROMPT_BODY,
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];
}

function defaultAppSettings() {
  return {
    runRetentionDays: 30,
    updatedAt: "2024-01-01T00:00:00.000Z",
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    titleDekModel: "",
    drafterPrompt: "",
  };
}

function defaultPhaseMocks() {
  mocks.tagArticles.mockResolvedValue({
    taggedArticles: TAGGED_ARTICLES,
    failures: [],
    halted: false,
    haltReason: null,
    consecutiveErrors: 0,
    totalArticles: 3,
  });
  mocks.scoreArticles.mockResolvedValue({
    scoredArticles: SCORED_ARTICLES,
    failures: [],
    halted: false,
    haltReason: null,
    consecutiveErrors: 0,
    totalArticles: 3,
  });
  mocks.selectDiverse.mockResolvedValue({
    selectedArticles: SELECTED_ARTICLES,
    failures: [],
    totalArticles: 3,
    candidateCount: 3,
    targetCount: 5,
    lambda: 0.5,
    minScore: 0.1,
  });
  mocks.suppressCrossRunTopics.mockImplementation(async (candidates: ScoredArticle[]) => ({
    remaining: candidates,
    summary: { count: 0, items: [] },
  }));
  mocks.drafterDraft.mockResolvedValue({
    markdown: "# Test Newsletter\n\nArticle content here.",
    articleCount: 2,
    empty: false,
    reason: null,
    attempts: 1,
  });
}

function noopAutoDeliver() {
  return vi.fn().mockResolvedValue({
    email: { attempted: false, ok: false },
    rss: { attempted: false, ok: false },
  });
}

function happyPathOptions(): ExecuteRunOptions {
  return {
    fetcher: vi.fn().mockResolvedValue({
      articles: ARTICLES,
      failedFeeds: [
        {
          feedUrl: "https://bad.example/rss",
          errorType: "HttpError" as const,
          errorMessage: "503 Service Unavailable",
          statusCode: 503,
        },
      ],
      totalFeeds: 3,
    }),
    scraper: vi.fn().mockResolvedValue(
      ARTICLES.map((a) => ({
        url: a.link,
        content: a.content + " [scraped]",
        source: "extracted" as const,
      })),
    ),
    tagger: vi.fn().mockResolvedValue({
      taggedArticles: TAGGED_ARTICLES,
      failures: [],
      halted: false,
      haltReason: null,
      consecutiveErrors: 0,
      totalArticles: 3,
    }),
    scorer: vi.fn().mockResolvedValue({
      scoredArticles: SCORED_ARTICLES,
      failures: [],
      halted: false,
      haltReason: null,
      consecutiveErrors: 0,
      totalArticles: 3,
    }),
    selector: vi.fn().mockResolvedValue({
      selectedArticles: SELECTED_ARTICLES,
      failures: [
        {
          articleTitle: "Article 3",
          articleLink: "https://example.com/article-3",
          reason: "not-selected" as const,
        },
      ],
      totalArticles: 3,
      candidateCount: 3,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.1,
    }),
    drafter: {
      draft: vi.fn().mockResolvedValue({
        markdown: "# Test Newsletter\n\nArticle content here.",
        articleCount: 2,
        empty: false,
        reason: null,
        attempts: 1,
      }),
    },
    // Keep existing success-path tests from hitting real Appwrite delivery deps.
    autoDeliver: noopAutoDeliver(),
    // Feature 02: overlay tests 11–15 and Feature 01 extract tests stay hermetic.
    ...stubIssueMetadataGenerators(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildIssueMetadataFromMarkdown.mockImplementation((markdown: string) =>
    mocks.actualBuildIssueMetadataFromMarkdown!(markdown),
  );
  mocks.getRun.mockResolvedValue(makeRun());
  mocks.markRunning.mockResolvedValue(makeRun({ status: "running" }));
  mocks.markFailed.mockResolvedValue(makeRun({ status: "failed" }));
  mocks.markCompleted.mockResolvedValue(makeRun({ status: "completed" }));
  mocks.restoreCompleted.mockResolvedValue(makeRun({ status: "completed" }));
  mocks.savePhaseCheckpoint.mockResolvedValue(makeRun({ status: "running" }));
  mocks.loadPhaseCheckpoint.mockImplementation(() => {
    throw new Error("loadPhaseCheckpoint should not be called on a fresh run");
  });
  mocks.buildPipelineConfigForNewsletter.mockResolvedValue(okBuildResult());
  mocks.applyFeedFetchOutcomes.mockResolvedValue(undefined);
  mocks.loadLookbackTopics.mockResolvedValue({
    lookback: 3,
    issues: [],
    topics: [],
  });
  mocks.saveSuppressSummary.mockResolvedValue(undefined);
  mocks.listPromptTemplates.mockResolvedValue(defaultPromptTemplates());
  mocks.getOrCreateAppSettings.mockResolvedValue(defaultAppSettings());
  mocks.resolveOperatorSettings.mockResolvedValue(defaultOperatorSnapshot());
  defaultPhaseMocks();
});

describe("executeRun — happy path", () => {
  it("drives a pending run to completion with markRunning + checkpoint per phase", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const phasesCalled = mocks.markRunning.mock.calls.map((c) => c[2]);
    expect(phasesCalled).toEqual(["fetch", "scrape", "tag", "score", "selection", "draft"]);

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(6);

    const checkpointCalls = mocks.savePhaseCheckpoint.mock.calls;
    expect(checkpointCalls[0][2]).toBe("fetch");
    expect(checkpointCalls[1][2]).toBe("scrape");
    expect(checkpointCalls[2][2]).toBe("tag");
    expect(checkpointCalls[3][2]).toBe("score");
    expect(checkpointCalls[4][2]).toBe("selection");
    expect(checkpointCalls[5][2]).toBe("draft");

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    const completedCall = mocks.markCompleted.mock.calls[0];
    expect(completedCall[1]).toBe("run-1");
    expect(completedCall[2].topicSummary).toHaveLength(2);
    expect(completedCall[2].topicSummary[0]).toEqual({
      title: "Article 1",
      tags: ["tag-1"],
    });
    expect(completedCall[2].topicSummary[1]).toEqual({
      title: "Article 2",
      tags: ["tag-2"],
    });

    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });

  it("passes correct fetch checkpoint payload with failedFeeds option", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const fetchCall = mocks.savePhaseCheckpoint.mock.calls[0];
    expect(fetchCall[2]).toBe("fetch");
    expect(fetchCall[3].articles).toHaveLength(3);
    expect(fetchCall[3].articles[0]).toEqual({
      title: "Article 1",
      link: "https://example.com/article-1",
      published: PUBLISHED.toISOString(),
      content: "Content for article 1",
      source: "feed-1",
    });
    expect(fetchCall[4]).toEqual({
      failedFeeds: [
        expect.objectContaining({
          feedUrl: "https://bad.example/rss",
          errorType: "HttpError",
        }),
      ],
    });
  });

  it("passes correct scrape checkpoint payload with summary", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const scrapeCall = mocks.savePhaseCheckpoint.mock.calls[1];
    expect(scrapeCall[2]).toBe("scrape");
    expect(scrapeCall[3].articles).toHaveLength(3);
    expect(scrapeCall[3].articles[0].content).toBe("Content for article 1 [scraped]");
    expect(scrapeCall[3].summary).toEqual({
      total: 3,
      extracted: 3,
      fallback: 0,
    });
  });

  it("passes correct tag checkpoint payload", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const tagCall = mocks.savePhaseCheckpoint.mock.calls[2];
    expect(tagCall[2]).toBe("tag");
    expect(tagCall[3].taggedArticles).toHaveLength(3);
    expect(tagCall[3].taggedArticles[0]).toEqual({
      title: "Article 1",
      link: "https://example.com/article-1",
      published: PUBLISHED.toISOString(),
      content: "Content for article 1",
      source: "feed-1",
      tags: ["tag-1"],
    });
  });

  it("strips embeddings from score checkpoint payload", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const scoreCall = mocks.savePhaseCheckpoint.mock.calls[3];
    expect(scoreCall[2]).toBe("score");
    expect(scoreCall[3].scoredArticles).toHaveLength(3);
    expect(scoreCall[3].scoredArticles[0]).toEqual({
      title: "Article 1",
      link: "https://example.com/article-1",
      published: PUBLISHED.toISOString(),
      content: "Content for article 1",
      source: "feed-1",
      tags: ["tag-1"],
      score: 0.9,
    });
    expect(scoreCall[3].scoredArticles[0]).not.toHaveProperty("embedding");
  });

  it("strips embeddings from selection checkpoint payload", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const selectionCall = mocks.savePhaseCheckpoint.mock.calls[4];
    expect(selectionCall[2]).toBe("selection");
    expect(selectionCall[3].selectedArticles).toHaveLength(2);
    expect(selectionCall[3].selectedArticles[0]).not.toHaveProperty("embedding");
    expect(selectionCall[3].selectedArticles[0].score).toBe(0.9);
    expect(selectionCall[3].failures).toEqual([
      {
        articleTitle: "Article 3",
        articleLink: "https://example.com/article-3",
        reason: "not-selected",
      },
    ]);
  });

  it("passes correct draft checkpoint payload without raw/retryError", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const draftCall = mocks.savePhaseCheckpoint.mock.calls[5];
    expect(draftCall[2]).toBe("draft");
    expect(draftCall[3]).toEqual({
      markdown: "# Test Newsletter\n\nArticle content here.",
      empty: false,
      reason: null,
      articleCount: 2,
      attempts: 1,
    });
    expect(draftCall[3]).not.toHaveProperty("raw");
    expect(draftCall[3]).not.toHaveProperty("retryError");
  });

  it("converts published Date to ISO string in all article checkpoints", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    const fetchArticles = mocks.savePhaseCheckpoint.mock.calls[0][3].articles;
    for (const a of fetchArticles) {
      expect(typeof a.published).toBe("string");
      expect(a.published).toBe(PUBLISHED.toISOString());
    }
  });
});

describe("executeRun — fatal phase outcomes", () => {
  it("marks failed at fetch when zero articles fetched; no later phases run", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      articles: [],
      failedFeeds: [
        {
          feedUrl: "https://feed-a.example/rss",
          errorType: "NetworkError",
          errorMessage: "ECONNREFUSED",
        },
      ],
      totalFeeds: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "No articles fetched",
      failedFeeds: [
        {
          feedUrl: "https://feed-a.example/rss",
          errorType: "NetworkError",
          errorMessage: "ECONNREFUSED",
        },
      ],
    });
    expect(mocks.savePhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.scraper).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Feature 08 (remediation): zero-article fatal carries failedFeeds on Run
  // ---------------------------------------------------------------------------

  it("zero-article fatal persists two failedFeeds entries on the run (Feature 08)", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      articles: [],
      failedFeeds: [
        {
          feedUrl: "https://feed-a.example/rss",
          errorType: "NetworkError",
          errorMessage: "ECONNREFUSED",
        },
        {
          feedUrl: "https://feed-b.example/rss",
          errorType: "ParseError",
          errorMessage: "Invalid XML",
        },
      ],
      totalFeeds: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    const failedCall = mocks.markFailed.mock.calls[0];
    expect(failedCall[0]).toBe(client);
    expect(failedCall[1]).toBe("run-1");
    expect(failedCall[2].failedPhase).toBe("fetch");
    expect(failedCall[2].failureMessage).toBe("No articles fetched");
    expect(Array.isArray(failedCall[2].failedFeeds)).toBe(true);
    expect(failedCall[2].failedFeeds).toHaveLength(2);
    expect(failedCall[2].failedFeeds[0]).toEqual({
      feedUrl: "https://feed-a.example/rss",
      errorType: "NetworkError",
      errorMessage: "ECONNREFUSED",
    });
    expect(failedCall[2].failedFeeds[1]).toEqual({
      feedUrl: "https://feed-b.example/rss",
      errorType: "ParseError",
      errorMessage: "Invalid XML",
    });
    // No checkpoint saved; run was fatal at fetch.
    expect(mocks.savePhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.scraper).not.toHaveBeenCalled();
  });

  it("zero-article fatal regression: empty failedFeeds still calls markFailed (Feature 08)", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      articles: [],
      failedFeeds: [],
      totalFeeds: 0,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    const failedCall = mocks.markFailed.mock.calls[0];
    expect(failedCall[2].failedPhase).toBe("fetch");
    expect(failedCall[2].failureMessage).toBe("No articles fetched");
    // Implementation passes fetchResult.failedFeeds unconditionally — an
    // empty array is still passed (not omitted). This proves no caller-side
    // short-circuit on zero failed feeds.
    expect(failedCall[2].failedFeeds).toEqual([]);
    expect(mocks.savePhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("marks failed at tag when tagging is halted; saves diagnostic tag checkpoint", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });
    const options = happyPathOptions();
    const successTagged: TaggedArticle = {
      ...ARTICLES[0]!,
      tags: ["ai"],
    };
    const emptyTagStub: TaggedArticle = {
      ...ARTICLES[1]!,
      tags: [],
    };
    const tagFailures = [
      {
        articleTitle: "Article 2",
        articleLink: "https://example.com/article-2",
        error: "provider timeout",
        attempts: 3,
      },
      {
        articleTitle: "Article 3",
        articleLink: "https://example.com/article-3",
        error: "parse failed",
        attempts: 1,
      },
    ];
    const tagResult = {
      taggedArticles: [successTagged, emptyTagStub],
      failures: tagFailures,
      halted: true,
      haltReason: "Consecutive errors exceeded threshold",
      consecutiveErrors: 5,
      totalArticles: 3,
    };
    (options.tagger as ReturnType<typeof vi.fn>).mockResolvedValue(tagResult);

    const phaseFailure = buildPhaseFailureSummary(tagResult);
    const failureMessage = buildHaltFailureMessage("tag", phaseFailure);

    await executeRun(client, "run-1", options);

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(3);
    expect(mocks.savePhaseCheckpoint.mock.calls[0][2]).toBe("fetch");
    expect(mocks.savePhaseCheckpoint.mock.calls[1][2]).toBe("scrape");
    const tagSave = mocks.savePhaseCheckpoint.mock.calls[2];
    expect(tagSave[2]).toBe("tag");
    expect(tagSave[3]).toEqual({
      taggedArticles: [
        {
          title: successTagged.title,
          link: successTagged.link,
          published: successTagged.published.toISOString(),
          content: successTagged.content,
          source: successTagged.source,
          tags: ["ai"],
        },
      ],
      phaseFailure,
    });

    const tagHaltFailure = {
      failedPhase: "tag" as const,
      failureMessage,
      completedPhase: "scrape" as const,
    };
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", tagHaltFailure);
    expect(resumeStartPhase(tagHaltFailure.completedPhase)).toBe("tag");

    const fatalLog = logSpy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is {
          action: string;
          phase: string;
          reason: string;
          haltReason: string | null;
          consecutiveErrors: number;
          failureCount: number;
          sample: unknown[];
        } => (e as { action?: string }).action === "fatal-outcome",
      );
    expect(fatalLog).toBeDefined();
    expect(fatalLog!.phase).toBe("tag");
    expect(fatalLog!.reason).toBe(failureMessage);
    expect(fatalLog!.reason).not.toBe("Tagging halted");
    expect(fatalLog!.haltReason).toBe("Consecutive errors exceeded threshold");
    expect(fatalLog!.consecutiveErrors).toBe(5);
    expect(fatalLog!.failureCount).toBe(2);
    expect(fatalLog!.sample).toEqual(phaseFailure.failures.slice(0, FAILURE_MESSAGE_SAMPLE_MAX));

    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.scorer).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("S1: fatal-outcome.haltReason does not contain raw secrets from pipeline haltReason", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });
    const skSecret = "sk-ant-api03-TESTSECRET";
    const options = happyPathOptions();
    const tagResult = {
      taggedArticles: [],
      failures: [
        {
          articleTitle: "Article 1",
          articleLink: "https://example.com/article-1",
          error: "provider timeout",
          attempts: 3,
        },
      ],
      halted: true,
      haltReason: `Consecutive errors exceeded threshold (last error: auth failed with ${skSecret})`,
      consecutiveErrors: 5,
      totalArticles: 1,
    };
    (options.tagger as ReturnType<typeof vi.fn>).mockResolvedValue(tagResult);

    await executeRun(client, "run-1", options);

    const fatalLog = logSpy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is {
          action: string;
          phase: string;
          reason: string;
          haltReason: string | null;
          consecutiveErrors: number;
          failureCount: number;
          sample: unknown[];
        } => (e as { action?: string }).action === "fatal-outcome",
      );
    expect(fatalLog).toBeDefined();
    expect(fatalLog!.phase).toBe("tag");
    expect(fatalLog!.haltReason).not.toBeNull();
    expect(fatalLog!.haltReason).not.toContain(skSecret);
    expect(fatalLog!.haltReason).not.toContain("sk-ant-api03");
    expect(fatalLog!.haltReason).toContain("[redacted]");
    expect(fatalLog!.consecutiveErrors).toBe(5);
    expect(fatalLog!.failureCount).toBe(1);
    expect(fatalLog!.reason).toContain("Consecutive errors");

    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("preserves completedPhase scrape when tag-halt markFailed rejects once then recovers", async () => {
    const options = happyPathOptions();
    const tagResult = {
      taggedArticles: [],
      failures: [
        {
          articleTitle: "Article 1",
          articleLink: "https://example.com/article-1",
          error: "boom",
          attempts: 3,
        },
      ],
      halted: true,
      haltReason: "Consecutive errors exceeded threshold",
      consecutiveErrors: 5,
      totalArticles: 3,
    };
    (options.tagger as ReturnType<typeof vi.fn>).mockResolvedValue(tagResult);

    const tagHaltFailure = {
      failedPhase: "tag" as const,
      failureMessage: buildHaltFailureMessage("tag", buildPhaseFailureSummary(tagResult)),
      completedPhase: "scrape" as const,
    };
    mocks.markFailed
      .mockRejectedValueOnce(new Error("transient status update failure"))
      .mockResolvedValue(makeRun({ status: "failed", completedPhase: "scrape" }));

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(1, client, "run-1", tagHaltFailure);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(2, client, "run-1", tagHaltFailure);
    expect(resumeStartPhase(mocks.markFailed.mock.calls[1][2].completedPhase)).toBe("tag");
    expect(options.scorer).not.toHaveBeenCalled();
  });

  it("still markFailed with enriched tag halt when checkpoint save throws", async () => {
    const options = happyPathOptions();
    const tagResult = {
      taggedArticles: [],
      failures: [
        {
          articleTitle: "Article 1",
          articleLink: "https://example.com/article-1",
          error: "boom",
          attempts: 3,
        },
      ],
      halted: true,
      haltReason: "Consecutive errors exceeded threshold",
      consecutiveErrors: 5,
      totalArticles: 3,
    };
    (options.tagger as ReturnType<typeof vi.fn>).mockResolvedValue(tagResult);

    mocks.savePhaseCheckpoint
      .mockResolvedValueOnce(makeRun()) // fetch
      .mockResolvedValueOnce(makeRun()) // scrape
      .mockRejectedValueOnce(new Error("checkpoint upload failed"));

    const tagHaltFailure = {
      failedPhase: "tag" as const,
      failureMessage: buildHaltFailureMessage("tag", buildPhaseFailureSummary(tagResult)),
      completedPhase: "scrape" as const,
    };

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", tagHaltFailure);
    expect(options.scorer).not.toHaveBeenCalled();
  });

  it("marks failed at score when scoring is halted; saves diagnostic score checkpoint", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });
    const options = happyPathOptions();
    const scoredSuccess: ScoredArticle = {
      ...TAGGED_ARTICLES[0]!,
      score: 0.9,
      embedding: [0.1, 0.2],
    };
    const scoreFailures = [
      {
        articleTitle: "Article 2",
        articleLink: "https://example.com/article-2",
        error: "score timeout",
        reason: "exception" as const,
        attempts: 3,
      },
      {
        articleTitle: "Article 3",
        articleLink: "https://example.com/article-3",
        error: "bad json",
        reason: "parse" as const,
        attempts: 1,
      },
    ];
    const scoreResult = {
      scoredArticles: [scoredSuccess],
      failures: scoreFailures,
      halted: true,
      haltReason: "Consecutive errors exceeded threshold",
      consecutiveErrors: 5,
      totalArticles: 3,
    };
    (options.scorer as ReturnType<typeof vi.fn>).mockResolvedValue(scoreResult);

    const phaseFailure = buildPhaseFailureSummary(scoreResult);
    const failureMessage = buildHaltFailureMessage("score", phaseFailure);

    await executeRun(client, "run-1", options);

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(4);
    const scoreSave = mocks.savePhaseCheckpoint.mock.calls[3];
    expect(scoreSave[2]).toBe("score");
    expect(scoreSave[3]).toEqual({
      scoredArticles: [
        {
          title: scoredSuccess.title,
          link: scoredSuccess.link,
          published: scoredSuccess.published.toISOString(),
          content: scoredSuccess.content,
          source: scoredSuccess.source,
          tags: scoredSuccess.tags,
          score: 0.9,
        },
      ],
      phaseFailure,
    });

    const scoreHaltFailure = {
      failedPhase: "score" as const,
      failureMessage,
      completedPhase: "tag" as const,
    };
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", scoreHaltFailure);
    expect(resumeStartPhase(scoreHaltFailure.completedPhase)).toBe("score");

    const fatalLog = logSpy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is {
          action: string;
          phase: string;
          reason: string;
          haltReason: string | null;
          consecutiveErrors: number;
          failureCount: number;
          sample: unknown[];
        } =>
          (e as { action?: string }).action === "fatal-outcome" &&
          (e as { phase?: string }).phase === "score",
      );
    expect(fatalLog).toBeDefined();
    expect(fatalLog!.reason).toBe(failureMessage);
    expect(fatalLog!.reason).not.toBe("Scoring halted");
    expect(fatalLog!.haltReason).toBe("Consecutive errors exceeded threshold");
    expect(fatalLog!.consecutiveErrors).toBe(5);
    expect(fatalLog!.failureCount).toBe(2);
    expect(fatalLog!.sample).toEqual(phaseFailure.failures.slice(0, FAILURE_MESSAGE_SAMPLE_MAX));

    expect(options.selector).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("preserves completedPhase tag when score-halt markFailed rejects once then recovers", async () => {
    const options = happyPathOptions();
    const scoreResult = {
      scoredArticles: [],
      failures: [
        {
          articleTitle: "Article 1",
          articleLink: "https://example.com/article-1",
          error: "boom",
          reason: "exception" as const,
          attempts: 3,
        },
      ],
      halted: true,
      haltReason: "Consecutive errors exceeded threshold",
      consecutiveErrors: 5,
      totalArticles: 3,
    };
    (options.scorer as ReturnType<typeof vi.fn>).mockResolvedValue(scoreResult);

    const scoreHaltFailure = {
      failedPhase: "score" as const,
      failureMessage: buildHaltFailureMessage("score", buildPhaseFailureSummary(scoreResult)),
      completedPhase: "tag" as const,
    };
    mocks.markFailed
      .mockRejectedValueOnce(new Error("transient status update failure"))
      .mockResolvedValue(makeRun({ status: "failed", completedPhase: "tag" }));

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(1, client, "run-1", scoreHaltFailure);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(2, client, "run-1", scoreHaltFailure);
    expect(resumeStartPhase(mocks.markFailed.mock.calls[1][2].completedPhase)).toBe("score");
    expect(options.selector).not.toHaveBeenCalled();
  });

  it("marks failed at selection when zero articles selected", async () => {
    const options = happyPathOptions();
    const emptyFailures = [
      {
        articleTitle: "Article 1",
        articleLink: "https://example.com/article-1",
        reason: "below-threshold" as const,
      },
      {
        articleTitle: "Article 2",
        articleLink: "https://example.com/article-2",
        reason: "not-selected" as const,
        error: "not selected by MMR (target=5, candidates=0)",
      },
    ];
    (options.selector as ReturnType<typeof vi.fn>).mockResolvedValue({
      selectedArticles: [],
      failures: emptyFailures,
      totalArticles: 3,
      candidateCount: 0,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.5,
    });

    const failureMessage = buildEmptySelectionFailureMessage(emptyFailures);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeRun(client, "run-1", options);

    // Empty selection still saves the selection checkpoint (with failures) before markFailed.
    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(5);
    const selectionSave = mocks.savePhaseCheckpoint.mock.calls[4];
    expect(selectionSave[2]).toBe("selection");
    expect(selectionSave[3]).toEqual({
      selectedArticles: [],
      failures: emptyFailures,
    });
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "selection",
      failureMessage,
      completedPhase: "score",
    });
    expect(failureMessage).not.toBe("No articles selected");
    expect(failureMessage).toMatch(/Drops:\s*2/);
    expect(failureMessage).toContain("Article 1");
    expect(failureMessage).toContain("below-threshold");

    const fatalLog = logSpy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is {
          action: string;
          phase: string;
          reason: string;
          dropCount: number;
          sample: { articleTitle: string; reason: string }[];
        } => (e as { action?: string }).action === "fatal-outcome",
      );
    expect(fatalLog).toBeDefined();
    expect(fatalLog!.phase).toBe("selection");
    expect(fatalLog!.reason).toBe(failureMessage);
    expect(fatalLog!.reason).not.toBe("No articles selected");
    expect(fatalLog!.dropCount).toBe(2);
    expect(fatalLog!.sample).toEqual([
      { articleTitle: "Article 1", reason: "below-threshold" },
      { articleTitle: "Article 2", reason: "not-selected" },
    ]);

    const saveOrder = mocks.savePhaseCheckpoint.mock.invocationCallOrder[4];
    const failOrder = mocks.markFailed.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(failOrder);
    expect(options.drafter!.draft).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("preserves completedPhase score when empty-selection markFailed rejects once then recovers (C1)", async () => {
    const options = happyPathOptions();
    const emptyFailures = [
      {
        articleTitle: "Article 1",
        articleLink: "https://example.com/article-1",
        reason: "below-threshold" as const,
      },
    ];
    (options.selector as ReturnType<typeof vi.fn>).mockResolvedValue({
      selectedArticles: [],
      failures: emptyFailures,
      totalArticles: 3,
      candidateCount: 0,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.5,
    });

    const emptySelectionFailure = {
      failedPhase: "selection" as const,
      failureMessage: buildEmptySelectionFailureMessage(emptyFailures),
      completedPhase: "score" as const,
    };
    mocks.markFailed
      .mockRejectedValueOnce(new Error("transient status update failure"))
      .mockResolvedValue(makeRun({ status: "failed", completedPhase: "score" }));

    await executeRun(client, "run-1", options);

    // Primary + local recovery both carry completedPhase: "score" (not the outer catch).
    expect(mocks.markFailed).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(1, client, "run-1", emptySelectionFailure);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(2, client, "run-1", emptySelectionFailure);

    const persistedCompletedPhase = mocks.markFailed.mock.calls[1][2].completedPhase;
    expect(persistedCompletedPhase).toBe("score");
    expect(resumeStartPhase(persistedCompletedPhase)).toBe("selection");
    expect(options.drafter!.draft).not.toHaveBeenCalled();
  });

  it("marks failed at draft when draft is empty; uses draft reason", async () => {
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockResolvedValue({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: "empty-after-retry",
      attempts: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "empty-after-retry",
    });
    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(5);
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("marks failed at draft with default message when reason is null", async () => {
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockResolvedValue({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: null,
      attempts: 1,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "Empty draft",
    });
  });

  it("scrape never fails the run even if all sources are fallback", async () => {
    const options = happyPathOptions();
    (options.scraper as ReturnType<typeof vi.fn>).mockResolvedValue(
      ARTICLES.map((a) => ({
        url: a.link,
        content: a.content + " [fallback]",
        source: "fallback" as const,
        error: "timeout",
      })),
    );

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    const scrapeCall = mocks.savePhaseCheckpoint.mock.calls[1];
    expect(scrapeCall[3].summary).toEqual({
      total: 3,
      extracted: 0,
      fallback: 3,
    });
  });
});

describe("executeRun — unexpected errors", () => {
  it("marks failed and rethrows when a phase function throws", async () => {
    const options = happyPathOptions();
    const boom = new Error("LLM API exploded");
    (options.tagger as ReturnType<typeof vi.fn>).mockRejectedValue(boom);

    await expect(executeRun(client, "run-1", options)).rejects.toThrow("LLM API exploded");

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "tag",
      failureMessage: "LLM API exploded",
    });
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("marks failed at current phase when fetcher throws", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network unreachable"),
    );

    await expect(executeRun(client, "run-1", options)).rejects.toThrow("Network unreachable");

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "Network unreachable",
    });
  });

  it("truncates long error messages in markFailed", async () => {
    const options = happyPathOptions();
    const longMessage = "Error processing article. ".repeat(200);
    (options.tagger as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(longMessage));

    await expect(executeRun(client, "run-1", options)).rejects.toThrow();

    const failureMessage = mocks.markFailed.mock.calls[0][2].failureMessage;
    expect(failureMessage.length).toBeLessThanOrEqual(2000);
  });

  it("redacts API keys from failureMessage before persisting (S1)", async () => {
    const options = happyPathOptions();
    const secretKey = "sk-or-v1-abcdef1234567890abcdef1234567890abcdef1234567890";
    (options.tagger as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(`OpenRouter request failed with key ${secretKey}`),
    );

    await expect(executeRun(client, "run-1", options)).rejects.toThrow();

    const failureMessage = mocks.markFailed.mock.calls[0][2].failureMessage;
    expect(failureMessage).not.toContain(secretKey);
    expect(failureMessage).not.toContain("sk-or-v1");
    expect(failureMessage).toContain("[redacted]");
  });

  it("redacts Bearer tokens from failureMessage before persisting (S1)", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
    );

    await expect(executeRun(client, "run-1", options)).rejects.toThrow();

    const failureMessage = mocks.markFailed.mock.calls[0][2].failureMessage;
    expect(failureMessage).not.toContain("Bearer");
    expect(failureMessage).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(failureMessage).toContain("[redacted]");
  });
});

describe("executeRun — selection failure detail redaction (S2)", () => {
  const API_KEY = "sk-or-v1-abcdef1234567890abcdef1234567890abcdef1234567890";
  const BEARER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload";
  const PROVIDER_ERROR = `Embedding failed with key ${API_KEY}; Authorization: Bearer ${BEARER}`;

  it("redacts API keys and Bearer tokens from selection failures before non-empty checkpoint save", async () => {
    const options = happyPathOptions();
    (options.selector as ReturnType<typeof vi.fn>).mockResolvedValue({
      selectedArticles: SELECTED_ARTICLES,
      failures: [
        {
          articleTitle: "Article 3",
          articleLink: "https://example.com/article-3",
          reason: "embedding-failed" as const,
          error: PROVIDER_ERROR,
        },
      ],
      totalArticles: 3,
      candidateCount: 3,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.1,
    });

    await executeRun(client, "run-1", options);

    const selectionCall = mocks.savePhaseCheckpoint.mock.calls.find((c) => c[2] === "selection");
    expect(selectionCall).toBeDefined();
    const failures = selectionCall![3].failures;
    expect(failures).toHaveLength(1);
    expect(failures[0].articleTitle).toBe("Article 3");
    expect(failures[0].articleLink).toBe("https://example.com/article-3");
    expect(failures[0].reason).toBe("embedding-failed");
    expect(failures[0].error).toBeDefined();
    expect(failures[0].error).not.toContain(API_KEY);
    expect(failures[0].error).not.toContain("sk-or-v1");
    expect(failures[0].error).not.toContain(BEARER);
    expect(failures[0].error).not.toMatch(/Bearer\s+\S/i);
    expect(failures[0].error).toContain("[redacted]");
    expect(failures[0].error).toContain("Embedding failed");
  });

  it("redacts secrets from selection failures before empty-selection checkpoint save", async () => {
    const options = happyPathOptions();
    (options.selector as ReturnType<typeof vi.fn>).mockResolvedValue({
      selectedArticles: [],
      failures: [
        {
          articleTitle: "Article 1",
          articleLink: "https://example.com/article-1",
          reason: "embedding-failed" as const,
          error: PROVIDER_ERROR,
        },
      ],
      totalArticles: 3,
      candidateCount: 3,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.5,
    });

    await executeRun(client, "run-1", options);

    const selectionCall = mocks.savePhaseCheckpoint.mock.calls.find((c) => c[2] === "selection");
    expect(selectionCall).toBeDefined();
    expect(selectionCall![3].selectedArticles).toEqual([]);
    const failures = selectionCall![3].failures;
    expect(failures).toHaveLength(1);
    expect(failures[0].error).not.toContain(API_KEY);
    expect(failures[0].error).not.toContain(BEARER);
    expect(failures[0].error).not.toMatch(/Bearer\s+\S/i);
    expect(failures[0].error).toContain("[redacted]");
    expect(mocks.markFailed).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        failedPhase: "selection",
        completedPhase: "score",
      }),
    );
  });

  it("bounds selection failure error length before checkpoint persistence", async () => {
    const options = happyPathOptions();
    const longError = `Provider timeout: ${"x".repeat(3000)}`;
    (options.selector as ReturnType<typeof vi.fn>).mockResolvedValue({
      selectedArticles: SELECTED_ARTICLES,
      failures: [
        {
          articleTitle: "Article 3",
          articleLink: "https://example.com/article-3",
          reason: "embedding-failed" as const,
          error: longError,
        },
      ],
      totalArticles: 3,
      candidateCount: 3,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.1,
    });

    await executeRun(client, "run-1", options);

    const selectionCall = mocks.savePhaseCheckpoint.mock.calls.find((c) => c[2] === "selection");
    const error = selectionCall![3].failures[0].error as string;
    expect(error.length).toBeLessThanOrEqual(2000);
    expect(error.length).toBeLessThan(longError.length);
    expect(error).toContain("Provider timeout");
  });
});

describe("executeRun — guard conditions", () => {
  it("throws validation error when run status is running", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "running" }));

    await expect(executeRun(client, "run-1", happyPathOptions())).rejects.toThrow(
      RunRepositoryError,
    );

    const err = await executeRun(client, "run-1", happyPathOptions()).catch((e) => e);
    expect(err.code).toBe("validation");
    expect(mocks.buildPipelineConfigForNewsletter).not.toHaveBeenCalled();
  });

  it("throws validation error when run status is completed", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "completed" }));

    await expect(executeRun(client, "run-1", happyPathOptions())).rejects.toThrow(
      RunRepositoryError,
    );
  });

  it("throws validation error when run status is failed", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ status: "failed" }));

    await expect(executeRun(client, "run-1", happyPathOptions())).rejects.toThrow(
      RunRepositoryError,
    );
  });

  it("marks failed at fetch when config is invalid at claim time; no LLM calls", async () => {
    mocks.buildPipelineConfigForNewsletter.mockResolvedValue({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "Attach at least one healthy (ok) feed before generating",
    });
    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(options.drafter!.draft).not.toHaveBeenCalled();
    expect(mocks.savePhaseCheckpoint).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("marks failed at fetch when newsletter not found at claim time", async () => {
    mocks.buildPipelineConfigForNewsletter.mockResolvedValue({
      ok: false,
      error: "Newsletter not found",
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "Newsletter not found",
    });
  });
});

// ---------------------------------------------------------------------------
// Resume from checkpoint (Feature 04)
// ---------------------------------------------------------------------------

describe("executeRun — resume from checkpoint", () => {
  it("resumes from tag: skips fetch+scrape, uses checkpoint articles", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    const scrapeCheckpoint = {
      articles: ARTICLES,
      summary: { total: 3, extracted: 3, fallback: 0 },
    };
    mocks.loadPhaseCheckpoint.mockResolvedValue(scrapeCheckpoint);

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.scraper).not.toHaveBeenCalled();
    expect(options.tagger).toHaveBeenCalledTimes(1);
    expect(options.tagger).toHaveBeenCalledWith(ARTICLES);

    const phasesCalled = mocks.markRunning.mock.calls.map((c) => c[2]);
    expect(phasesCalled).toEqual(["tag", "score", "selection", "draft"]);

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(4);
    expect(mocks.savePhaseCheckpoint.mock.calls[0][2]).toBe("tag");
    expect(mocks.savePhaseCheckpoint.mock.calls[1][2]).toBe("score");
    expect(mocks.savePhaseCheckpoint.mock.calls[2][2]).toBe("selection");
    expect(mocks.savePhaseCheckpoint.mock.calls[3][2]).toBe("draft");

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("resumes from draft: skips all phases except draft", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "selection" }));
    const selectionCheckpoint = {
      selectedArticles: SELECTED_ARTICLES,
    };
    mocks.loadPhaseCheckpoint.mockResolvedValue(selectionCheckpoint);

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.scraper).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(options.scorer).not.toHaveBeenCalled();
    expect(options.selector).not.toHaveBeenCalled();
    expect(options.drafter!.draft).toHaveBeenCalledTimes(1);
    expect(options.drafter!.draft).toHaveBeenCalledWith(
      SELECTED_ARTICLES,
      "Test Newsletter",
      ["AI", "Climate"],
      SELECTED_ARTICLES.length,
      "",
    );

    const phasesCalled = mocks.markRunning.mock.calls.map((c) => c[2]);
    expect(phasesCalled).toEqual(["draft"]);

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.savePhaseCheckpoint.mock.calls[0][2]).toBe("draft");

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  // Feature 03 Task 1 — item 9: audience call-site wiring
  it("passes config.audience as the 5th argument to drafter.draft", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "selection" }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      selectedArticles: SELECTED_ARTICLES,
    });
    const audience = "Engineers who ship weekly digests";
    mocks.buildPipelineConfigForNewsletter.mockResolvedValue({
      ...okBuildResult(),
      config: createNewsletterConfig({
        name: "Test Newsletter",
        topics: ["AI", "Climate"],
        dislikedTopics: ["Crypto"],
        newsItems: 5,
        feeds: ["https://feed-a.example/rss", "https://feed-b.example/rss"],
        dateRange: "last_3_days",
        audience,
      }),
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.drafter!.draft).toHaveBeenCalledTimes(1);
    expect(options.drafter!.draft).toHaveBeenCalledWith(
      SELECTED_ARTICLES,
      "Test Newsletter",
      ["AI", "Climate"],
      SELECTED_ARTICLES.length,
      audience,
    );
  });

  it("resumes from score: skips fetch+scrape+tag, uses checkpoint tagged articles", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "tag" }));
    const tagCheckpoint = {
      taggedArticles: TAGGED_ARTICLES,
    };
    mocks.loadPhaseCheckpoint.mockResolvedValue(tagCheckpoint);

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.scraper).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(options.scorer).toHaveBeenCalledTimes(1);
    expect(options.scorer).toHaveBeenCalledWith(TAGGED_ARTICLES, ["AI", "Climate"], ["Crypto"]);

    const phasesCalled = mocks.markRunning.mock.calls.map((c) => c[2]);
    expect(phasesCalled).toEqual(["score", "selection", "draft"]);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("uses requireOkFeeds: false when resuming from a non-fetch phase", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "tag" }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      taggedArticles: TAGGED_ARTICLES,
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.buildPipelineConfigForNewsletter).toHaveBeenCalledWith(client, "nl-1", {
      requireOkFeeds: false,
    });
  });

  it("uses requireOkFeeds: true (default) for fresh start", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "" }));

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.buildPipelineConfigForNewsletter).toHaveBeenCalledWith(client, "nl-1", undefined);
  });

  it("marks failed when checkpoint load fails", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("checkpoint_missing", "No checkpoint stored"),
    );

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "tag",
      failureMessage: "Cannot retry: checkpoint data is missing. Start a new run instead.",
    });
    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(options.drafter!.draft).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("marks failed when completedPhase is draft (non-resumable)", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "draft" }));

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "This run cannot be resumed; start a new run instead",
    });
    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(options.drafter!.draft).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(mocks.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Feed health hook (Feature 05 Task 3)
// ---------------------------------------------------------------------------

describe("executeRun — feed health hook", () => {
  it("calls applyFeedFetchOutcomes on happy-path fetch with attempted URLs and failedFeeds", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.applyFeedFetchOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.applyFeedFetchOutcomes).toHaveBeenCalledWith(client, {
      attemptedFeedUrls: ["https://feed-a.example/rss", "https://feed-b.example/rss"],
      failedFeeds: [
        expect.objectContaining({
          feedUrl: "https://bad.example/rss",
          errorType: "HttpError",
        }),
      ],
    });
  });

  it("calls applyFeedFetchOutcomes before markFailed on zero-article fetch", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      articles: [],
      failedFeeds: [
        {
          feedUrl: "https://feed-a.example/rss",
          errorType: "NetworkError",
          errorMessage: "ECONNREFUSED",
        },
      ],
      totalFeeds: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.applyFeedFetchOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.applyFeedFetchOutcomes).toHaveBeenCalledWith(client, {
      attemptedFeedUrls: ["https://feed-a.example/rss", "https://feed-b.example/rss"],
      failedFeeds: [
        expect.objectContaining({
          feedUrl: "https://feed-a.example/rss",
          errorType: "NetworkError",
        }),
      ],
    });
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "No articles fetched",
      failedFeeds: [
        {
          feedUrl: "https://feed-a.example/rss",
          errorType: "NetworkError",
          errorMessage: "ECONNREFUSED",
        },
      ],
    });
  });

  it("does NOT call applyFeedFetchOutcomes from scrape-only-or-later phases", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "fetch" }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      articles: ARTICLES,
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(mocks.applyFeedFetchOutcomes).not.toHaveBeenCalled();
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("does NOT call applyFeedFetchOutcomes when resuming from tag", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      articles: ARTICLES,
      summary: { total: 3, extracted: 3, fallback: 0 },
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(mocks.applyFeedFetchOutcomes).not.toHaveBeenCalled();
  });

  it("does NOT call applyFeedFetchOutcomes when resuming from selection", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "selection" }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      selectedArticles: SELECTED_ARTICLES,
    });

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(mocks.applyFeedFetchOutcomes).not.toHaveBeenCalled();
  });

  it("does NOT fail the run when applyFeedFetchOutcomes throws", async () => {
    mocks.applyFeedFetchOutcomes.mockRejectedValue(new Error("Appwrite exploded"));

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(6);
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("does not double-count on zero-article fatal when health throws", async () => {
    mocks.applyFeedFetchOutcomes.mockRejectedValue(new Error("Appwrite exploded"));
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      articles: [],
      failedFeeds: [],
      totalFeeds: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.applyFeedFetchOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "No articles fetched",
      failedFeeds: [],
    });
    expect(mocks.savePhaseCheckpoint).not.toHaveBeenCalled();
  });

  it("does NOT call applyFeedFetchOutcomes when fetcher throws before FetchResult", async () => {
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network unreachable"),
    );

    await expect(executeRun(client, "run-1", options)).rejects.toThrow("Network unreachable");

    expect(mocks.applyFeedFetchOutcomes).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C5: markCompleted failure preserves run resumability
// ---------------------------------------------------------------------------

describe("executeRun — markCompleted failure preserves resumability (C5)", () => {
  it("retries markCompleted once on transient failure and succeeds on second attempt", async () => {
    const options = happyPathOptions();
    mocks.markCompleted
      .mockRejectedValueOnce(new Error("transient db error"))
      .mockResolvedValueOnce(makeRun({ status: "completed" }));

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(6);
  });

  it("marks failedPhase: 'selection' (not 'draft') when markCompleted fails twice, keeping run resumable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    const options = happyPathOptions();
    mocks.markCompleted.mockRejectedValue(new Error("db down"));

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(2);
    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(6);

    // markFailed must use failedPhase: "selection" + completedPhase: "selection"
    // so resumeStartPhase("selection") → "draft" (resumable), not null
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "selection",
      failureMessage: expect.stringContaining("retry from draft"),
      completedPhase: "selection",
    });

    // Must NOT have been called with failedPhase: "draft"
    const draftFailCalls = mocks.markFailed.mock.calls.filter((c) => c[2].failedPhase === "draft");
    expect(draftFailCalls).toHaveLength(0);

    spy.mockRestore();
  });

  it("does not rethrow when markCompleted fails twice (run is marked failed, not crashed)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    const options = happyPathOptions();
    mocks.markCompleted.mockRejectedValue(new Error("db down"));

    await expect(executeRun(client, "run-1", options)).resolves.toBeUndefined();

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// N1: checkpoint catch blocks bind+log+distinguish error types
// ---------------------------------------------------------------------------

describe("executeRun — checkpoint catch distinguishes error types (N1)", () => {
  it("shows 'database error' message when checkpoint load throws appwrite (not checkpoint_missing)", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("appwrite", "DB connection lost"),
    );

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "tag",
      failureMessage: "Could not load checkpoint due to a database error. Try again.",
    });
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("shows 'start a new run' message when checkpoint load throws checkpoint_missing", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("checkpoint_missing", "No checkpoint stored"),
    );

    const options = happyPathOptions();
    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "tag",
      failureMessage: "Cannot retry: checkpoint data is missing. Start a new run instead.",
    });
  });

  it("logs the checkpoint error with structured context", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    mocks.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("appwrite", "DB connection lost"),
    );

    await executeRun(client, "run-1", happyPathOptions());

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "resume-checkpoint-scrape",
    );
    expect(logged).toBeDefined();
    const entry = logged![0] as {
      phase: string;
      runId: string;
      code: string;
      message: string;
    };
    expect(entry.runId).toBe("run-1");
    expect(entry.code).toBe("appwrite");
    expect(entry.message).toContain("DB connection lost");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// C4: outer catch markFailed failure is logged (orphan diagnosability)
// ---------------------------------------------------------------------------

describe("executeRun — outer catch logs markFailed failure (C4)", () => {
  it("logs markFailed failure with structured context instead of silently swallowing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    const options = happyPathOptions();
    (options.tagger as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM exploded"));
    // markFailed itself throws
    mocks.markFailed.mockRejectedValue(new Error("db down"));

    await expect(executeRun(client, "run-1", options)).rejects.toThrow("LLM exploded");

    // The markFailed failure must be logged
    const logged = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "mark-failed-fallback-tag",
    );
    expect(logged).toBeDefined();
    const entry = logged![0] as {
      phase: string;
      runId: string;
      failedPhase: string;
      message: string;
    };
    expect(entry.runId).toBe("run-1");
    expect(entry.failedPhase).toBe("tag");
    expect(entry.message).toContain("db down");

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// O1: structured console.log across the phase loop
// ---------------------------------------------------------------------------

describe("executeRun — structured logging (O1)", () => {
  it("logs phase-start for each phase on the happy path", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });

    await executeRun(client, "run-1", happyPathOptions());

    const phaseStartLogs = spy.mock.calls
      .map((c) => c[0])
      .filter(
        (e): e is { action: string; runId: string; phase: string } =>
          (e as { action?: string }).action === "phase-start",
      );
    const phases = phaseStartLogs.map((e) => e.phase);

    expect(phases).toEqual(["fetch", "scrape", "tag", "score", "selection", "draft"]);
    for (const entry of phaseStartLogs) {
      expect(entry.runId).toBe("run-1");
    }

    spy.mockRestore();
  });

  it("logs resume-hydrate with completedPhase and startPhase on resume", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "scrape" }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      articles: ARTICLES,
      summary: { total: 3, extracted: 3, fallback: 0 },
    });

    await executeRun(client, "run-1", happyPathOptions());

    const hydrateLog = spy.mock.calls
      .map((c) => c[0])
      .find(
        (
          e,
        ): e is {
          action: string;
          runId: string;
          completedPhase: string;
          startPhase: string;
        } => (e as { action?: string }).action === "resume-hydrate",
      );

    expect(hydrateLog).toBeDefined();
    expect(hydrateLog!.runId).toBe("run-1");
    expect(hydrateLog!.completedPhase).toBe("scrape");
    expect(hydrateLog!.startPhase).toBe("tag");

    spy.mockRestore();
  });

  it("logs checkpoint-saved with articleCount after each checkpoint", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });

    await executeRun(client, "run-1", happyPathOptions());

    const checkpointLogs = spy.mock.calls
      .map((c) => c[0])
      .filter(
        (e): e is { action: string; phase: string; articleCount: number } =>
          (e as { action?: string }).action === "checkpoint-saved",
      );
    const phases = checkpointLogs.map((e) => e.phase);

    expect(phases).toEqual(["fetch", "scrape", "tag", "score", "selection", "draft"]);
    for (const entry of checkpointLogs) {
      expect(typeof entry.articleCount).toBe("number");
    }

    spy.mockRestore();
  });

  it("logs fatal-outcome with phase and reason on zero-article fetch", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });
    const options = happyPathOptions();
    (options.fetcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      articles: [],
      failedFeeds: [],
      totalFeeds: 2,
    });

    await executeRun(client, "run-1", options);

    const fatalLog = spy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is { action: string; phase: string; reason: string } =>
          (e as { action?: string }).action === "fatal-outcome",
      );

    expect(fatalLog).toBeDefined();
    expect(fatalLog!.phase).toBe("fetch");
    expect(fatalLog!.reason).toBe("No articles fetched");

    spy.mockRestore();
  });

  it("logs run-completed with selectedCount on success", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {
      /* swallow */
    });

    await executeRun(client, "run-1", happyPathOptions());

    const completedLog = spy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is { action: string; runId: string; selectedCount: number } =>
          (e as { action?: string }).action === "run-completed",
      );

    expect(completedLog).toBeDefined();
    expect(completedLog!.runId).toBe("run-1");
    expect(completedLog!.selectedCount).toBe(SELECTED_ARTICLES.length);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Cross-run topic suppression (Feature 09 Task 3)
// ---------------------------------------------------------------------------

const LOOKBACK_TOPICS: LookbackTopic[] = [
  {
    title: "Recent AI News",
    tags: ["AI"],
    runId: "run-old-1",
    runEndedAt: "2024-01-10T10:00:00.000Z",
    runStartedAt: "2024-01-10T09:00:00.000Z",
  },
];

describe("executeRun — cross-run suppression", () => {
  it("suppress runs on full scoredArticles before selector; selector receives survivors only", async () => {
    mocks.loadLookbackTopics.mockResolvedValueOnce({
      lookback: 3,
      issues: [],
      topics: LOOKBACK_TOPICS,
    });
    const suppressFn = vi.fn().mockResolvedValue({
      remaining: SCORED_ARTICLES.slice(0, 2),
      summary: {
        count: 1,
        items: [
          {
            title: "Article 3",
            link: "https://example.com/article-3",
            matchedRunId: "run-old-1",
            matchedTitle: "Recent AI News",
            similarity: 0.9,
          },
        ],
      },
    });
    const selectorFn = vi.fn().mockResolvedValue({
      selectedArticles: SCORED_ARTICLES.slice(0, 2),
      failures: [
        {
          articleTitle: "Article 3",
          articleLink: "https://example.com/article-3",
          reason: "not-selected" as const,
        },
      ],
      totalArticles: 2,
      candidateCount: 2,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.1,
    });
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      suppress: suppressFn,
      selector: selectorFn,
    };

    await executeRun(client, "run-1", options);

    expect(suppressFn).toHaveBeenCalledTimes(1);
    expect(suppressFn).toHaveBeenCalledWith(SCORED_ARTICLES, LOOKBACK_TOPICS, {
      threshold: expect.any(Number),
    });
    expect(selectorFn).toHaveBeenCalledTimes(1);
    expect(selectorFn).toHaveBeenCalledWith(SCORED_ARTICLES.slice(0, 2), 5);
    expect(mocks.saveSuppressSummary).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({ count: 1 }),
    );
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("marks failed at selection when suppress empties the pool; persists suppressSummary first", async () => {
    mocks.loadLookbackTopics.mockResolvedValueOnce({
      lookback: 3,
      issues: [],
      topics: LOOKBACK_TOPICS,
    });
    const summary = {
      count: 3,
      items: SCORED_ARTICLES.map((a) => ({
        title: a.title,
        link: a.link,
        matchedRunId: "run-old-1",
        matchedTitle: "Recent AI News",
        similarity: 0.95,
      })),
    };
    const suppressFn = vi.fn().mockResolvedValue({
      remaining: [],
      summary,
    });
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      suppress: suppressFn,
    };

    const failureMessage = buildFullSuppressFailureMessage(summary);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeRun(client, "run-1", options);

    expect(mocks.saveSuppressSummary).toHaveBeenCalledTimes(1);
    expect(mocks.saveSuppressSummary).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({ count: 3 }),
    );
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "selection",
      failureMessage,
    });
    expect(failureMessage).not.toBe("No articles selected");
    expect(failureMessage).toMatch(/Suppressed:\s*3/);
    expect(failureMessage).toContain(SCORED_ARTICLES[0]!.title);

    const fatalLog = logSpy.mock.calls
      .map((c) => c[0])
      .find(
        (e): e is {
          action: string;
          phase: string;
          reason: string;
          suppressCount: number;
          sample: string[];
        } => (e as { action?: string }).action === "fatal-outcome",
      );
    expect(fatalLog).toBeDefined();
    expect(fatalLog!.phase).toBe("selection");
    expect(fatalLog!.reason).toBe(failureMessage);
    expect(fatalLog!.reason).not.toBe("No articles selected");
    expect(fatalLog!.suppressCount).toBe(3);
    expect(fatalLog!.sample).toEqual(
      SCORED_ARTICLES.slice(0, FAILURE_MESSAGE_SAMPLE_MAX).map((a) => a.title),
    );

    const suppressOrder = mocks.saveSuppressSummary.mock.invocationCallOrder[0];
    const failOrder = mocks.markFailed.mock.invocationCallOrder[0];
    expect(suppressOrder).toBeLessThan(failOrder);
    expect(options.selector).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("completes (not markFailed) when suppress leaves fewer survivors than newsItems target", async () => {
    mocks.loadLookbackTopics.mockResolvedValueOnce({
      lookback: 3,
      issues: [],
      topics: LOOKBACK_TOPICS,
    });
    const oneSurvivor = [SCORED_ARTICLES[0]!];
    const suppressFn = vi.fn().mockResolvedValue({
      remaining: oneSurvivor,
      summary: {
        count: 2,
        items: [
          {
            title: "Article 2",
            link: "https://example.com/article-2",
            matchedRunId: "run-old-1",
            matchedTitle: "Recent AI News",
            similarity: 0.92,
          },
          {
            title: "Article 3",
            link: "https://example.com/article-3",
            matchedRunId: "run-old-1",
            matchedTitle: "Recent AI News",
            similarity: 0.91,
          },
        ],
      },
    });
    const selectorFn = vi.fn().mockResolvedValue({
      selectedArticles: oneSurvivor,
      failures: [],
      totalArticles: 1,
      candidateCount: 1,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.1,
    });
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      suppress: suppressFn,
      selector: selectorFn,
    };

    await executeRun(client, "run-1", options);

    expect(selectorFn).toHaveBeenCalledWith(oneSurvivor, 5);
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("when lookback is 0, selector receives the full scored set (suppress no-op)", async () => {
    mocks.buildPipelineConfigForNewsletter.mockResolvedValueOnce({
      ...okBuildResult(),
      newsletter: { ...okBuildResult().newsletter, lookback: 0 },
    });
    mocks.loadLookbackTopics.mockResolvedValueOnce({
      lookback: 0,
      issues: [],
      topics: [],
    });
    const suppressFn = vi.fn().mockImplementation(async (candidates: ScoredArticle[]) => ({
      remaining: candidates,
      summary: { count: 0, items: [] },
    }));
    const selectorFn = vi.fn().mockResolvedValue({
      selectedArticles: SCORED_ARTICLES.slice(0, 2),
      failures: [],
      totalArticles: 3,
      candidateCount: 3,
      targetCount: 5,
      lambda: 0.5,
      minScore: 0.1,
    });
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      suppress: suppressFn,
      selector: selectorFn,
    };

    await executeRun(client, "run-1", options);

    expect(mocks.loadLookbackTopics).toHaveBeenCalledWith(client, {
      newsletterId: "nl-1",
      lookback: 0,
    });
    expect(suppressFn).toHaveBeenCalledWith(SCORED_ARTICLES, [], { threshold: expect.any(Number) });
    expect(selectorFn).toHaveBeenCalledWith(SCORED_ARTICLES, 5);
    expect(mocks.saveSuppressSummary).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({ count: 0 }),
    );
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Claim-time LLM resolution (Feature 06 Task 4)
// ---------------------------------------------------------------------------

describe("executeRun — claim-time LLM resolution", () => {
  it("injects resolved models and prompts into default tag/score/draft/embed phases", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const options: ExecuteRunOptions = {
      fetcher: vi.fn().mockResolvedValue({
        articles: ARTICLES,
        failedFeeds: [],
        totalFeeds: 2,
      }),
      scraper: vi.fn().mockResolvedValue(
        ARTICLES.map((a) => ({
          url: a.link,
          content: a.content + " [scraped]",
          source: "extracted" as const,
        })),
      ),
      ...stubIssueMetadataGenerators(),
    };

    await executeRun(client, "run-1", options);

    expect(mocks.listPromptTemplates).toHaveBeenCalledTimes(1);
    expect(mocks.getOrCreateAppSettings).toHaveBeenCalledTimes(1);

    expect(mocks.tagArticles).toHaveBeenCalledTimes(1);
    expect(mocks.tagArticles).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: "nl/tagger-model",
        promptTemplate: "TAGGER prompt body {title} {truncated_content}",
      }),
    );

    expect(mocks.scoreArticles).toHaveBeenCalledTimes(1);
    expect(mocks.scoreArticles).toHaveBeenCalledWith(
      TAGGED_ARTICLES,
      ["AI", "Climate"],
      ["Crypto"],
      expect.objectContaining({
        model: "nl/scorer-model",
        promptTemplate: "SCORER prompt body {topics} {title}",
      }),
    );

    expect(mocks.suppressCrossRunTopics).toHaveBeenCalledTimes(1);
    expect(mocks.suppressCrossRunTopics).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      [],
      expect.objectContaining({
        model: "nl/embedder-model",
        threshold: DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
        client: expect.anything(),
      }),
    );

    expect(mocks.selectDiverse).toHaveBeenCalledTimes(1);
    expect(mocks.selectDiverse).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      5,
      expect.objectContaining({
        model: "nl/embedder-model",
        minScore: DEFAULT_SCORE_THRESHOLD,
        client: expect.anything(),
      }),
    );

    expect(mocks.NewsletterDrafterCtor).toHaveBeenCalledTimes(1);
    expect(mocks.NewsletterDrafterCtor).toHaveBeenCalledWith({
      model: "nl/drafter-model",
      promptTemplate: "DRAFTER prompt body {newsletter_name} {articles_json}",
      client: expect.anything(),
      reasoningEffort: DRAFTER_REASONING_EFFORT,
      maxCompletionTokens: DRAFTER_MAX_COMPLETION_TOKENS,
    });
    expect(mocks.drafterDraft).toHaveBeenCalledTimes(1);

    const resolutionLog = logSpy.mock.calls
      .map((c) => c[0])
      .find((entry) => entry && typeof entry === "object" && entry.action === "llm-resolution");
    expect(resolutionLog).toEqual({
      action: "llm-resolution",
      runId: "run-1",
      models: {
        tagger: "nl/tagger-model",
        scorer: "nl/scorer-model",
        drafter: "nl/drafter-model",
        titleDek: DEFAULT_MODELS.titleDek,
        embedder: "nl/embedder-model",
      },
      promptLengths: {
        tagger: "TAGGER prompt body {title} {truncated_content}".length,
        scorer: "SCORER prompt body {topics} {title}".length,
        drafter: "DRAFTER prompt body {newsletter_name} {articles_json}".length,
        title: DEFAULT_TITLE_PROMPT_BODY.length,
        dek: DEFAULT_DEK_PROMPT_BODY.length,
      },
    });
    // Never log full prompt bodies
    expect(JSON.stringify(resolutionLog)).not.toContain("TAGGER prompt body");
    expect(JSON.stringify(resolutionLog)).not.toContain(TITLE_PROMPT_CANARY);
    expect(JSON.stringify(resolutionLog)).not.toContain(DEK_PROMPT_CANARY);
    logSpy.mockRestore();
  });

  it("does not replace explicit phase mocks with resolution defaults", async () => {
    const options = happyPathOptions();
    const suppressFn = vi.fn().mockImplementation(async (candidates: ScoredArticle[]) => ({
      remaining: candidates,
      summary: { count: 0, items: [] },
    }));

    await executeRun(client, "run-1", { ...options, suppress: suppressFn });

    expect(mocks.listPromptTemplates).toHaveBeenCalledTimes(1);
    expect(options.tagger).toHaveBeenCalledTimes(1);
    expect(options.scorer).toHaveBeenCalledTimes(1);
    expect(options.selector).toHaveBeenCalledTimes(1);
    expect(options.drafter!.draft).toHaveBeenCalledTimes(1);
    expect(suppressFn).toHaveBeenCalledTimes(1);

    expect(mocks.tagArticles).not.toHaveBeenCalled();
    expect(mocks.scoreArticles).not.toHaveBeenCalled();
    expect(mocks.selectDiverse).not.toHaveBeenCalled();
    expect(mocks.suppressCrossRunTopics).not.toHaveBeenCalled();
    expect(mocks.NewsletterDrafterCtor).not.toHaveBeenCalled();
  });

  it("marks failed with operator-safe message when resolution load fails; does not enter fetch", async () => {
    mocks.listPromptTemplates.mockRejectedValueOnce(new Error("Appwrite 401 secret-token-xyz"));
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "Could not load prompt templates or model settings",
    });
    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(mocks.markRunning).not.toHaveBeenCalled();
  });

  it("loads resolution exactly once per multi-phase claim (claim-time freeze)", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.listPromptTemplates).toHaveBeenCalledTimes(1);
    expect(mocks.getOrCreateAppSettings).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not resolve operator settings when LLM resolution fails", async () => {
    mocks.listPromptTemplates.mockRejectedValueOnce(new Error("Appwrite 401 secret-token-xyz"));
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.resolveOperatorSettings).not.toHaveBeenCalled();
    expect(mocks.LLMClientCtor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Claim-time operator settings snapshot (Feature 04 Task 3)
// ---------------------------------------------------------------------------

describe("executeRun — claim-time operator settings", () => {
  function defaultPhaseOptions(): ExecuteRunOptions {
    return {
      fetcher: vi.fn().mockResolvedValue({
        articles: ARTICLES,
        failedFeeds: [],
        totalFeeds: 2,
      }),
      scraper: vi.fn().mockResolvedValue(
        ARTICLES.map((a) => ({
          url: a.link,
          content: a.content + " [scraped]",
          source: "extracted" as const,
        })),
      ),
      autoDeliver: noopAutoDeliver(),
      ...stubIssueMetadataGenerators(),
    };
  }

  it("injects GUI OpenRouter key into one shared LLMClient for default LLM phases", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      defaultOperatorSnapshot({
        openRouterApiKey: { value: GUI_OPENROUTER_KEY, source: "gui" },
      }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeRun(client, "run-1", defaultPhaseOptions());

    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledWith(client);
    expect(mocks.LLMClientCtor).toHaveBeenCalledTimes(1);
    expect(mocks.LLMClientCtor).toHaveBeenCalledWith({ apiKey: GUI_OPENROUTER_KEY });

    const injectedClient = mocks.tagArticles.mock.calls[0]![1].client;
    expect(injectedClient).toBeDefined();
    expect(mocks.tagArticles).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ client: injectedClient }),
    );
    expect(mocks.scoreArticles).toHaveBeenCalledWith(
      TAGGED_ARTICLES,
      ["AI", "Climate"],
      ["Crypto"],
      expect.objectContaining({ client: injectedClient }),
    );
    expect(mocks.selectDiverse).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      5,
      expect.objectContaining({ client: injectedClient }),
    );
    expect(mocks.suppressCrossRunTopics).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      [],
      expect.objectContaining({ client: injectedClient }),
    );
    expect(mocks.NewsletterDrafterCtor).toHaveBeenCalledWith(
      expect.objectContaining({ client: injectedClient }),
    );

    const allLogs = JSON.stringify(logSpy.mock.calls);
    expect(allLogs).not.toContain(GUI_OPENROUTER_KEY);
    logSpy.mockRestore();
  });

  it("marks failed early when OpenRouter key source is none; skips LLM phases", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      defaultOperatorSnapshot({
        openRouterApiKey: { value: null, source: "none" },
      }),
    );
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "fetch",
      failureMessage: "OpenRouter API key is not set",
    });
    expect(mocks.LLMClientCtor).not.toHaveBeenCalled();
    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(mocks.tagArticles).not.toHaveBeenCalled();
    expect(mocks.scoreArticles).not.toHaveBeenCalled();
    expect(mocks.markRunning).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();

    const failureMsg = mocks.markFailed.mock.calls[0]![2].failureMessage as string;
    expect(failureMsg).not.toMatch(/sk-|password|smtp/i);
  });

  it("passes resolved score / similarity / drafter knobs from the claim-time snapshot", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      defaultOperatorSnapshot({
        openRouterApiKey: { value: GUI_OPENROUTER_KEY, source: "gui" },
        scoreThreshold: { value: 8.5, source: "gui" },
        crossRunSimilarityThreshold: { value: 0.72, source: "gui" },
        drafterReasoningEffort: { value: "medium", source: "gui" },
        drafterMaxCompletionTokens: { value: 16000, source: "gui" },
      }),
    );

    await executeRun(client, "run-1", defaultPhaseOptions());

    expect(mocks.selectDiverse).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      5,
      expect.objectContaining({ minScore: 8.5 }),
    );
    expect(mocks.suppressCrossRunTopics).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      [],
      expect.objectContaining({ threshold: 0.72 }),
    );
    expect(mocks.NewsletterDrafterCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: "medium",
        maxCompletionTokens: 16000,
      }),
    );
  });

  it("resolves operator settings exactly once per successful executeRun start", async () => {
    let resolveCount = 0;
    mocks.resolveOperatorSettings.mockImplementation(async () => {
      resolveCount += 1;
      return defaultOperatorSnapshot({
        openRouterApiKey: { value: GUI_OPENROUTER_KEY, source: "gui" },
        scoreThreshold: { value: 6 + resolveCount, source: "gui" },
      });
    });

    await executeRun(client, "run-1", defaultPhaseOptions());

    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.selectDiverse).toHaveBeenCalledWith(
      SCORED_ARTICLES,
      5,
      expect.objectContaining({ minScore: 7 }),
    );
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("logs operator resolution metadata without secrets", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      defaultOperatorSnapshot({
        openRouterApiKey: { value: GUI_OPENROUTER_KEY, source: "gui" },
        scoreThreshold: { value: 8.5, source: "gui" },
        crossRunSimilarityThreshold: { value: 0.72, source: "env" },
        drafterReasoningEffort: { value: "low", source: "gui" },
        drafterMaxCompletionTokens: { value: 12000, source: "env" },
        smtp: {
          value: {
            host: "smtp.example.com",
            port: 587,
            username: "u",
            password: "smtp-password-secret-do-not-log",
            from: "u",
            secure: false,
          },
          source: "gui",
        },
      }),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await executeRun(client, "run-1", defaultPhaseOptions());

    const operatorLog = logSpy.mock.calls
      .map((c) => c[0])
      .find(
        (entry) =>
          entry && typeof entry === "object" && entry.action === "operator-settings-resolution",
      );
    expect(operatorLog).toEqual(
      expect.objectContaining({
        action: "operator-settings-resolution",
        runId: "run-1",
        openRouterApiKeySource: "gui",
        scoreThreshold: 8.5,
        scoreThresholdSource: "gui",
        crossRunSimilarityThreshold: 0.72,
        crossRunSimilarityThresholdSource: "env",
        drafterReasoningEffort: "low",
        drafterReasoningEffortSource: "gui",
        drafterMaxCompletionTokens: 12000,
        drafterMaxCompletionTokensSource: "env",
      }),
    );
    const serialized = JSON.stringify(logSpy.mock.calls);
    expect(serialized).not.toContain(GUI_OPENROUTER_KEY);
    expect(serialized).not.toContain("smtp-password-secret-do-not-log");
    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Feature 05: auto-deliver after successful markCompleted (cases 10–12)
// ---------------------------------------------------------------------------

describe("executeRun — auto-deliver after success", () => {
  it("10. calls injected autoDeliver once with (client, runId) after markCompleted", async () => {
    const autoDeliver = noopAutoDeliver();
    const options: ExecuteRunOptions = { ...happyPathOptions(), autoDeliver };

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(autoDeliver).toHaveBeenCalledTimes(1);
    expect(autoDeliver).toHaveBeenCalledWith(client, "run-1");
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("11. does not call autoDeliver when the run fails before completion", async () => {
    const autoDeliver = noopAutoDeliver();
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      autoDeliver,
      drafter: {
        draft: vi.fn().mockResolvedValue({
          markdown: "",
          articleCount: 0,
          empty: true,
          reason: "No content generated",
          attempts: 1,
        }),
      },
    };

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "No content generated",
    });
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(autoDeliver).not.toHaveBeenCalled();
  });

  it("12. delivery throw does not markFailed or rethrow as pipeline failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    const autoDeliver = vi.fn().mockRejectedValue(new Error("SMTP_PASSWORD=secret boom"));
    const options: ExecuteRunOptions = { ...happyPathOptions(), autoDeliver };

    await expect(executeRun(client, "run-1", options)).resolves.toBeUndefined();

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(autoDeliver).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).not.toHaveBeenCalled();

    const autoDeliverLogs = spy.mock.calls.filter((call) => {
      const arg = call[0] as { phase?: string } | undefined;
      return arg?.phase === "auto-deliver";
    });
    expect(autoDeliverLogs.length).toBeGreaterThanOrEqual(1);

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Feature 01 Task 4: persist extracted title/dek on markCompleted (cases 14–17)
// ---------------------------------------------------------------------------

const HAPPY_PATH_MARKDOWN = "# Test Newsletter\n\nArticle content here.";
const HAPPY_PATH_ISSUE_TITLE = "Test Newsletter";
const HAPPY_PATH_ISSUE_DEK = "Article content here.";

describe("executeRun — persist issue metadata on complete (Feature 01)", () => {
  it("14. happy path markCompleted includes extracted issueTitle and issueDek", async () => {
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: HAPPY_PATH_ISSUE_TITLE,
        issueDek: HAPPY_PATH_ISSUE_DEK,
      }),
    );
    expect(mocks.buildIssueMetadataFromMarkdown).toHaveBeenCalledWith(HAPPY_PATH_MARKDOWN);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("15. empty-draft fatal does not call markCompleted or extract metadata", async () => {
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockResolvedValue({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: "empty-after-retry",
      attempts: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "empty-after-retry",
    });
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(mocks.buildIssueMetadataFromMarkdown).not.toHaveBeenCalled();
  });

  it("16. extract throw still markCompleted once with empty strings and does not consume Appwrite retry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    mocks.buildIssueMetadataFromMarkdown.mockImplementation(() => {
      throw new Error("extract exploded");
    });
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: "",
        issueDek: "",
      }),
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();

    const persistLog = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "persist-issue-metadata",
    );
    expect(persistLog).toBeDefined();
    const persistEntry = persistLog![0] as { phase: string; runId: string; message: string };
    expect(persistEntry.phase).toBe("persist-issue-metadata");
    expect(persistEntry.runId).toBe("run-1");
    expect(persistEntry.message).toContain("extract exploded");

    const retryLog = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "mark-completed-retry",
    );
    expect(retryLog).toBeUndefined();

    spy.mockRestore();
  });

  it("17. C5 retry sends the same extracted issueTitle and issueDek on both markCompleted attempts", async () => {
    const options = happyPathOptions();
    mocks.markCompleted
      .mockRejectedValueOnce(new Error("transient db error"))
      .mockResolvedValueOnce(makeRun({ status: "completed" }));

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).not.toHaveBeenCalled();

    const extracted = {
      issueTitle: HAPPY_PATH_ISSUE_TITLE,
      issueDek: HAPPY_PATH_ISSUE_DEK,
    };
    expect(mocks.markCompleted).toHaveBeenNthCalledWith(
      1,
      client,
      "run-1",
      expect.objectContaining(extracted),
    );
    expect(mocks.markCompleted).toHaveBeenNthCalledWith(
      2,
      client,
      "run-1",
      expect.objectContaining(extracted),
    );
  });
});

// ---------------------------------------------------------------------------
// Feature 02 Task 4: cheap-model title/dek overlay on markCompleted (cases 11–16)
// ---------------------------------------------------------------------------

const GENERATED_ISSUE_TITLE = "Generated Title";
const GENERATED_ISSUE_DEK = "Generated dek sentence.";

describe("executeRun — cheap-model title/dek overlay (Feature 02)", () => {
  it("confirms ISSUE_DEK_ATTR_SIZE is 512", () => {
    expect(ISSUE_DEK_ATTR_SIZE).toBe(512);
  });

  it("11. happy path overlays generated title and dek onto markCompleted", async () => {
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      generateIssueTitle: vi.fn().mockResolvedValue(GENERATED_ISSUE_TITLE),
      generateIssueDek: vi.fn().mockResolvedValue(GENERATED_ISSUE_DEK),
    };

    await executeRun(client, "run-1", options);

    expect(options.generateIssueTitle).toHaveBeenCalledTimes(1);
    expect(options.generateIssueTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_MODELS.titleDek,
        promptTemplate: DEFAULT_TITLE_PROMPT_BODY,
        draft: HAPPY_PATH_MARKDOWN,
        newsletterName: "Test Newsletter",
        audience: "",
        llm: expect.anything(),
      }),
    );
    expect(options.generateIssueDek).toHaveBeenCalledTimes(1);
    expect(options.generateIssueDek).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_MODELS.titleDek,
        promptTemplate: DEFAULT_DEK_PROMPT_BODY,
        draft: HAPPY_PATH_MARKDOWN,
        newsletterName: "Test Newsletter",
        audience: "",
        llm: expect.anything(),
      }),
    );
    expect(mocks.chatCompletion).not.toHaveBeenCalled();
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: GENERATED_ISSUE_TITLE,
        issueDek: GENERATED_ISSUE_DEK,
      }),
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("12. title null keeps extract; dek overlay applies", async () => {
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      generateIssueTitle: vi.fn().mockResolvedValue(null),
      generateIssueDek: vi.fn().mockResolvedValue(GENERATED_ISSUE_DEK),
    };

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: HAPPY_PATH_ISSUE_TITLE,
        issueDek: GENERATED_ISSUE_DEK,
      }),
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("13. both generators throw keep extract; do not markFailed; log generate-issue phases", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      generateIssueTitle: vi.fn().mockRejectedValue(new Error("title boom")),
      generateIssueDek: vi.fn().mockRejectedValue(new Error("dek boom")),
    };

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: HAPPY_PATH_ISSUE_TITLE,
        issueDek: HAPPY_PATH_ISSUE_DEK,
      }),
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();

    const phases = spy.mock.calls.map((call) => (call[0] as { phase?: string } | undefined)?.phase);
    expect(phases).toContain("generate-issue-title");
    expect(phases).toContain("generate-issue-dek");
    expect(phases).not.toContain("mark-completed-retry");

    const titleLog = spy.mock.calls.find(
      (call) => (call[0] as { phase?: string }).phase === "generate-issue-title",
    );
    expect(titleLog).toBeDefined();
    expect(titleLog![0]).toEqual(
      expect.objectContaining({
        phase: "generate-issue-title",
        runId: "run-1",
        message: expect.stringContaining("title boom"),
      }),
    );

    spy.mockRestore();
  });

  it("14. empty-draft fatal does not call generators", async () => {
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockResolvedValue({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: "empty-after-retry",
      attempts: 2,
    });

    await executeRun(client, "run-1", options);

    expect(options.generateIssueTitle).not.toHaveBeenCalled();
    expect(options.generateIssueDek).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "empty-after-retry",
    });
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("15. C5 complete-retry sends the same post-overlay strings on both attempts", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    const options: ExecuteRunOptions = {
      ...happyPathOptions(),
      generateIssueTitle: vi.fn().mockResolvedValue(GENERATED_ISSUE_TITLE),
      generateIssueDek: vi.fn().mockResolvedValue(GENERATED_ISSUE_DEK),
    };
    mocks.markCompleted
      .mockRejectedValueOnce(new Error("transient db error"))
      .mockResolvedValueOnce(makeRun({ status: "completed" }));

    await executeRun(client, "run-1", options);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).not.toHaveBeenCalled();
    const overlayed = {
      issueTitle: GENERATED_ISSUE_TITLE,
      issueDek: GENERATED_ISSUE_DEK,
    };
    expect(mocks.markCompleted).toHaveBeenNthCalledWith(
      1,
      client,
      "run-1",
      expect.objectContaining(overlayed),
    );
    expect(mocks.markCompleted).toHaveBeenNthCalledWith(
      2,
      client,
      "run-1",
      expect.objectContaining(overlayed),
    );
    expect(options.generateIssueTitle).toHaveBeenCalledTimes(1);
    expect(options.generateIssueDek).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("16. default path uses claim-time title/dek prompts and models.titleDek", async () => {
    const build = okBuildResult();
    mocks.buildPipelineConfigForNewsletter.mockResolvedValue({
      ...build,
      newsletter: { ...build.newsletter, titleDekModel: "vendor/title-dek-canary" },
    });

    const {
      generateIssueTitle: _omitTitle,
      generateIssueDek: _omitDek,
      ...options
    } = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.chatCompletion).toHaveBeenCalledTimes(2);
    const titleCall = mocks.chatCompletion.mock.calls[0]![0] as {
      model: string;
      messages: { role: string; content: string }[];
      extraBody?: { max_completion_tokens?: number };
    };
    const dekCall = mocks.chatCompletion.mock.calls[1]![0] as {
      model: string;
      messages: { role: string; content: string }[];
      extraBody?: { max_completion_tokens?: number };
    };
    expect(titleCall.model).toBe("vendor/title-dek-canary");
    expect(dekCall.model).toBe("vendor/title-dek-canary");
    expect(titleCall.messages[0]!.content).toContain(TITLE_PROMPT_CANARY);
    expect(titleCall.messages[0]!.content).toContain(HAPPY_PATH_MARKDOWN);
    expect(dekCall.messages[0]!.content).toContain(DEK_PROMPT_CANARY);
    expect(titleCall.extraBody?.max_completion_tokens).toBe(TITLE_DEK_MAX_COMPLETION_TOKENS);
    expect(dekCall.extraBody?.max_completion_tokens).toBe(TITLE_DEK_MAX_COMPLETION_TOKENS);
    expect(titleCall.extraBody?.max_completion_tokens).toBe(4000);
    expect(dekCall.extraBody?.max_completion_tokens).toBe(4000);

    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: "Canary Title",
        issueDek: "Canary dek here.",
      }),
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stage 15 Feature 04 Task 3: executeRun regenerate-draft branch (cases 9–17)
// ---------------------------------------------------------------------------

const REGENERATE_ENDED_AT = "2026-03-15T12:00:00.000Z";
const PREVIOUS_DRAFT_FILE_ID = "old-draft";

function stubRegenerateFixture() {
  mocks.getRun.mockResolvedValue(
    makeRun({
      status: "pending",
      completedPhase: "selection",
      endedAt: REGENERATE_ENDED_AT,
      checkpointDraftId: PREVIOUS_DRAFT_FILE_ID,
    }),
  );
  mocks.loadPhaseCheckpoint.mockResolvedValue({
    selectedArticles: SELECTED_ARTICLES,
  });
  mocks.savePhaseCheckpoint.mockResolvedValue(
    makeRun({ status: "running", checkpointDraftId: "new-draft" }),
  );
}

function lastStatusWriterIsRestore(): void {
  expect(mocks.restoreCompleted).toHaveBeenCalled();
  const restoreOrder = mocks.restoreCompleted.mock.invocationCallOrder[0];
  const failedOrders = mocks.markFailed.mock.invocationCallOrder;
  if (failedOrders.length > 0) {
    expect(restoreOrder).toBeGreaterThan(Math.max(...failedOrders));
  }
}

describe("executeRun — regenerate draft (Feature 04 Task 3)", () => {
  it("9. regenerator drafts once from selection, preserves endedAt, skips autoDeliver", async () => {
    stubRegenerateFixture();
    const options = happyPathOptions();
    options.generateIssueTitle = vi.fn().mockResolvedValue("Generated Title");
    options.generateIssueDek = vi.fn().mockResolvedValue("Generated dek sentence.");
    const deleteCheckpointFile = vi.fn().mockResolvedValue(undefined);

    await executeRun(client, "run-1", { ...options, deleteCheckpointFile });

    expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.tagger).not.toHaveBeenCalled();
    expect(options.scorer).not.toHaveBeenCalled();
    expect(options.selector).not.toHaveBeenCalled();
    expect(options.drafter!.draft).toHaveBeenCalledTimes(1);
    expect(options.drafter!.draft).toHaveBeenCalledWith(
      SELECTED_ARTICLES,
      "Test Newsletter",
      ["AI", "Climate"],
      SELECTED_ARTICLES.length,
      "",
    );
    expect(mocks.loadPhaseCheckpoint).toHaveBeenCalledWith(client, "run-1", "selection");
    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.savePhaseCheckpoint.mock.calls[0][2]).toBe("draft");
    expect(options.generateIssueTitle).toHaveBeenCalledTimes(1);
    expect(options.generateIssueDek).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({
        issueTitle: "Generated Title",
        issueDek: "Generated dek sentence.",
        endedAt: REGENERATE_ENDED_AT,
      }),
    );
    expect(options.autoDeliver).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.restoreCompleted).not.toHaveBeenCalled();
  });

  it("10. empty regenerate draft restores completed and does not markFailed", async () => {
    stubRegenerateFixture();
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockResolvedValue({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: "empty-after-retry",
      attempts: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, "run-1", {
      endedAt: REGENERATE_ENDED_AT,
    });
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.autoDeliver).not.toHaveBeenCalled();
  });

  it("11. savePhaseCheckpoint throw restores after any markFailed (not the final writer)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    stubRegenerateFixture();
    mocks.savePhaseCheckpoint.mockImplementation(async () => {
      await mocks.markFailed(client, "run-1", {
        failedPhase: "draft",
        failureMessage: "Failed to save draft checkpoint",
      });
      throw new Error("Failed to save draft checkpoint");
    });
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, "run-1", {
      endedAt: REGENERATE_ENDED_AT,
    });
    lastStatusWriterIsRestore();
    expect(options.autoDeliver).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("12. loadRunLlmResolution throw restores completed and does not markFailed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    stubRegenerateFixture();
    mocks.listPromptTemplates.mockRejectedValueOnce(new Error("Appwrite 401 secret-token-xyz"));
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, "run-1", {
      endedAt: REGENERATE_ENDED_AT,
    });
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.autoDeliver).not.toHaveBeenCalled();
    expect(options.drafter!.draft).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("13. resume-from-selection with endedAt null still autoDelivers (not a regenerate)", async () => {
    mocks.getRun.mockResolvedValue(makeRun({ completedPhase: "selection", endedAt: null }));
    mocks.loadPhaseCheckpoint.mockResolvedValue({
      selectedArticles: SELECTED_ARTICLES,
    });
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(options.autoDeliver).toHaveBeenCalledTimes(1);
    expect(options.autoDeliver).toHaveBeenCalledWith(client, "run-1");
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted.mock.calls[0][2]).not.toHaveProperty("endedAt");
    expect(mocks.restoreCompleted).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it("14. first-run empty draft still markFailed (not restore)", async () => {
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockResolvedValue({
      markdown: "",
      articleCount: 2,
      empty: true,
      reason: "empty-after-retry",
      attempts: 2,
    });

    await executeRun(client, "run-1", options);

    expect(mocks.markFailed).toHaveBeenCalledWith(client, "run-1", {
      failedPhase: "draft",
      failureMessage: "empty-after-retry",
    });
    expect(mocks.restoreCompleted).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });

  it("15. regenerator success best-effort deletes previousDraftFileId; throw still completes", async () => {
    stubRegenerateFixture();
    const deleteCheckpointFile = vi.fn().mockRejectedValue(new Error("storage down"));
    const options = happyPathOptions();

    await executeRun(client, "run-1", { ...options, deleteCheckpointFile });

    expect(deleteCheckpointFile).toHaveBeenCalledTimes(1);
    expect(deleteCheckpointFile).toHaveBeenCalledWith(client, PREVIOUS_DRAFT_FILE_ID);
    expect(mocks.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(
      client,
      "run-1",
      expect.objectContaining({ endedAt: REGENERATE_ENDED_AT }),
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(options.autoDeliver).not.toHaveBeenCalled();
  });

  it("16. drafter throw restores completed and does not markFailed (not the empty-draft path)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    stubRegenerateFixture();
    const options = happyPathOptions();
    (options.drafter!.draft as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("drafter exploded"),
    );

    await executeRun(client, "run-1", options);

    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, "run-1", {
      endedAt: REGENERATE_ENDED_AT,
    });
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.autoDeliver).not.toHaveBeenCalled();
    expect(mocks.savePhaseCheckpoint).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "regenerate-draft-abort",
        runId: "run-1",
        message: expect.stringMatching(/drafter exploded/),
      }),
    );

    spy.mockRestore();
  });

  it("regenerator OpenRouter key none restores completed and logs sanitized abort reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    stubRegenerateFixture();
    mocks.resolveOperatorSettings.mockResolvedValue(
      defaultOperatorSnapshot({
        openRouterApiKey: { value: null, source: "none" },
      }),
    );
    const options = happyPathOptions();

    await executeRun(client, "run-1", options);

    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, "run-1", {
      endedAt: REGENERATE_ENDED_AT,
    });
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(options.autoDeliver).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "regenerate-draft-abort",
        runId: "run-1",
        message: expect.stringMatching(/OpenRouter API key is not set/),
      }),
    );

    spy.mockRestore();
  });

  it("17. markCompleted double-fail restores completed and keeps the new checkpoint", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    stubRegenerateFixture();
    mocks.markCompleted.mockRejectedValue(new Error("db down"));
    const deleteCheckpointFile = vi.fn().mockResolvedValue(undefined);
    const options = happyPathOptions();

    await executeRun(client, "run-1", { ...options, deleteCheckpointFile });

    expect(mocks.savePhaseCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.savePhaseCheckpoint.mock.calls[0][2]).toBe("draft");
    expect(mocks.markCompleted).toHaveBeenCalledTimes(2);
    expect(mocks.restoreCompleted).toHaveBeenCalledWith(client, "run-1", {
      endedAt: REGENERATE_ENDED_AT,
    });
    lastStatusWriterIsRestore();
    expect(options.autoDeliver).not.toHaveBeenCalled();
    expect(deleteCheckpointFile).toHaveBeenCalledWith(client, PREVIOUS_DRAFT_FILE_ID);

    spy.mockRestore();
  });
});

