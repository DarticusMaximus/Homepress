import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Client } from "node-appwrite";

import type { Newsletter } from "../../newsletters/types";
import { NewsletterRepositoryError } from "../../newsletters/types";
import type { Run } from "../../runs/types";
import { IssueLoadError } from "../../runs/issues";
import type { RssPublication } from "../rss-publications";

/** Distinctive value used only to assert it never leaks into error messages. */
const SECRET_VALUE = "unit-test-appwrite-secret-do-not-leak";

const DISPLAY_TITLE = "Weekly Tech Digest";
const HTML_BODY = "<h1>Weekly Tech Digest</h1><p>Hello world.</p>";

const mocks = vi.hoisted(() => ({
  loadIssueDraft: vi.fn(),
  getNewsletter: vi.fn(),
  resolveIssueDisplayTitle: vi.fn(),
  draftMarkdownToEmailHtml: vi.fn(),
  upsertRssPublication: vi.fn(),
  trimRssPublications: vi.fn(),
  recordRssDelivery: vi.fn(),
}));

vi.mock("../../runs/issues", async (importActual) => {
  const actual = await importActual<typeof import("../../runs/issues")>();
  return {
    ...actual,
    loadIssueDraft: mocks.loadIssueDraft,
    resolveIssueDisplayTitle: mocks.resolveIssueDisplayTitle,
  };
});

vi.mock("../../newsletters/repository", () => ({
  getNewsletter: mocks.getNewsletter,
}));

vi.mock("../email-body", () => ({
  draftMarkdownToEmailHtml: mocks.draftMarkdownToEmailHtml,
}));

vi.mock("../rss-publications", async (importActual) => {
  const actual = await importActual<typeof import("../rss-publications")>();
  return {
    ...actual,
    upsertRssPublication: mocks.upsertRssPublication,
    trimRssPublications: mocks.trimRssPublications,
  };
});

vi.mock("../record-delivery", () => ({
  recordRssDelivery: mocks.recordRssDelivery,
}));

import { publishIssueToRss } from "../publish-issue-to-rss";

const client = {} as Client;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Tech Digest",
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    startedAt: "2026-07-01T10:00:00.000Z",
    endedAt: "2026-07-01T11:00:00.000Z",
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "draft-file-id",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    ...overrides,
  };
}

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    $id: "nl-1",
    name: "Tech Digest",
    topics: ["AI"],
    dislikedTopics: [],
    audience: "Engineers",
    newsItems: 10,
    dateRange: "last_3_days",
    lookback: 3,
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    drafterPrompt: "",
    scheduleEnabled: false,
    scheduleCron: "",
    scheduleTimezone: "UTC",
    scheduleLastFiredAt: null,
    recipientEmails: ["alice@example.com"],
    autoEmail: false,
    autoRss: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makePublication(overrides: Partial<RssPublication> = {}): RssPublication {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    runId: "run-1",
    title: DISPLAY_TITLE,
    htmlBody: HTML_BODY,
    pubDate: "2026-07-01T11:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveIssueDisplayTitle.mockReturnValue(DISPLAY_TITLE);
  mocks.draftMarkdownToEmailHtml.mockReturnValue(HTML_BODY);
  mocks.upsertRssPublication.mockResolvedValue(makePublication());
  mocks.trimRssPublications.mockResolvedValue(undefined);
  mocks.recordRssDelivery.mockResolvedValue(undefined);
});

describe("publishIssueToRss — success (case 10)", () => {
  it("upserts snapshot and trims; returns newsletterId + runId", async () => {
    const markdown = "# Weekly Tech Digest\n\nHello world.";
    const run = makeRun();
    const newsletter = makeNewsletter();
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });
    mocks.getNewsletter.mockResolvedValue(newsletter);

    const result = await publishIssueToRss(client, run.$id);

    expect(result).toEqual({
      ok: true,
      newsletterId: "nl-1",
      runId: "run-1",
    });
    expect(mocks.resolveIssueDisplayTitle).toHaveBeenCalledWith({
      markdown,
      newsletterName: newsletter.name,
      dateIso: run.endedAt,
    });
    expect(mocks.draftMarkdownToEmailHtml).toHaveBeenCalledWith(markdown);
    expect(mocks.upsertRssPublication).toHaveBeenCalledTimes(1);
    expect(mocks.upsertRssPublication).toHaveBeenCalledWith(client, {
      newsletterId: "nl-1",
      runId: "run-1",
      title: DISPLAY_TITLE,
      htmlBody: HTML_BODY,
      pubDate: run.endedAt,
    });
    expect(mocks.trimRssPublications).toHaveBeenCalledTimes(1);
    expect(mocks.trimRssPublications).toHaveBeenCalledWith(client, "nl-1");
  });
});

