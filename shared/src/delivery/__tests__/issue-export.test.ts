import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Client } from "node-appwrite";

import type { Run } from "../../runs/types";
import { IssueLoadError } from "../../runs/issues";
import {
  draftMarkdownToEmailHtml,
  draftMarkdownToEmailText,
} from "../email-body";

const mocks = vi.hoisted(() => ({
  loadIssueDraft: vi.fn(),
}));

vi.mock("../../runs/issues", async (importActual) => {
  const actual = await importActual<typeof import("../../runs/issues")>();
  return {
    ...actual,
    loadIssueDraft: mocks.loadIssueDraft,
  };
});

// Intentionally imports a module that does not exist yet (Task 2).
// Cases 1–6 (incl. 4b) fail red for missing module / missing exports.
import { buildIssueExportFilename, prepareIssueExport } from "../issue-export";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildIssueExportFilename — happy path (case 1)", () => {
  it("slugifies name + UTC date + md extension", () => {
    expect(
      buildIssueExportFilename({
        newsletterName: "Tech Digest",
        dateIso: "2026-07-17T12:00:00.000Z",
        format: "md",
      }),
    ).toBe("tech-digest-2026-07-17.md");
  });
});

describe("buildIssueExportFilename — slug edges (case 2)", () => {
  it("collapses punctuation and spaces into single hyphens", () => {
    expect(
      buildIssueExportFilename({
        newsletterName: "  Tech & Digest!!!  ",
        dateIso: "2026-07-17T12:00:00.000Z",
        format: "html",
      }),
    ).toBe("tech-digest-2026-07-17.html");
  });

  it("falls back to newsletter when name is empty or symbol-only", () => {
    expect(
      buildIssueExportFilename({
        newsletterName: "",
        dateIso: "2026-07-17T08:30:00.000Z",
        format: "md",
      }),
    ).toBe("newsletter-2026-07-17.md");

    expect(
      buildIssueExportFilename({
        newsletterName: "!!!@@@###",
        dateIso: "2026-07-17T08:30:00.000Z",
        format: "html",
      }),
    ).toBe("newsletter-2026-07-17.html");
  });

  it("caps the slug portion at 48 characters", () => {
    const longName = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota";
    const filename = buildIssueExportFilename({
      newsletterName: longName,
      dateIso: "2026-03-05T00:00:00.000Z",
      format: "md",
    });

    expect(filename).toMatch(/^[a-z0-9-]{1,48}-2026-03-05\.md$/);
    const slug = filename.replace(/-2026-03-05\.md$/, "");
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.length).toBe(48);
  });
});

describe("prepareIssueExport — HTML parity (case 3)", () => {
  it("body equals draftMarkdownToEmailHtml and contentType is text/html", async () => {
    const markdown = `# Hello Digest

A paragraph with a [link](https://example.com/article).
`;
    const run = makeRun({
      newsletterName: "Tech Digest",
      endedAt: "2026-07-17T12:00:00.000Z",
    });
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });

    const payload = await prepareIssueExport(client, run.$id, "html");

    expect(payload.body).toBe(draftMarkdownToEmailHtml(markdown));
    expect(payload.contentType).toBe("text/html; charset=utf-8");
  });
});

describe("prepareIssueExport — MD parity (case 4)", () => {
  it("body equals draftMarkdownToEmailText and contentType is text/markdown", async () => {
    const markdown =
      "# Title\r\n\r\nA paragraph with **bold** and a [link](https://example.com).\r\n";
    const run = makeRun({
      newsletterName: "Tech Digest",
      endedAt: "2026-07-17T12:00:00.000Z",
    });
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });

    const payload = await prepareIssueExport(client, run.$id, "md");

    expect(payload.body).toBe(draftMarkdownToEmailText(markdown));
    expect(payload.contentType).toBe("text/markdown; charset=utf-8");
  });
});

describe("prepareIssueExport — filename wiring (case 4b)", () => {
  it("uses run.newsletterName + endedAt ?? startedAt via buildIssueExportFilename for md and html", async () => {
    const markdown = "# Wired Digest\n\nBody.";
    const run = makeRun({
      newsletterName: "Quantum Weekly Brief",
      startedAt: "2026-06-01T09:00:00.000Z",
      endedAt: "2026-07-17T15:30:00.000Z",
    });
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });

    const mdPayload = await prepareIssueExport(client, run.$id, "md");
    const htmlPayload = await prepareIssueExport(client, run.$id, "html");

    const dateIso = run.endedAt ?? run.startedAt;
    expect(mdPayload.filename).toBe(
      buildIssueExportFilename({
        newsletterName: run.newsletterName,
        dateIso,
        format: "md",
      }),
    );
    expect(htmlPayload.filename).toBe(
      buildIssueExportFilename({
        newsletterName: run.newsletterName,
        dateIso,
        format: "html",
      }),
    );
    // Must not hardcode a generic name when newsletterName is distinctive.
    expect(mdPayload.filename).toContain("quantum-weekly-brief");
    expect(mdPayload.filename).not.toMatch(/^newsletter-/);
    expect(htmlPayload.filename).toContain("quantum-weekly-brief");
  });

  it("falls back to startedAt when endedAt is null", async () => {
    const markdown = "# Fallback Date\n\nBody.";
    const run = makeRun({
      newsletterName: "Dawn Edition",
      startedAt: "2026-04-02T10:00:00.000Z",
      endedAt: null,
    });
    mocks.loadIssueDraft.mockResolvedValue({ run, markdown });

    const payload = await prepareIssueExport(client, run.$id, "md");

    expect(payload.filename).toBe(
      buildIssueExportFilename({
        newsletterName: run.newsletterName,
        dateIso: run.startedAt,
        format: "md",
      }),
    );
    expect(payload.filename).toBe("dawn-edition-2026-04-02.md");
  });
});

describe("prepareIssueExport — empty draft (case 5)", () => {
  it.each(["", "   ", "\n\t  \n"])(
    "rejects with Issue draft is empty for whitespace-only markdown (%j)",
    async (markdown) => {
      const run = makeRun();
      mocks.loadIssueDraft.mockResolvedValue({ run, markdown });

      await expect(prepareIssueExport(client, run.$id, "md")).rejects.toThrow(
        "Issue draft is empty",
      );
      await expect(prepareIssueExport(client, run.$id, "html")).rejects.toThrow(
        "Issue draft is empty",
      );
    },
  );
});

describe("prepareIssueExport — load failure (case 6)", () => {
  it("propagates IssueLoadError and does not invent a body", async () => {
    const loadError = new IssueLoadError("not_found", "Run not found");
    mocks.loadIssueDraft.mockRejectedValue(loadError);

    let caught: unknown;
    try {
      await prepareIssueExport(client, "missing-run", "md");
      expect.fail("expected prepareIssueExport to reject");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(IssueLoadError);
    expect(caught).toBe(loadError);
    expect(caught).not.toMatchObject({
      body: expect.anything(),
      contentType: expect.anything(),
      filename: expect.anything(),
    });
  });
});
