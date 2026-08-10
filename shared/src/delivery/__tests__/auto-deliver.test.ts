import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Client } from "node-appwrite";

import type { Newsletter } from "../../newsletters/types";
import { NewsletterRepositoryError } from "../../newsletters/types";
import type { Run } from "../../runs/types";
import { RunRepositoryError } from "../../runs/types";
import type { PublishIssueToRssResult, SendIssueEmailResult } from "../types";

// Intentionally imports a module that does not exist yet (Task 2).
// Cases 1–9 (incl. 5b / 6b) fail red for missing module / missing exports.
import { autoDeliverAfterSuccess } from "../auto-deliver";

const client = {} as Client;
const RUN_ID = "run-1";
const NEWSLETTER_ID = "nl-1";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: RUN_ID,
    newsletterId: NEWSLETTER_ID,
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
    $id: NEWSLETTER_ID,
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

const deps = {
  getRun: vi.fn(),
  getNewsletter: vi.fn(),
  sendIssueEmail: vi.fn(),
  publishIssueToRss: vi.fn(),
};

function baseOptions() {
  return {
    getRun: deps.getRun,
    getNewsletter: deps.getNewsletter,
    sendIssueEmail: deps.sendIssueEmail,
    publishIssueToRss: deps.publishIssueToRss,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.getRun.mockResolvedValue(makeRun());
  deps.getNewsletter.mockResolvedValue(makeNewsletter());
  deps.sendIssueEmail.mockResolvedValue({
    ok: true,
    recipientCount: 1,
  } satisfies SendIssueEmailResult);
  deps.publishIssueToRss.mockResolvedValue({
    ok: true,
    newsletterId: NEWSLETTER_ID,
    runId: RUN_ID,
  } satisfies PublishIssueToRssResult);
});

describe("autoDeliverAfterSuccess — both toggles off (case 1)", () => {
  it("calls neither send nor publish; both channels attempted: false", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: false, autoRss: false }),
    );

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.sendIssueEmail).not.toHaveBeenCalled();
    expect(deps.publishIssueToRss).not.toHaveBeenCalled();
    expect(result).toEqual({
      email: { attempted: false, ok: false },
      rss: { attempted: false, ok: false },
    });
  });
});

describe("autoDeliverAfterSuccess — email only (case 2)", () => {
  it("sends email once; does not publish; email attempted ok", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: false }),
    );

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.sendIssueEmail).toHaveBeenCalledTimes(1);
    expect(deps.sendIssueEmail).toHaveBeenCalledWith(client, RUN_ID);
    expect(deps.publishIssueToRss).not.toHaveBeenCalled();
    expect(result).toEqual({
      email: { attempted: true, ok: true },
      rss: { attempted: false, ok: false },
    });
  });
});

describe("autoDeliverAfterSuccess — RSS only (case 3)", () => {
  it("publishes once; does not send email; rss attempted ok", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: false, autoRss: true }),
    );

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.publishIssueToRss).toHaveBeenCalledTimes(1);
    expect(deps.publishIssueToRss).toHaveBeenCalledWith(client, RUN_ID);
    expect(deps.sendIssueEmail).not.toHaveBeenCalled();
    expect(result).toEqual({
      email: { attempted: false, ok: false },
      rss: { attempted: true, ok: true },
    });
  });
});

describe("autoDeliverAfterSuccess — both on success (case 4)", () => {
  it("calls email then publish in order; both attempted ok", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: true }),
    );

    const callOrder: string[] = [];
    deps.sendIssueEmail.mockImplementation(async () => {
      callOrder.push("email");
      return { ok: true, recipientCount: 1 } satisfies SendIssueEmailResult;
    });
    deps.publishIssueToRss.mockImplementation(async () => {
      callOrder.push("rss");
      return {
        ok: true,
        newsletterId: NEWSLETTER_ID,
        runId: RUN_ID,
      } satisfies PublishIssueToRssResult;
    });

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.sendIssueEmail).toHaveBeenCalledTimes(1);
    expect(deps.publishIssueToRss).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["email", "rss"]);
    expect(result).toEqual({
      email: { attempted: true, ok: true },
      rss: { attempted: true, ok: true },
    });
  });
});

