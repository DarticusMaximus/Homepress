import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import type { Run } from "../../runs/types";

// Intentionally imports modules that do not exist yet (Task 4).
// Cases 11–13 fail red for missing module / missing exports.
import { hasDeliveryAttempt, listDeliveryIssues } from "../list-delivery-issues";

const mockHolder = vi.hoisted(() => ({
  listIssues: vi.fn(),
}));

vi.mock("../../runs/issues", () => ({
  listIssues: mockHolder.listIssues,
}));

/** Run shape plus delivery visibility fields (added in Task 2). */
type DeliveryRun = Run & {
  emailDeliveryStatus: "none" | "sent" | "failed";
  emailDeliveryAt: string | null;
  emailDeliveryError: string;
  rssDeliveryStatus: "none" | "published" | "failed";
  rssDeliveryAt: string | null;
  rssDeliveryError: string;
};

function makeRun(
  overrides: Partial<DeliveryRun> & Pick<DeliveryRun, "$id" | "newsletterId">,
): DeliveryRun {
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
  mockHolder.listIssues.mockReset();
});

// ===========================================================================
// hasDeliveryAttempt — membership (case 11)
// ===========================================================================

describe("hasDeliveryAttempt", () => {
  // Stage 09 Feature 06 Task 1 case 11 — both none excluded.
  it("returns false when both email and RSS status are none", () => {
    const run = makeRun({ $id: "r1", newsletterId: "nl-a" });
    expect(hasDeliveryAttempt(run)).toBe(false);
  });

  // Stage 09 Feature 06 Task 1 case 11 — either non-none included.
  it("returns true when email status is non-none", () => {
    expect(
      hasDeliveryAttempt(
        makeRun({
          $id: "r1",
          newsletterId: "nl-a",
          emailDeliveryStatus: "sent",
          emailDeliveryAt: "2026-07-01T12:00:00.000Z",
        }),
      ),
    ).toBe(true);
    expect(
      hasDeliveryAttempt(
        makeRun({
          $id: "r2",
          newsletterId: "nl-a",
          emailDeliveryStatus: "failed",
          emailDeliveryError: "boom",
        }),
      ),
    ).toBe(true);
  });

  it("returns true when RSS status is non-none", () => {
    expect(
      hasDeliveryAttempt(
        makeRun({
          $id: "r1",
          newsletterId: "nl-a",
          rssDeliveryStatus: "published",
          rssDeliveryAt: "2026-07-01T12:00:00.000Z",
        }),
      ),
    ).toBe(true);
    expect(
      hasDeliveryAttempt(
        makeRun({
          $id: "r2",
          newsletterId: "nl-a",
          rssDeliveryStatus: "failed",
          rssDeliveryError: "rss boom",
        }),
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// listDeliveryIssues — membership (case 11)
// ===========================================================================

describe("listDeliveryIssues membership", () => {
  // Stage 09 Feature 06 Task 1 case 11.
  it("excludes eligible issues where both channels are still none", async () => {
    mockHolder.listIssues.mockResolvedValue([
      makeRun({ $id: "never", newsletterId: "nl-a" }),
      makeRun({
        $id: "emailed",
        newsletterId: "nl-a",
        emailDeliveryStatus: "sent",
        emailDeliveryAt: "2026-07-01T12:00:00.000Z",
      }),
      makeRun({
        $id: "published",
        newsletterId: "nl-a",
        rssDeliveryStatus: "published",
        rssDeliveryAt: "2026-07-01T13:00:00.000Z",
      }),
    ]);

    const result = await listDeliveryIssues(fakeClient);

    expect(result.map((r) => r.$id)).toEqual(["emailed", "published"]);
  });
});

// ===========================================================================
// listDeliveryIssues — outcome filters (case 12)
// ===========================================================================

describe("listDeliveryIssues outcome filters", () => {
  const seeded = [
    makeRun({
      $id: "email-ok",
      newsletterId: "nl-a",
      emailDeliveryStatus: "sent",
      emailDeliveryAt: "2026-07-01T10:00:00.000Z",
    }),
    makeRun({
      $id: "email-fail",
      newsletterId: "nl-a",
      emailDeliveryStatus: "failed",
      emailDeliveryAt: "2026-07-01T11:00:00.000Z",
      emailDeliveryError: "SMTP down",
    }),
    makeRun({
      $id: "rss-ok",
      newsletterId: "nl-a",
      rssDeliveryStatus: "published",
      rssDeliveryAt: "2026-07-01T12:00:00.000Z",
    }),
    makeRun({
      $id: "rss-fail",
      newsletterId: "nl-a",
      rssDeliveryStatus: "failed",
      rssDeliveryAt: "2026-07-01T13:00:00.000Z",
      rssDeliveryError: "Appwrite write failed",
    }),
    makeRun({
      $id: "both-fail",
      newsletterId: "nl-a",
      emailDeliveryStatus: "failed",
      emailDeliveryError: "no recipients",
      rssDeliveryStatus: "failed",
      rssDeliveryError: "empty draft",
    }),
  ];

  beforeEach(() => {
    mockHolder.listIssues.mockResolvedValue(seeded);
  });

  // Stage 09 Feature 06 Task 1 case 12 — all.
  it("outcome all returns every issue with a delivery attempt", async () => {
    const result = await listDeliveryIssues(fakeClient, { outcome: "all" });
    expect(result.map((r) => r.$id).sort()).toEqual(
      ["both-fail", "email-fail", "email-ok", "rss-fail", "rss-ok"].sort(),
    );
  });

  // Stage 09 Feature 06 Task 1 case 12 — any_failure.
  it("outcome any_failure keeps email or RSS failed", async () => {
    const result = await listDeliveryIssues(fakeClient, { outcome: "any_failure" });
    expect(result.map((r) => r.$id).sort()).toEqual(
      ["both-fail", "email-fail", "rss-fail"].sort(),
    );
  });

  // Stage 09 Feature 06 Task 1 case 12 — email_failed.
  it("outcome email_failed keeps only email failed", async () => {
    const result = await listDeliveryIssues(fakeClient, { outcome: "email_failed" });
    expect(result.map((r) => r.$id).sort()).toEqual(["both-fail", "email-fail"].sort());
  });

  // Stage 09 Feature 06 Task 1 case 12 — rss_failed.
  it("outcome rss_failed keeps only RSS failed", async () => {
    const result = await listDeliveryIssues(fakeClient, { outcome: "rss_failed" });
    expect(result.map((r) => r.$id).sort()).toEqual(["both-fail", "rss-fail"].sort());
  });

  it("defaults outcome to all when omitted", async () => {
    const result = await listDeliveryIssues(fakeClient);
    expect(result.map((r) => r.$id).sort()).toEqual(
      ["both-fail", "email-fail", "email-ok", "rss-fail", "rss-ok"].sort(),
    );
  });
});

// ===========================================================================
// listDeliveryIssues — newsletter filter (case 13)
// ===========================================================================

describe("listDeliveryIssues newsletter filter", () => {
  // Stage 09 Feature 06 Task 1 case 13 — passed through like listIssues.
  it("passes newsletterId through to listIssues", async () => {
    mockHolder.listIssues.mockResolvedValue([
      makeRun({
        $id: "r1",
        newsletterId: "nl-target",
        emailDeliveryStatus: "sent",
      }),
    ]);

    await listDeliveryIssues(fakeClient, { newsletterId: "nl-target" });

    expect(mockHolder.listIssues).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ newsletterId: "nl-target" }),
    );
  });

  it("caps the post-membership result at the requested limit", async () => {
    mockHolder.listIssues.mockImplementation(async (_client, opts) => {
      const lim = opts?.limit ?? 100;
      return Array.from({ length: lim }, (_, i) =>
        makeRun({
          $id: `sent-${i}`,
          newsletterId: "nl-a",
          emailDeliveryStatus: "sent",
          emailDeliveryAt: "2026-07-01T12:00:00.000Z",
        }),
      );
    });

    const result = await listDeliveryIssues(fakeClient, { limit: 25 });

    expect(result).toHaveLength(25);
    expect(result.every((r) => hasDeliveryAttempt(r))).toBe(true);
  });

  it("applies newsletter filter results from listIssues (membership still applies)", async () => {
    mockHolder.listIssues.mockResolvedValue([
      makeRun({
        $id: "kept",
        newsletterId: "nl-target",
        emailDeliveryStatus: "sent",
      }),
      makeRun({
        $id: "never",
        newsletterId: "nl-target",
      }),
    ]);

    const result = await listDeliveryIssues(fakeClient, { newsletterId: "nl-target" });

    expect(result.map((r) => r.$id)).toEqual(["kept"]);
  });
});

// ===========================================================================
// listDeliveryIssues — limit after membership (C1 / hardening)
// ===========================================================================

describe("listDeliveryIssues limit after membership (C1)", () => {
  /**
   * Regression: many recent never-attempted issues must not starve older
   * delivery attempts when `limit` is applied only after membership filtering.
   */
  it("surfaces older delivered issues when many recent issues were never attempted", async () => {
    const recentNone = Array.from({ length: 120 }, (_, i) =>
      makeRun({
        $id: `none-${String(i).padStart(3, "0")}`,
        newsletterId: "nl-a",
        // Newest first — listIssues returns newest-first.
        endedAt: new Date(Date.parse("2026-07-15T12:00:00.000Z") - i * 60_000).toISOString(),
      }),
    );
    const olderDelivered = makeRun({
      $id: "delivered-old",
      newsletterId: "nl-a",
      emailDeliveryStatus: "sent",
      emailDeliveryAt: "2026-06-01T12:00:00.000Z",
      endedAt: "2026-06-01T12:00:00.000Z",
    });
    const pool = [...recentNone, olderDelivered];

    mockHolder.listIssues.mockImplementation(async (_client, opts) => {
      const lim = opts?.limit ?? 100;
      return pool.slice(0, lim);
    });

    const result = await listDeliveryIssues(fakeClient);

    expect(result.map((r) => r.$id)).toContain("delivered-old");
    expect(result.every((r) => hasDeliveryAttempt(r))).toBe(true);
    expect(result.length).toBeLessThanOrEqual(100);
    // Must look past the first default page of never-attempted issues.
    expect(
      mockHolder.listIssues.mock.calls.some((call) => (call[1]?.limit ?? 0) > 100),
    ).toBe(true);
  });

  it("stops expanding when listIssues is exhausted under the target limit", async () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeRun({ $id: `none-${i}`, newsletterId: "nl-a" }),
      ),
      makeRun({
        $id: "only-delivered",
        newsletterId: "nl-a",
        emailDeliveryStatus: "sent",
        emailDeliveryAt: "2026-06-01T12:00:00.000Z",
      }),
    ];

    mockHolder.listIssues.mockImplementation(async (_client, opts) => {
      const lim = opts?.limit ?? 100;
      return pool.slice(0, lim);
    });

    const result = await listDeliveryIssues(fakeClient, { limit: 100 });

    expect(result.map((r) => r.$id)).toEqual(["only-delivered"]);
    // One batch is enough — pool smaller than the fetch window.
    expect(mockHolder.listIssues).toHaveBeenCalledTimes(1);
  });
});
