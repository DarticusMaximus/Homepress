import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import type { Run } from "../types";
import { RunRepositoryError } from "../types";

// ---------------------------------------------------------------------------
// Mocks for listIssues / loadIssueDraft repository deps
// ---------------------------------------------------------------------------

const mockHolder = vi.hoisted(() => ({
  listRuns: vi.fn(),
  getRun: vi.fn(),
  loadPhaseCheckpoint: vi.fn(),
}));

vi.mock("../repository", () => ({
  listRuns: mockHolder.listRuns,
  getRun: mockHolder.getRun,
  loadPhaseCheckpoint: mockHolder.loadPhaseCheckpoint,
}));

// Import after mocks are in place
import {
  listIssues,
  formatIssueFallbackTitle,
  extractFirstMarkdownHeading,
  resolveIssueDisplayTitle,
  resolveIssueDisplayTitlesForRuns,
  isEligibleIssue,
  loadIssueDraft,
  IssueLoadError,
} from "../issues";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> & Pick<Run, "$id" | "newsletterId">): Run {
  return {
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    newsletterName: "Test",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T01:00:00.000Z",
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

const fakeClient = {} as Client;

beforeEach(() => {
  mockHolder.listRuns.mockReset();
  mockHolder.getRun.mockReset();
  mockHolder.loadPhaseCheckpoint.mockReset();
});

// ===========================================================================
// listIssues — eligibility
// ===========================================================================

describe("listIssues eligibility", () => {
  it("includes completed runs with non-empty checkpointDraftId", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({ $id: "r1", newsletterId: "nl-a", checkpointDraftId: "draft-1" }),
    ]);

    const result = await listIssues(fakeClient);

    expect(result.map((r) => r.$id)).toEqual(["r1"]);
  });

  it("excludes completed runs with empty or whitespace-only checkpointDraftId", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({ $id: "empty", newsletterId: "nl-a", checkpointDraftId: "" }),
      makeRun({ $id: "ws", newsletterId: "nl-a", checkpointDraftId: "   " }),
      makeRun({ $id: "ok", newsletterId: "nl-a", checkpointDraftId: " draft-ok " }),
    ]);

    const result = await listIssues(fakeClient);

    expect(result.map((r) => r.$id)).toEqual(["ok"]);
  });

  it("excludes pending / running / failed even when a draft id is set", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({
        $id: "pending",
        newsletterId: "nl-a",
        status: "pending",
        checkpointDraftId: "draft-p",
      }),
      makeRun({
        $id: "running",
        newsletterId: "nl-a",
        status: "running",
        checkpointDraftId: "draft-r",
      }),
      makeRun({
        $id: "failed",
        newsletterId: "nl-a",
        status: "failed",
        checkpointDraftId: "draft-f",
      }),
      makeRun({
        $id: "done",
        newsletterId: "nl-a",
        status: "completed",
        checkpointDraftId: "draft-c",
      }),
    ]);

    const result = await listIssues(fakeClient);

    expect(result.map((r) => r.$id)).toEqual(["done"]);
  });
});

// ===========================================================================
// listIssues — newsletterId + limit passthrough
// ===========================================================================

describe("listIssues options", () => {
  it("passes newsletterId through to listRuns", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({ $id: "r1", newsletterId: "nl-target", checkpointDraftId: "d1" }),
    ]);

    await listIssues(fakeClient, { newsletterId: "nl-target" });

    expect(mockHolder.listRuns).toHaveBeenCalledWith(fakeClient, {
      status: "completed",
      newsletterId: "nl-target",
      limit: 100,
    });
  });

  it("defaults limit to 100 when omitted", async () => {
    mockHolder.listRuns.mockResolvedValue([]);

    await listIssues(fakeClient);

    expect(mockHolder.listRuns).toHaveBeenCalledWith(fakeClient, {
      status: "completed",
      newsletterId: undefined,
      limit: 100,
    });
  });

  it("honors a custom limit via listRuns", async () => {
    mockHolder.listRuns.mockResolvedValue([]);

    await listIssues(fakeClient, { limit: 25 });

    expect(mockHolder.listRuns).toHaveBeenCalledWith(fakeClient, {
      status: "completed",
      newsletterId: undefined,
      limit: 25,
    });
  });
});

// ===========================================================================
// listIssues — sort
// ===========================================================================

