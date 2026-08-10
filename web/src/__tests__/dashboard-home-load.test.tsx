/**
 * Feature 08 Task 6 (P1, O1): parallel dashboard loads + sanitized catch logs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Feed, HealthCheckResult, Run } from "@newsletter/shared";
import { RunRepositoryError, sanitizeAppwriteMessageForLog } from "@newsletter/shared";

vi.mock("@/components/health-card/actions", () => ({
  revalidateHealthCheck: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(() => ({ $id: "mock-client" })),
  runHealthCheck: vi.fn(),
  listFeeds: vi.fn(),
  listRuns: vi.fn(),
  listIssues: vi.fn(),
  listDeliveryIssues: vi.fn(),
  countUnhealthyFeeds: vi.fn((feeds: Feed[]) =>
    feeds.filter((f) => f.operationalHealth === "unhealthy").length,
  ),
  resolveIssueDisplayTitlesForRuns: vi.fn(async () => new Map<string, string>()),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    runHealthCheck: mocks.runHealthCheck,
    listFeeds: mocks.listFeeds,
    listRuns: mocks.listRuns,
    listIssues: mocks.listIssues,
    listDeliveryIssues: mocks.listDeliveryIssues,
    countUnhealthyFeeds: mocks.countUnhealthyFeeds,
    resolveIssueDisplayTitlesForRuns: mocks.resolveIssueDisplayTitlesForRuns,
  };
});

/** Relative to now so attention-window assertions stay inside the rolling 7 days. */
const STARTED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const ENDED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Weekly Tech",
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "draft-1",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    ...overrides,
  };
}

