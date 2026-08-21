import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getNewsletter: vi.fn(),
  listAttachmentsForNewsletter: vi.fn(),
  createRun: vi.fn(),
  findActiveRunForNewsletter: vi.fn(),
  listActiveRunsForNewsletter: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock("../../newsletters/repository", () => ({
  getNewsletter: mocks.getNewsletter,
}));

vi.mock("../../newsletters/attachments", () => ({
  listAttachmentsForNewsletter: mocks.listAttachmentsForNewsletter,
}));

vi.mock("../repository", () => ({
  createRun: mocks.createRun,
  findActiveRunForNewsletter: mocks.findActiveRunForNewsletter,
  listActiveRunsForNewsletter: mocks.listActiveRunsForNewsletter,
  markFailed: mocks.markFailed,
}));

import { buildPipelineConfigForNewsletter, enqueueNewsletterRun } from "../start";
import { createNewsletterConfig } from "../../pipeline/types";
import { NewsletterRepositoryError } from "../../newsletters/types";
import type { Newsletter, AttachmentRecord } from "../../newsletters/types";
import type { Run } from "../types";
import type { Client } from "node-appwrite";

const client = {} as Client;

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    $id: "nl-1",
    name: "Test Newsletter",
    topics: ["AI", "Climate"],
    dislikedTopics: ["Crypto"],
    audience: "Engineers",
    newsItems: 10,
    dateRange: "last_3_days",
    lookback: 3,
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
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
    updatedAt: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    $id: "att-1",
    attachmentId: "att-1",
    newsletterId: "nl-1",
    feedId: "feed-1",
    feedName: "Feed 1",
    feedUrl: "https://example.com/feed.xml",
    feedStatus: "ok",
    createdAt: "2024-01-01T00:00:00.000Z",
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildPipelineConfigForNewsletter
// ---------------------------------------------------------------------------

describe("buildPipelineConfigForNewsletter", () => {
  it("returns 'Newsletter not found' when getNewsletter throws not_found", async () => {
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const result = await buildPipelineConfigForNewsletter(client, "missing-id");

    expect(result).toEqual({ ok: false, error: "Newsletter not found" });
    expect(mocks.listAttachmentsForNewsletter).not.toHaveBeenCalled();
  });

  it("propagates Appwrite-level errors from getNewsletter", async () => {
    mocks.getNewsletter.mockRejectedValue(new NewsletterRepositoryError("appwrite", "DB down"));

    await expect(buildPipelineConfigForNewsletter(client, "nl-1")).rejects.toThrow(
      NewsletterRepositoryError,
    );
  });

  it("returns topic error when topics array is empty", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter({ topics: [] }));

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Add at least one topic before generating",
    });
  });

  it("returns topic error when all topics are whitespace-only", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter({ topics: ["   ", "", "\t"] }));

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Add at least one topic before generating",
    });
  });

  it("returns feed error when newsletter has no attachments", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
  });

  it("returns feed error when all attachments are failed", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([
      makeAttachment({ feedStatus: "failed", feedUrl: "https://a.com/rss" }),
    ]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
  });

  it("returns feed error when all attachments are untested", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([
      makeAttachment({ feedStatus: "untested", feedUrl: "https://a.com/rss" }),
    ]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
  });

  it("returns ok with empty feeds when requireOkFeeds: false and no ok feeds", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1", {
      requireOkFeeds: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feedUrls).toEqual([]);
    expect(result.config.feeds).toEqual([]);
    expect(result.config.topics).toEqual(["AI", "Climate"]);
  });

  it("returns ok with ok feeds when requireOkFeeds: false and some ok feeds exist", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([
      makeAttachment({ feedUrl: "https://ok.com/rss" }),
    ]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1", {
      requireOkFeeds: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feedUrls).toEqual(["https://ok.com/rss"]);
    expect(result.config.feeds).toEqual(["https://ok.com/rss"]);
  });

  it("returns feed error with default opts when no ok feeds (requireOkFeeds defaults to true)", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
  });

  it("filters to ok-only feed URLs when mix of ok + failed", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([
      makeAttachment({
        $id: "att-1",
        attachmentId: "att-1",
        feedStatus: "ok",
        feedUrl: "https://ok-a.com/rss",
      }),
      makeAttachment({
        $id: "att-2",
        attachmentId: "att-2",
        feedStatus: "failed",
        feedUrl: "https://fail-b.com/rss",
      }),
      makeAttachment({
        $id: "att-3",
        attachmentId: "att-3",
        feedStatus: "ok",
        feedUrl: "https://ok-c.com/rss",
      }),
    ]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feedUrls).toEqual(["https://ok-a.com/rss", "https://ok-c.com/rss"]);
    expect(result.config.feeds).toEqual(["https://ok-a.com/rss", "https://ok-c.com/rss"]);
  });

  it("happy path: config matches createNewsletterConfig with newsletter fields", async () => {
    const newsletter = makeNewsletter();
    mocks.getNewsletter.mockResolvedValue(newsletter);
    mocks.listAttachmentsForNewsletter.mockResolvedValue([
      makeAttachment({ feedUrl: "https://a.com/rss" }),
      makeAttachment({
        $id: "att-2",
        attachmentId: "att-2",
        feedUrl: "https://b.com/rss",
      }),
    ]);

    const result = await buildPipelineConfigForNewsletter(client, "nl-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedConfig = createNewsletterConfig({
      name: newsletter.name,
      topics: newsletter.topics,
      dislikedTopics: newsletter.dislikedTopics,
      audience: newsletter.audience,
      newsItems: newsletter.newsItems,
      dateRange: newsletter.dateRange,
      feeds: ["https://a.com/rss", "https://b.com/rss"],
    });
    expect(result.config).toEqual(expectedConfig);
    expect(result.newsletter).toEqual(newsletter);
    expect(result.feedUrls).toEqual(["https://a.com/rss", "https://b.com/rss"]);
  });
});