describe("listIssues sort", () => {
  it("sorts newest (endedAt ?? startedAt) first, then $id descending", async () => {
    mockHolder.listRuns.mockResolvedValue([
      makeRun({
        $id: "old",
        newsletterId: "nl-a",
        endedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeRun({
        $id: "new-b",
        newsletterId: "nl-a",
        endedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-06-01T00:00:00.000Z",
      }),
      makeRun({
        $id: "new-a",
        newsletterId: "nl-a",
        endedAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-06-01T00:00:00.000Z",
      }),
      makeRun({
        $id: "null-ended",
        newsletterId: "nl-a",
        endedAt: null,
        startedAt: "2026-03-01T00:00:00.000Z",
      }),
    ]);

    const result = await listIssues(fakeClient);

    expect(result.map((r) => r.$id)).toEqual(["new-b", "new-a", "null-ended", "old"]);
  });
});

// ===========================================================================
// formatIssueFallbackTitle
// ===========================================================================

describe("formatIssueFallbackTitle", () => {
  it("returns `{name} — {shortDate}` for a fixed ISO input", () => {
    const iso = "2026-03-15T12:00:00.000Z";
    const result = formatIssueFallbackTitle("Weekly Digest", iso);

    expect(result.startsWith("Weekly Digest — ")).toBe(true);
    const dateSegment = result.slice("Weekly Digest — ".length);
    expect(dateSegment.length).toBeGreaterThan(0);
    expect(dateSegment).not.toMatch(/^\s*$/);
  });
});

// ===========================================================================
// extractFirstMarkdownHeading
// ===========================================================================

describe("extractFirstMarkdownHeading", () => {
  it("extracts ATX headings at levels #–### and ignores later headings", () => {
    expect(extractFirstMarkdownHeading("# Hello\n\n## Later")).toBe("Hello");
    expect(extractFirstMarkdownHeading("## Hello\n\n### Later")).toBe("Hello");
    expect(extractFirstMarkdownHeading("### Hello\n\n# Later")).toBe("Hello");
  });

  it("strips closing hashes from ATX headings", () => {
    expect(extractFirstMarkdownHeading("## Hello ##")).toBe("Hello");
  });

  it("skips leading blank lines before the first heading", () => {
    expect(extractFirstMarkdownHeading("\n\n## Title\n\nBody")).toBe("Title");
  });

  it("skips ATX headings inside fenced code blocks (``` and ~~~)", () => {
    expect(extractFirstMarkdownHeading("```\n## Not a title\n```\n\n## Real\n")).toBe("Real");
    expect(extractFirstMarkdownHeading("~~~\n## Not a title\n~~~\n\n## Real\n")).toBe("Real");
  });

  it("extracts setext headings when no earlier ATX exists", () => {
    expect(extractFirstMarkdownHeading("Title\n===\n\nBody")).toBe("Title");
    expect(extractFirstMarkdownHeading("Subtitle\n---\n\nBody")).toBe("Subtitle");
  });

  it("cleans inline markdown from heading text", () => {
    expect(extractFirstMarkdownHeading("## **Bold** title")).toBe("Bold title");
    expect(extractFirstMarkdownHeading("## [Label](https://x.test)")).toBe("Label");
    expect(extractFirstMarkdownHeading("## `code` tip")).toBe("code tip");
  });

  it("returns null for empty, paragraph-only, or empty-text headings", () => {
    expect(extractFirstMarkdownHeading("")).toBeNull();
    expect(extractFirstMarkdownHeading("Just a paragraph.\n\nMore text.")).toBeNull();
    expect(extractFirstMarkdownHeading("##   ")).toBeNull();
    expect(extractFirstMarkdownHeading("## ###")).toBeNull();
  });

  it("returns null when heading is only punctuation/whitespace after cleanup", () => {
    expect(extractFirstMarkdownHeading("## ***")).toBeNull();
    expect(extractFirstMarkdownHeading("## ---")).toBeNull();
  });
});

// ===========================================================================
// resolveIssueDisplayTitle
// ===========================================================================

describe("resolveIssueDisplayTitle", () => {
  const iso = "2026-03-15T12:00:00.000Z";
  const newsletterName = "Weekly Digest";

  it("returns the extracted heading when markdown has one", () => {
    expect(
      resolveIssueDisplayTitle({
        markdown: "## Draft Title\n\nBody",
        newsletterName,
        dateIso: iso,
      }),
    ).toBe("Draft Title");
  });

  it("falls back to formatIssueFallbackTitle for null/undefined/no-heading markdown", () => {
    const fallback = formatIssueFallbackTitle(newsletterName, iso);

    expect(
      resolveIssueDisplayTitle({
        markdown: null,
        newsletterName,
        dateIso: iso,
      }),
    ).toBe(fallback);

    expect(
      resolveIssueDisplayTitle({
        markdown: undefined,
        newsletterName,
        dateIso: iso,
      }),
    ).toBe(fallback);

    expect(
      resolveIssueDisplayTitle({
        markdown: "Just a paragraph.",
        newsletterName,
        dateIso: iso,
      }),
    ).toBe(fallback);

    expect(fallback.startsWith(`${newsletterName} — `)).toBe(true);
    const dateSegment = fallback.slice(`${newsletterName} — `.length);
    expect(dateSegment.length).toBeGreaterThan(0);
    expect(dateSegment).not.toMatch(/^\s*$/);
  });
});

// ===========================================================================
// isEligibleIssue
// ===========================================================================

describe("isEligibleIssue", () => {
  it("returns true for completed + non-empty checkpointDraftId", () => {
    expect(
      isEligibleIssue(makeRun({ $id: "ok", newsletterId: "nl-a", checkpointDraftId: "draft-1" })),
    ).toBe(true);
  });

  it("returns true when checkpointDraftId has surrounding whitespace but is non-empty", () => {
    expect(
      isEligibleIssue(makeRun({ $id: "ok", newsletterId: "nl-a", checkpointDraftId: " draft-1 " })),
    ).toBe(true);
  });

  it("returns false for empty or whitespace-only checkpointDraftId", () => {
    expect(
      isEligibleIssue(makeRun({ $id: "empty", newsletterId: "nl-a", checkpointDraftId: "" })),
    ).toBe(false);
    expect(
      isEligibleIssue(makeRun({ $id: "ws", newsletterId: "nl-a", checkpointDraftId: "   " })),
    ).toBe(false);
  });

  it("returns false for pending / running / failed even with a draft id", () => {
    expect(
      isEligibleIssue(
        makeRun({
          $id: "p",
          newsletterId: "nl-a",
          status: "pending",
          checkpointDraftId: "draft",
        }),
      ),
    ).toBe(false);
    expect(
      isEligibleIssue(
        makeRun({
          $id: "r",
          newsletterId: "nl-a",
          status: "running",
          checkpointDraftId: "draft",
        }),
      ),
    ).toBe(false);
    expect(
      isEligibleIssue(
        makeRun({
          $id: "f",
          newsletterId: "nl-a",
          status: "failed",
          checkpointDraftId: "draft",
        }),
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// loadIssueDraft
// ===========================================================================

describe("loadIssueDraft", () => {
  it("returns { run, markdown } from the draft checkpoint on happy path", async () => {
    const run = makeRun({
      $id: "run-ok",
      newsletterId: "nl-a",
      checkpointDraftId: "draft-file",
    });
    mockHolder.getRun.mockResolvedValue(run);
    mockHolder.loadPhaseCheckpoint.mockResolvedValue({
      markdown: "# Hello\n\nBody text.",
      empty: false,
      reason: null,
      articleCount: 3,
      attempts: 1,
    });

    const result = await loadIssueDraft(fakeClient, "run-ok");

    expect(result).toEqual({ run, markdown: "# Hello\n\nBody text." });
    expect(mockHolder.getRun).toHaveBeenCalledWith(fakeClient, "run-ok");
    expect(mockHolder.loadPhaseCheckpoint).toHaveBeenCalledWith(fakeClient, "run-ok", "draft");
  });

  it("throws not_found and does not download when getRun is not_found", async () => {
    mockHolder.getRun.mockRejectedValue(new RunRepositoryError("not_found", "Run not found"));

    await expect(loadIssueDraft(fakeClient, "missing")).rejects.toMatchObject({
      name: "IssueLoadError",
      code: "not_found",
    });
    expect(mockHolder.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });

  it("throws not_eligible and does not download for ineligible runs", async () => {
    mockHolder.getRun.mockResolvedValue(
      makeRun({
        $id: "pending",
        newsletterId: "nl-a",
        status: "pending",
        checkpointDraftId: "draft-id",
      }),
    );

    await expect(loadIssueDraft(fakeClient, "pending")).rejects.toBeInstanceOf(IssueLoadError);
    await expect(loadIssueDraft(fakeClient, "pending")).rejects.toMatchObject({
      code: "not_eligible",
    });
    expect(mockHolder.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });

  it("throws not_eligible when completed but draft id is empty", async () => {
    mockHolder.getRun.mockResolvedValue(
      makeRun({ $id: "no-draft", newsletterId: "nl-a", checkpointDraftId: "" }),
    );

    await expect(loadIssueDraft(fakeClient, "no-draft")).rejects.toMatchObject({
      name: "IssueLoadError",
      code: "not_eligible",
    });
    expect(mockHolder.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });

  it("surfaces checkpoint_missing as a distinct IssueLoadError", async () => {
    mockHolder.getRun.mockResolvedValue(
      makeRun({ $id: "run-ok", newsletterId: "nl-a", checkpointDraftId: "draft-file" }),
    );
    mockHolder.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("checkpoint_missing", "No checkpoint stored for phase draft"),
    );

    await expect(loadIssueDraft(fakeClient, "run-ok")).rejects.toMatchObject({
      name: "IssueLoadError",
      code: "checkpoint_missing",
    });
  });

  it("surfaces appwrite failures as a distinct IssueLoadError", async () => {
    mockHolder.getRun.mockResolvedValue(
      makeRun({ $id: "run-ok", newsletterId: "nl-a", checkpointDraftId: "draft-file" }),
    );
    mockHolder.loadPhaseCheckpoint.mockRejectedValue(
      new RunRepositoryError("appwrite", "Something went wrong talking to the database"),
    );

    await expect(loadIssueDraft(fakeClient, "run-ok")).rejects.toMatchObject({
      name: "IssueLoadError",
      code: "appwrite",
    });
  });

  it("maps getRun appwrite errors to IssueLoadError without downloading", async () => {
    mockHolder.getRun.mockRejectedValue(
      new RunRepositoryError("appwrite", "Something went wrong talking to the database"),
    );

    await expect(loadIssueDraft(fakeClient, "run-ok")).rejects.toMatchObject({
      name: "IssueLoadError",
      code: "appwrite",
    });
    expect(mockHolder.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// resolveIssueDisplayTitlesForRuns
// ===========================================================================

describe("resolveIssueDisplayTitlesForRuns", () => {
  it("resolves heading titles for successful draft loads", async () => {
    const runs = [
      makeRun({
        $id: "r1",
        newsletterId: "nl-a",
        newsletterName: "Alpha",
        endedAt: "2026-03-15T14:35:00.000Z",
      }),
      makeRun({
        $id: "r2",
        newsletterId: "nl-b",
        newsletterName: "Beta",
        endedAt: "2026-04-01T09:02:00.000Z",
      }),
    ];

    mockHolder.loadPhaseCheckpoint.mockImplementation(async (_client, runId: string) => {
      if (runId === "r1") {
        return {
          markdown: "# First Heading\n\nBody.",
          empty: false,
          reason: null,
          articleCount: 1,
          attempts: 1,
        };
      }
      return {
        markdown: "No heading here.",
        empty: false,
        reason: null,
        articleCount: 0,
        attempts: 1,
      };
    });

    const map = await resolveIssueDisplayTitlesForRuns(fakeClient, runs);

    expect(map.get("r1")).toBe("First Heading");
    expect(map.get("r2")).toBe(formatIssueFallbackTitle("Beta", "2026-04-01T09:02:00.000Z"));
    expect(mockHolder.loadPhaseCheckpoint).toHaveBeenCalledTimes(2);
    expect(mockHolder.loadPhaseCheckpoint).toHaveBeenCalledWith(fakeClient, "r1", "draft");
    expect(mockHolder.loadPhaseCheckpoint).toHaveBeenCalledWith(fakeClient, "r2", "draft");
  });

  it("falls back per row on load failure without throwing or failing siblings", async () => {
    const runs = [
      makeRun({
        $id: "ok",
        newsletterId: "nl-a",
        newsletterName: "Good",
        endedAt: "2026-03-15T14:35:00.000Z",
      }),
      makeRun({
        $id: "bad",
        newsletterId: "nl-b",
        newsletterName: "Broken",
        endedAt: "2026-04-01T09:02:00.000Z",
      }),
    ];

    mockHolder.loadPhaseCheckpoint.mockImplementation(async (_client, runId: string) => {
      if (runId === "bad") {
        throw new RunRepositoryError(
          "checkpoint_missing",
          "Checkpoint file not found for phase draft",
        );
      }
      return {
        markdown: "# Survived\n\nOk.",
        empty: false,
        reason: null,
        articleCount: 1,
        attempts: 1,
      };
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const map = await resolveIssueDisplayTitlesForRuns(fakeClient, runs);

    expect(map.get("ok")).toBe("Survived");
    expect(map.get("bad")).toBe(formatIssueFallbackTitle("Broken", "2026-04-01T09:02:00.000Z"));
    expect(map.size).toBe(2);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("returns an empty map for an empty runs array without loading", async () => {
    const map = await resolveIssueDisplayTitlesForRuns(fakeClient, []);
    expect(map.size).toBe(0);
    expect(mockHolder.loadPhaseCheckpoint).not.toHaveBeenCalled();
  });
});