describe("autoDeliverAfterSuccess — email soft-fail, RSS still runs (case 5)", () => {
  it("maps resolved { ok: false } to email failure; still publishes RSS", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: true }),
    );
    // Soft-fail: resolve with business failure — do NOT throw.
    deps.sendIssueEmail.mockResolvedValue({
      ok: false,
      error: "Failed to send email",
    } satisfies SendIssueEmailResult);

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.sendIssueEmail).toHaveBeenCalledTimes(1);
    expect(deps.publishIssueToRss).toHaveBeenCalledTimes(1);
    expect(result.email).toEqual({
      attempted: true,
      ok: false,
      error: "Failed to send email",
    });
    expect(result.rss).toEqual({ attempted: true, ok: true });
  });
});

describe("autoDeliverAfterSuccess — email throws, RSS still runs (case 5b)", () => {
  it("catches throw; sets email error from message; still publishes RSS", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: true }),
    );
    deps.sendIssueEmail.mockRejectedValue(new Error("SMTP connection refused"));

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.publishIssueToRss).toHaveBeenCalledTimes(1);
    expect(result.email).toEqual({
      attempted: true,
      ok: false,
      error: "SMTP connection refused",
    });
    expect(result.rss).toEqual({ attempted: true, ok: true });
  });
});

describe("autoDeliverAfterSuccess — RSS soft-fail after email success (case 6)", () => {
  it("maps resolved { ok: false } to rss failure; orchestrator still resolves", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: true }),
    );
    // Soft-fail: resolve with business failure — do NOT throw.
    deps.publishIssueToRss.mockResolvedValue({
      ok: false,
      error: "Failed to publish to RSS",
    } satisfies PublishIssueToRssResult);

    const result = await autoDeliverAfterSuccess(client, RUN_ID, baseOptions());

    expect(deps.sendIssueEmail).toHaveBeenCalledTimes(1);
    expect(deps.publishIssueToRss).toHaveBeenCalledTimes(1);
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(result.rss).toEqual({
      attempted: true,
      ok: false,
      error: "Failed to publish to RSS",
    });
  });
});

describe("autoDeliverAfterSuccess — RSS throws after email success (case 6b)", () => {
  it("catches throw; sets rss ok: false; orchestrator still resolves", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: true }),
    );
    deps.publishIssueToRss.mockRejectedValue(new Error("Appwrite upsert failed"));

    await expect(
      autoDeliverAfterSuccess(client, RUN_ID, baseOptions()),
    ).resolves.toEqual({
      email: { attempted: true, ok: true },
      rss: {
        attempted: true,
        ok: false,
        error: "Appwrite upsert failed",
      },
    });
  });
});

describe("autoDeliverAfterSuccess — getNewsletter failure (case 7)", () => {
  it("neither channel attempted; orchestrator resolves (does not throw)", async () => {
    deps.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    await expect(
      autoDeliverAfterSuccess(client, RUN_ID, baseOptions()),
    ).resolves.toEqual({
      email: { attempted: false, ok: false },
      rss: { attempted: false, ok: false },
    });
    expect(deps.sendIssueEmail).not.toHaveBeenCalled();
    expect(deps.publishIssueToRss).not.toHaveBeenCalled();
  });
});

describe("autoDeliverAfterSuccess — getRun failure (case 8)", () => {
  it("neither channel attempted; orchestrator resolves (does not throw)", async () => {
    deps.getRun.mockRejectedValue(new RunRepositoryError("not_found", "Run not found"));

    await expect(
      autoDeliverAfterSuccess(client, RUN_ID, baseOptions()),
    ).resolves.toEqual({
      email: { attempted: false, ok: false },
      rss: { attempted: false, ok: false },
    });
    expect(deps.getNewsletter).not.toHaveBeenCalled();
    expect(deps.sendIssueEmail).not.toHaveBeenCalled();
    expect(deps.publishIssueToRss).not.toHaveBeenCalled();
  });
});

describe("autoDeliverAfterSuccess — never throw (case 9)", () => {
  it("resolves with both ok: false even when both channel deps throw", async () => {
    deps.getNewsletter.mockResolvedValue(
      makeNewsletter({ autoEmail: true, autoRss: true }),
    );
    deps.sendIssueEmail.mockRejectedValue(new Error("email boom"));
    deps.publishIssueToRss.mockRejectedValue(new Error("rss boom"));

    await expect(
      autoDeliverAfterSuccess(client, RUN_ID, baseOptions()),
    ).resolves.toEqual({
      email: { attempted: true, ok: false, error: "email boom" },
      rss: { attempted: true, ok: false, error: "rss boom" },
    });
  });
});