describe("publishIssueToRss — republish (case 11)", () => {
  it("second call same runId still succeeds and upserts again", async () => {
    const markdown = "# Weekly Tech Digest\n\nHello world.";
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const first = await publishIssueToRss(client, run.$id);
    const second = await publishIssueToRss(client, run.$id);

    expect(first).toEqual({ ok: true, newsletterId: "nl-1", runId: "run-1" });
    expect(second).toEqual({ ok: true, newsletterId: "nl-1", runId: "run-1" });
    expect(mocks.upsertRssPublication).toHaveBeenCalledTimes(2);
    expect(mocks.trimRssPublications).toHaveBeenCalledTimes(2);
    expect(mocks.upsertRssPublication.mock.calls[0]![1]).toMatchObject({ runId: "run-1" });
    expect(mocks.upsertRssPublication.mock.calls[1]![1]).toMatchObject({ runId: "run-1" });
  });
});

describe("publishIssueToRss — missing endedAt (case 12)", () => {
  it.each([null, "", "   "] as const)(
    "does not write when endedAt is %j; returns Issue is missing an end time",
    async (endedAt) => {
      const run = makeRun({ endedAt: endedAt as Run["endedAt"] });
      mocks.loadIssueDraft.mockResolvedValue({
        run,
        markdown: "# Title\n\nBody.",
      });
      mocks.getNewsletter.mockResolvedValue(makeNewsletter());

      const result = await publishIssueToRss(client, run.$id);

      expect(result).toEqual({
        ok: false,
        error: "Issue is missing an end time",
      });
      expect(mocks.upsertRssPublication).not.toHaveBeenCalled();
      expect(mocks.trimRssPublications).not.toHaveBeenCalled();
      expect(mocks.getNewsletter).not.toHaveBeenCalled();
    },
  );
});

describe("publishIssueToRss — empty draft / load failure / newsletter failure (case 13)", () => {
  it("does not write when loadIssueDraft throws IssueLoadError", async () => {
    mocks.loadIssueDraft.mockRejectedValue(
      new IssueLoadError("not_found", "Run not found"),
    );

    const result = await publishIssueToRss(client, "missing-run");

    expect(result).toEqual({
      ok: false,
      error: "Couldn’t load this issue for publishing",
    });
    expect(mocks.upsertRssPublication).not.toHaveBeenCalled();
    expect(mocks.trimRssPublications).not.toHaveBeenCalled();
    expect(mocks.getNewsletter).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "\n\t  \n"])(
    "does not write when draft markdown is empty/whitespace (%j)",
    async (markdown) => {
      const run = makeRun();
      mocks.loadIssueDraft.mockResolvedValue({ run, markdown });
      mocks.getNewsletter.mockResolvedValue(makeNewsletter());

      const result = await publishIssueToRss(client, run.$id);

      expect(result).toEqual({
        ok: false,
        error: "Issue draft is empty",
      });
      expect(mocks.upsertRssPublication).not.toHaveBeenCalled();
      expect(mocks.trimRssPublications).not.toHaveBeenCalled();
      expect(mocks.getNewsletter).not.toHaveBeenCalled();
    },
  );

  it("does not write when getNewsletter throws; returns Couldn’t load newsletter for publishing", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const result = await publishIssueToRss(client, run.$id);

    expect(result).toEqual({
      ok: false,
      error: "Couldn’t load newsletter for publishing",
    });
    expect(mocks.upsertRssPublication).not.toHaveBeenCalled();
    expect(mocks.trimRssPublications).not.toHaveBeenCalled();
  });
});

describe("publishIssueToRss — Appwrite failure (case 14)", () => {
  it("returns Failed to publish to RSS and never leaks secrets", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.upsertRssPublication.mockRejectedValue(
      new Error(`Appwrite write failed for ${SECRET_VALUE}`),
    );

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await publishIssueToRss(client, run.$id);

    expect(result).toEqual({
      ok: false,
      error: "Failed to publish to RSS",
    });
    if (result.ok === false) {
      expect(result.error).not.toContain(SECRET_VALUE);
    }

    const logged = consoleError.mock.calls
      .map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");
    expect(logged).not.toContain(SECRET_VALUE);

    consoleError.mockRestore();
  });
});

describe("publishIssueToRss — wires recordRssDelivery (case 9)", () => {
  it("calls RSS recorder once on success with { ok: true }", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const result = await publishIssueToRss(client, run.$id);

    expect(result).toEqual({ ok: true, newsletterId: "nl-1", runId: "run-1" });
    expect(mocks.recordRssDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordRssDelivery).toHaveBeenCalledWith(client, run.$id, { ok: true });
  });

  it("calls RSS recorder once on failure with { ok: false, error }", async () => {
    const run = makeRun({ endedAt: null });
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });

    const result = await publishIssueToRss(client, run.$id);

    expect(result).toEqual({
      ok: false,
      error: "Issue is missing an end time",
    });
    expect(mocks.upsertRssPublication).not.toHaveBeenCalled();
    expect(mocks.recordRssDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordRssDelivery).toHaveBeenCalledWith(client, run.$id, {
      ok: false,
      error: "Issue is missing an end time",
    });
  });

  it("keeps success when recorder rejects (persist isolation)", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.recordRssDelivery.mockRejectedValue(
      new Error(`persist failed with key sk-secret-do-not-leak-1234567890`),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await publishIssueToRss(client, run.$id);

    expect(result).toEqual({ ok: true, newsletterId: "nl-1", runId: "run-1" });
    expect(mocks.recordRssDelivery).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("sk-secret-do-not-leak-1234567890");

    consoleError.mockRestore();
  });
});
