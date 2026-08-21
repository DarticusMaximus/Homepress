import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "node-appwrite";
import type { Transporter } from "nodemailer";

import type { Newsletter } from "../../newsletters/types";
import { NewsletterRepositoryError } from "../../newsletters/types";
import type { Run } from "../../runs/types";
import { IssueLoadError } from "../../runs/issues";
import type { SmtpConfig } from "../smtp-config";
import type { ResolvedOperatorSettings } from "../../settings/resolve-operator-settings";

/**
 * Short / special-char fixtures that do NOT match sanitizeAppwriteMessageForLog's
 * LONG_RUN heuristic — N2: logs must stay secret-safe without relying on length.
 */
const SMTP_PASSWORD_VALUE = "hunter2";
const GUI_SMTP_PASSWORD_VALUE = "P@ssw0rd!";

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
  resolveOperatorSettings: vi.fn(),
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

vi.mock("../../settings/resolve-operator-settings", () => ({
  resolveOperatorSettings: mocks.resolveOperatorSettings,
}));

import { sendIssueEmail } from "../send-issue-email";

const client = {} as Client;

function clearSmtpEnv(): void {
  for (const key of SMTP_ENV_KEYS) {
    delete process.env[key];
  }
}

function envSmtpConfig(
  overrides: Partial<SmtpConfig> = {},
): SmtpConfig {
  return {
    host: "smtp.example.com",
    port: 587,
    username: "sender@example.com",
    password: SMTP_PASSWORD_VALUE,
    from: "Tech Digest <news@example.com>",
    secure: false,
    ...overrides,
  };
}

function baseResolved(
  overrides: Partial<ResolvedOperatorSettings> = {},
): ResolvedOperatorSettings {
  return {
    openRouterApiKey: { value: null, source: "none" },
    smtp: { value: envSmtpConfig(), source: "env" },
    appPublicUrl: { value: null, source: "none" },
    scoreThreshold: { value: 5, source: "default" },
    crossRunSimilarityThreshold: { value: 0.85, source: "default" },
    rssFeedMaxItems: { value: 10, source: "default" },
    drafterReasoningEffort: { value: "high", source: "default" },
    drafterMaxCompletionTokens: { value: 32000, source: "default" },
    ...overrides,
  };
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
    issueTitle: "",
    issueDek: "",
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
    titleDekModel: "",
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
  mocks.resolveOperatorSettings.mockResolvedValue(baseResolved());
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
      issueTitle: run.issueTitle,
    });
  });
});

describe("sendIssueEmail — stored issueTitle passthrough (case 17)", () => {
  it("calls resolveIssueDisplayTitle with issueTitle from the run; subject stays the mock return", async () => {
    const markdown = "# Lead Story\n\nHello world.";
    const run = makeRun({ issueTitle: "Digest Name" });
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({ ok: true, recipientCount: 2 });
    expect(mocks.resolveIssueDisplayTitle).toHaveBeenCalledWith({
      markdown,
      newsletterName: run.newsletterName,
      dateIso: run.endedAt,
      issueTitle: run.issueTitle,
    });
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.subject).toBe(DISPLAY_TITLE);
    expect(typeof mail.html).toBe("string");
    expect((mail.html as string).length).toBeGreaterThan(0);
    expect(typeof mail.text).toBe("string");
    expect((mail.text as string).length).toBeGreaterThan(0);
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
  it("does not sendMail when smtp source is none; clear message never leaks password", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        smtp: { value: null, source: "none" },
      }),
    );
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.toLowerCase()).toMatch(/smtp/);
      expect(result.error).not.toContain(SMTP_PASSWORD_VALUE);
      expect(result.error).not.toContain(GUI_SMTP_PASSWORD_VALUE);
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledWith(client);
  });
});

describe("sendIssueEmail — resolved SMTP cascade", () => {
  it("uses GUI SMTP bundle over env for From / transport fields", async () => {
    const guiSmtp: SmtpConfig = {
      host: "smtp.gui.example",
      port: 465,
      username: "gui@example.com",
      password: GUI_SMTP_PASSWORD_VALUE,
      from: "GUI Digest <gui@example.com>",
      secure: true,
    };
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        smtp: { value: guiSmtp, source: "gui" },
      }),
    );

    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({ ok: true, recipientCount: 2 });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.from).toBe("GUI Digest <gui@example.com>");
    expect(mail.to).toBe("GUI Digest <gui@example.com>");
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledWith(client);
  });

  it("uses env-resolved SMTP when GUI bundle is absent", async () => {
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        smtp: { value: envSmtpConfig(), source: "env" },
      }),
    );

    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());
    const { transport, sendMail } = makeMockTransport();

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({ ok: true, recipientCount: 2 });
    const mail = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(mail.from).toBe("Tech Digest <news@example.com>");
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledWith(client);
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
  it("returns Failed to send email and never leaks short env password in logs", async () => {
    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const sendMail = vi
      .fn()
      .mockRejectedValue(
        new Error(`Invalid login: username=sender@example.com password=${SMTP_PASSWORD_VALUE}`),
      );
    const { transport } = makeMockTransport(sendMail);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "Failed to send email",
    });
    if (result.ok === false) {
      expect(result.error).not.toContain(SMTP_PASSWORD_VALUE);
      expect(result.error).not.toContain(GUI_SMTP_PASSWORD_VALUE);
    }

    const logged = consoleError.mock.calls
      .map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");
    expect(logged).not.toContain(SMTP_PASSWORD_VALUE);
    expect(logged).not.toContain(GUI_SMTP_PASSWORD_VALUE);

    consoleError.mockRestore();
  });

  it("never leaks special-char GUI password echoed in transport Error", async () => {
    const guiSmtp: SmtpConfig = {
      host: "smtp.gui.example",
      port: 465,
      username: "gui@example.com",
      password: GUI_SMTP_PASSWORD_VALUE,
      from: "GUI Digest <gui@example.com>",
      secure: true,
    };
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        smtp: { value: guiSmtp, source: "gui" },
      }),
    );

    const run = makeRun();
    mocks.loadIssueDraft.mockResolvedValue({
      run,
      markdown: "# Title\n\nBody.",
    });
    mocks.getNewsletter.mockResolvedValue(makeNewsletter());

    const sendMail = vi
      .fn()
      .mockRejectedValue(
        new Error(
          `535 Authentication failed for user=gui@example.com pass=${GUI_SMTP_PASSWORD_VALUE}`,
        ),
      );
    const { transport } = makeMockTransport(sendMail);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendIssueEmail(client, run.$id, { transport });

    expect(result).toEqual({
      ok: false,
      error: "Failed to send email",
    });
    if (result.ok === false) {
      expect(result.error).not.toContain(GUI_SMTP_PASSWORD_VALUE);
      expect(result.error).not.toContain(SMTP_PASSWORD_VALUE);
    }

    const logged = consoleError.mock.calls
      .map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
      .join("\n");
    expect(logged).not.toContain(GUI_SMTP_PASSWORD_VALUE);
    expect(logged).not.toContain(SMTP_PASSWORD_VALUE);
    expect(logged).not.toContain("gui@example.com");

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