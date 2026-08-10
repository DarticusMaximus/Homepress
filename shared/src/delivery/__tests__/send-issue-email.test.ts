import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "node-appwrite";
import type { Transporter } from "nodemailer";

import type { Newsletter } from "../../newsletters/types";
import { NewsletterRepositoryError } from "../../newsletters/types";
import type { Run } from "../../runs/types";
import { IssueLoadError } from "../../runs/issues";

/** Distinctive value used only to assert it never leaks into error messages. */
const SMTP_PASSWORD_VALUE = "unit-test-smtp-password-do-not-leak";

const SMTP_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_SECURE",
] as const;

const DISPLAY_TITLE = "Weekly Tech Digest";

const mocks = vi.hoisted(() => ({
  loadIssueDraft: vi.fn(),
  getNewsletter: vi.fn(),
  resolveIssueDisplayTitle: vi.fn(),
  recordEmailDelivery: vi.fn(),
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

vi.mock("../record-delivery", () => ({
  recordEmailDelivery: mocks.recordEmailDelivery,
}));

import { sendIssueEmail } from "../send-issue-email";

const client = {} as Client;

function clearSmtpEnv(): void {
  for (const key of SMTP_ENV_KEYS) {
    delete process.env[key];
  }
}

function setRequiredSmtpEnv(
  overrides: Partial<Record<(typeof SMTP_ENV_KEYS)[number], string>> = {},
): void {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USERNAME = "sender@example.com";
  process.env.SMTP_PASSWORD = SMTP_PASSWORD_VALUE;
  process.env.SMTP_FROM = "Tech Digest <news@example.com>";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    process.env[key] = value;
  }
}

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
    recipientEmails: ["alice@example.com", "bob@example.org"],
    autoEmail: false,
    autoRss: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeMockTransport(sendMailImpl?: ReturnType<typeof vi.fn>) {
  const sendMail = sendMailImpl ?? vi.fn().mockResolvedValue({ messageId: "msg-1" });
  return {
    transport: { sendMail } as unknown as Transporter,
    sendMail,
  };
}

beforeEach(() => {
  clearSmtpEnv();
  setRequiredSmtpEnv();
  vi.clearAllMocks();
  mocks.resolveIssueDisplayTitle.mockReturnValue(DISPLAY_TITLE);
  mocks.recordEmailDelivery.mockResolvedValue(undefined);
});

afterEach(() => {
  clearSmtpEnv();
});

describe("sendIssueEmail — success (case 7)", () => {
  it("sends once with bcc=recipients, to=From, html+text, display-title subject; returns recipientCount 2", async () => {
    const markdown = "# Weekly Tech Digest\n\nHello world.";
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({ ok: true, recipientCount: 2 });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.from).toBe("Tech Digest <news@example.com>");
    expect(mail.to).toBe("Tech Digest <news@example.com>");
    expect(mail.bcc).toEqual(["alice@example.com", "bob@example.org"]);
    expect(mail.subject).toBe(DISPLAY_TITLE);
    expect(typeof mail.html).toBe("string");
    expect((mail.html as string).length).toBeGreaterThan(0);
    expect(typeof mail.text).toBe("string");
    expect((mail.text as string).length).toBeGreaterThan(0);
    expect(mocks.resolveIssueDisplayTitle).toHaveBeenCalledWith({
      markdown,
      newsletterName: run.newsletterName,
      dateIso: run.endedAt,
    });
  });
});

describe("sendIssueEmail — empty recipients (case 8)", () => {
  it("does not sendMail; returns No recipients configured for this newsletter", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter({ recipientEmails: [] }));

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "No recipients configured for this newsletter",
    });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("sendIssueEmail — newsletter load failure (case 8b)", () => {
  it("does not sendMail when getNewsletter throws not_found; returns Couldn’t load newsletter for sending", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "Couldn’t load newsletter for sending",
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not sendMail when getNewsletter throws appwrite; returns Couldn’t load newsletter for sending", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("appwrite", "Appwrite exploded"),
    );

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "Couldn’t load newsletter for sending",
    });
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("sendIssueEmail — missing SMTP (case 9)", () => {
  it("does not sendMail; surfaces config error naming the missing requirement", async () => {
    delete process.env.SMTP_HOST;
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "Missing required environment variable: SMTP_HOST",
    });
    expect(sendMail).not.toHaveBeenCalled();
    if (result.ok === false) {
      expect(result.error).not.toContain(SMTP_PASSWORD_VALUE);
    }
  });
});

describe("sendIssueEmail — draft load failure (case 10a)", () => {
  it("does not sendMail when loadIssueDraft throws IssueLoadError", async () => {
    mocks.loadIssueDraft.mockRejectedValue(
      new IssueLoadError("not_found", "Run not found"),
    );

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, "missing-run", { transport });

    expect(result).toEqual({
      ok: false,
      error: "Couldn’t load this issue for sending",
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(mocks.getNewsletter).not.toHaveBeenCalled();
  });
});

describe("sendIssueEmail — empty markdown (case 10b)", () => {
  it.each(["", "   ", "\n\t  \n"])(
    "does not sendMail when draft markdown is empty/whitespace (%j)",
    async (markdown) => {
      const run = makeRun();
      mocks.loadIssueDraft.mockResolvedValue({ run, markdown });
      mocks.getNewsletter.mockResolvedValue(makeNewsletter());

      const { transport, sendMail } = makeMockTransport();

      const result = await sendIssueEmail(client, run.$id, { transport });

      expect(result).toEqual({
        ok: false,
        error: "Issue draft is empty",
      });
      expect(sendMail).not.toHaveBeenCalled();
      expect(mocks.getNewsletter).not.toHaveBeenCalled();
    },
  );
});

describe("sendIssueEmail — SMTP transport failure (case 11)", () => {
  it("returns Failed to send email and never leaks the password", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const sendMail = vi
      .fn()
      .mockRejectedValue(new Error(`SMTP auth failed for ${SMTP_PASSWORD_VALUE}`));
    const { transport } = makeMockTransport(sendMail);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "Failed to send email",
    });
    if (result.ok === false) {
      expect(result.error).not.toContain(SMTP_PASSWORD_VALUE);
    }

    const logged = consoleError.mock.calls
      .map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");
    expect(logged).not.toContain(SMTP_PASSWORD_VALUE);

    consoleError.mockRestore();
  });
});

describe("sendIssueEmail — wires recordEmailDelivery (case 8)", () => {
  it("calls email recorder once on success with { ok: true }", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    const { transport } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({ ok: true, recipientCount: 2 });
    expect(mocks.recordEmailDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordEmailDelivery).toHaveBeenCalledWith(client, run.$id, { ok: true });
  });

  it("calls email recorder once on failure with { ok: false, error }", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter({ recipientEmails: [] }));
    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "No recipients configured for this newsletter",
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(mocks.recordEmailDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordEmailDelivery).toHaveBeenCalledWith(client, run.$id, {
      ok: false,
      error: "No recipients configured for this newsletter",
    });
  });

  it("keeps success when recorder rejects (persist isolation)", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    mocks.recordEmailDelivery.mockRejectedValue(
      new Error(`persist failed with key sk-secret-do-not-leak-1234567890`),
    );
    const { transport } = makeMockTransport();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({ ok: true, recipientCount: 2 });
    expect(mocks.recordEmailDelivery).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("sk-secret-do-not-leak-1234567890");

    consoleError.mockRestore();
  });
});