function okHealth(): HealthCheckResult {
  return {
    status: "ok",
    checkedAt: "2026-07-21T12:00:00.000Z",
    documentId: "doc-1",
    steps: [
      { step: "create", status: "ok", durationMs: 12 },
      { step: "read", status: "ok", durationMs: 8 },
      { step: "delete", status: "ok", durationMs: 5 },
    ],
  };
}

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    $id: "feed-1",
    name: "Example",
    url: "https://example.com/feed.xml",
    notes: "",
    status: "ok",
    lastTestedAt: null,
    lastTestError: null,
    operationalHealth: "healthy",
    consecutiveFetchFailures: 0,
    lastFetchError: "",
    lastFetchAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getServerAppwrite.mockClear();
  mocks.runHealthCheck.mockReset();
  mocks.listFeeds.mockReset();
  mocks.listRuns.mockReset();
  mocks.listIssues.mockReset();
  mocks.listDeliveryIssues.mockReset();
  mocks.countUnhealthyFeeds.mockClear();
  mocks.resolveIssueDisplayTitlesForRuns.mockReset();

  mocks.runHealthCheck.mockResolvedValue(okHealth());
  mocks.listFeeds.mockResolvedValue([makeFeed()]);
  mocks.listRuns.mockImplementation(
    async (_client: unknown, opts?: { status?: string; limit?: number }) => {
      if (opts?.status === "failed") {
        return [makeRun({ $id: "fail-1", status: "failed" })];
      }
      return [makeRun({ $id: "run-recent", status: "completed" })];
    },
  );
  mocks.listIssues.mockResolvedValue([
    makeRun({
      $id: "issue-fail",
      emailDeliveryStatus: "failed",
      endedAt: STARTED_AT,
    }),
  ]);
  mocks.listDeliveryIssues.mockResolvedValue([]);
  mocks.resolveIssueDisplayTitlesForRuns.mockResolvedValue(
    new Map([["issue-fail", "Failed Delivery Issue"]]),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard Home load (P1 parallel + reuse, O1 sanitize)", () => {
  it("starts independent fetches without awaiting each other end-to-end", async () => {
    let healthStarted = false;
    let feedsStarted = false;
    let runsStarted = false;
    let failedStarted = false;
    let issuesStarted = false;
    let healthResolve!: (v: HealthCheckResult) => void;
    let feedsResolve!: (v: Feed[]) => void;
    let runsResolve!: (v: Run[]) => void;
    let failedResolve!: (v: Run[]) => void;
    let issuesResolve!: (v: Run[]) => void;

    mocks.runHealthCheck.mockImplementation(
      () =>
        new Promise<HealthCheckResult>((resolve) => {
          healthStarted = true;
          healthResolve = resolve;
        }),
    );
    mocks.listFeeds.mockImplementation(
      () =>
        new Promise<Feed[]>((resolve) => {
          feedsStarted = true;
          feedsResolve = resolve;
        }),
    );
    mocks.listRuns.mockImplementation(
      async (_client: unknown, opts?: { status?: string }) =>
        new Promise<Run[]>((resolve) => {
          if (opts?.status === "failed") {
            failedStarted = true;
            failedResolve = resolve;
          } else {
            runsStarted = true;
            runsResolve = resolve;
          }
        }),
    );
    mocks.listIssues.mockImplementation(
      () =>
        new Promise<Run[]>((resolve) => {
          issuesStarted = true;
          issuesResolve = resolve;
        }),
    );

    const Home = (await import("../../app/(protected)/page")).default;
    const pending = Home();

    // Yield so the page's allSettled can schedule all promises.
    await Promise.resolve();
    await Promise.resolve();

    expect(healthStarted).toBe(true);
    expect(feedsStarted).toBe(true);
    expect(runsStarted).toBe(true);
    expect(failedStarted).toBe(true);
    expect(issuesStarted).toBe(true);

    healthResolve(okHealth());
    feedsResolve([makeFeed()]);
    runsResolve([makeRun({ $id: "run-recent" })]);
    failedResolve([]);
    issuesResolve([]);

    const element = await pending;
    render(element);
    expect(screen.getByRole("heading", { name: /recent runs/i })).toBeInTheDocument();
  });

  it("reuses loaded issues for delivery attention and skips listDeliveryIssues", async () => {
    const Home = (await import("../../app/(protected)/page")).default;
    const element = await Home();
    render(element);

    expect(mocks.listIssues).toHaveBeenCalled();
    expect(mocks.listDeliveryIssues).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /1 delivery failure/i })).toBeInTheDocument();
  });

  it("falls back to listDeliveryIssues when listIssues fails (isolation)", async () => {
    mocks.listIssues.mockRejectedValue(new Error("issues down"));
    mocks.listDeliveryIssues.mockResolvedValue([
      makeRun({
        $id: "delivery-fail",
        emailDeliveryStatus: "failed",
        endedAt: STARTED_AT,
      }),
    ]);

    const Home = (await import("../../app/(protected)/page")).default;
    const element = await Home();
    render(element);

    expect(mocks.listDeliveryIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: "any_failure" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/unable to load recent issues/i);
    expect(screen.getByRole("link", { name: /1 delivery failure/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /recent runs/i })).toBeInTheDocument();
  });

  it("logs sanitized message/code only — not the raw exception (O1)", async () => {
    const rawMessage = "Appwrite exception with sk-secret-do-not-leak-1234567890";
    const err = Object.assign(new Error(rawMessage), { code: 401 });
    mocks.listFeeds.mockRejectedValue(err);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const Home = (await import("../../app/(protected)/page")).default;
    await Home();

    const dashboardLogs = consoleError.mock.calls.filter((args) => {
      const first = args[0];
      return (
        first !== null &&
        typeof first === "object" &&
        "phase" in first &&
        typeof (first as { phase: unknown }).phase === "string" &&
        (first as { phase: string }).phase.startsWith("dashboard-")
      );
    });

    expect(dashboardLogs.length).toBeGreaterThan(0);
    for (const [payload] of dashboardLogs) {
      expect(payload).toEqual(
        expect.objectContaining({
          phase: expect.stringMatching(/^dashboard-/),
          message: expect.any(String),
        }),
      );
      const logged = payload as { message: string; code?: number };
      expect(logged.message).toBe(sanitizeAppwriteMessageForLog(rawMessage));
      expect(logged.message).not.toContain("sk-secret");
      // Must not pass the raw Error as a second console.error arg.
    }

    const rawPassed = consoleError.mock.calls.some(
      (args) => args.includes(err) || args.some((a) => a instanceof Error),
    );
    expect(rawPassed).toBe(false);

    consoleError.mockRestore();
  });

  it("maps section rejections to safe UI strings without Appwrite internals", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.listRuns.mockImplementation(
      async (_client: unknown, opts?: { status?: string }) => {
        if (opts?.status === "failed") return [];
        throw new RunRepositoryError(
          "appwrite",
          "Something went wrong while talking to the database. Please try again.",
        );
      },
    );
    mocks.listIssues.mockRejectedValue(
      Object.assign(new Error("Document with the requested ID could not be found"), {
        code: 404,
      }),
    );
    mocks.listDeliveryIssues.mockResolvedValue([]);

    const Home = (await import("../../app/(protected)/page")).default;
    const element = await Home();
    render(element);

    const issuesSection = screen.getByRole("region", { name: /recent issues/i });
    expect(within(issuesSection).getByRole("alert")).toHaveTextContent(
      /unable to load recent issues/i,
    );
    const runsSection = screen.getByRole("region", { name: /recent runs/i });
    expect(within(runsSection).getByRole("alert")).toHaveTextContent(
      /something went wrong while talking to the database/i,
    );
    expect(screen.queryByText(/document with the requested id/i)).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});