// ---------------------------------------------------------------------------
// enqueueNewsletterRun
// ---------------------------------------------------------------------------

describe("enqueueNewsletterRun", () => {
  function setupValidNewsletter() {
    const newsletter = makeNewsletter();
    mocks.getNewsletter.mockResolvedValue(newsletter);
    mocks.listAttachmentsForNewsletter.mockResolvedValue([
      makeAttachment({ feedUrl: "https://ok.com/rss" }),
    ]);
    return newsletter;
  }

  it("returns validation error and never creates a run when topics are empty", async () => {
    mocks.getNewsletter.mockResolvedValue(makeNewsletter({ topics: [] }));

    const result = await enqueueNewsletterRun(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Add at least one topic before generating",
    });
    // Case 3: non-busy failures must not carry already_in_progress
    expect(result).not.toHaveProperty("code", "already_in_progress");
    expect(mocks.findActiveRunForNewsletter).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("returns already-in-progress error when an active run exists (pre-guard)", async () => {
    setupValidNewsletter();
    mocks.findActiveRunForNewsletter.mockResolvedValue(makeRun({ $id: "existing-run" }));

    const result = await enqueueNewsletterRun(client, "nl-1");

    // Case 1: pre-create busy → stable code
    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
      code: "already_in_progress",
    });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("succeeds with runId when sole active run after create", async () => {
    const newsletter = setupValidNewsletter();
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    const createdRun = makeRun({ $id: "new-run" });
    mocks.createRun.mockResolvedValue(createdRun);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([createdRun]);

    const result = await enqueueNewsletterRun(client, "nl-1");

    expect(result).toEqual({ ok: true, runId: "new-run" });
    // Feature 06 Task 1 case 5 — default enqueue writes trigger manual.
    expect(mocks.createRun).toHaveBeenCalledWith(client, {
      newsletterId: "nl-1",
      newsletterName: newsletter.name,
      trigger: "manual",
    });
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  // Feature 06 Task 1 case 6 — explicit scheduled opts pass through to createRun.
  it("passes trigger scheduled to createRun when opts.request scheduled", async () => {
    const newsletter = setupValidNewsletter();
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    const createdRun = makeRun({ $id: "scheduled-run" });
    mocks.createRun.mockResolvedValue(createdRun);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([createdRun]);

    // Task 1: opts land in Task 3 — call with third arg via cast so the suite loads.
    const enqueueWithOpts = enqueueNewsletterRun as (
      c: Client,
      id: string,
      opts?: { trigger?: string },
    ) => ReturnType<typeof enqueueNewsletterRun>;
    const result = await enqueueWithOpts(client, "nl-1", { trigger: "scheduled" });

    expect(result).toEqual({ ok: true, runId: "scheduled-run" });
    expect(mocks.createRun).toHaveBeenCalledWith(client, {
      newsletterId: "nl-1",
      newsletterName: newsletter.name,
      trigger: "scheduled",
    });
  });

  it("race lost: marks created run as failed and returns error when not oldest", async () => {
    setupValidNewsletter();
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    const ourRun = makeRun({
      $id: "our-run",
      startedAt: "2024-01-01T11:00:00.000Z",
    });
    const olderRun = makeRun({
      $id: "older-run",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    mocks.createRun.mockResolvedValue(ourRun);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([olderRun, ourRun]);

    const result = await enqueueNewsletterRun(client, "nl-1");

    // Case 2: race cleanup busy → same stable code
    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
      code: "already_in_progress",
    });
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "our-run", {
      failedPhase: "fetch",
      failureMessage: "Superseded by a concurrent start",
    });
  });

  it("race won: marks newer runs as failed and succeeds when created run is oldest", async () => {
    setupValidNewsletter();
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    const ourRun = makeRun({
      $id: "our-run",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const newerRun = makeRun({
      $id: "newer-run",
      startedAt: "2024-01-01T11:00:00.000Z",
    });
    mocks.createRun.mockResolvedValue(ourRun);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([ourRun, newerRun]);

    const result = await enqueueNewsletterRun(client, "nl-1");

    expect(result).toEqual({ ok: true, runId: "our-run" });
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(client, "newer-run", {
      failedPhase: "fetch",
      failureMessage: "Superseded by a concurrent start",
    });
  });

  it("race with three actives: marks all after first, fails when created run is newest", async () => {
    setupValidNewsletter();
    mocks.findActiveRunForNewsletter.mockResolvedValue(null);
    const oldest = makeRun({
      $id: "oldest",
      startedAt: "2024-01-01T09:00:00.000Z",
    });
    const middle = makeRun({
      $id: "middle",
      startedAt: "2024-01-01T10:00:00.000Z",
    });
    const ours = makeRun({
      $id: "ours",
      startedAt: "2024-01-01T11:00:00.000Z",
    });
    mocks.createRun.mockResolvedValue(ours);
    mocks.listActiveRunsForNewsletter.mockResolvedValue([oldest, middle, ours]);

    const result = await enqueueNewsletterRun(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "A run is already in progress for this newsletter",
      code: "already_in_progress",
    });
    expect(mocks.markFailed).toHaveBeenCalledTimes(2);
    expect(mocks.markFailed).toHaveBeenNthCalledWith(1, client, "middle", {
      failedPhase: "fetch",
      failureMessage: "Superseded by a concurrent start",
    });
    expect(mocks.markFailed).toHaveBeenNthCalledWith(2, client, "ours", {
      failedPhase: "fetch",
      failureMessage: "Superseded by a concurrent start",
    });
  });

  it("non-busy failure omits already_in_progress code (no healthy feeds)", async () => {
    // Case 3: validation / feed failure must not look like busy-skip
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.listAttachmentsForNewsletter.mockResolvedValue([]);

    const result = await enqueueNewsletterRun(client, "nl-1");

    expect(result).toEqual({
      ok: false,
      error: "Attach at least one healthy (ok) feed before generating",
    });
    expect(result).not.toHaveProperty("code", "already_in_progress");
    expect(mocks.findActiveRunForNewsletter).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("newsletter not found: returns error and never checks active runs", async () => {
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const result = await enqueueNewsletterRun(client, "missing");

    expect(result).toEqual({ ok: false, error: "Newsletter not found" });
    expect(result).not.toHaveProperty("code", "already_in_progress");
    expect(mocks.findActiveRunForNewsletter).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});
