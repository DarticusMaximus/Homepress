import { describe, expect, it } from "vitest";
import type { Feed, Run } from "@newsletter/shared";
import {
  buildAttentionItems,
  computeAttentionCounts,
  DASHBOARD_RECENT_ISSUES_LIMIT,
  DASHBOARD_RECENT_RUNS_CAP,
  selectFailedDeliveryIssues,
  selectRecentIssues,
  selectRecentRuns,
} from "@/lib/dashboard-data";
import { buildRunsHref } from "@/lib/runs-url";

/** Fixed “now” so window math is deterministic. */
const NOW = "2026-07-21T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY_MS = 24 * 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(NOW_MS - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

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
    startedAt: hoursAgo(1),
    endedAt: hoursAgo(0.5),
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("selectRecentRuns (window + cap)", () => {
  it("keeps only runs with startedAt inside the rolling 7-day window", () => {
    const runs = [
      makeRun({ $id: "in-1", startedAt: hoursAgo(1) }),
      makeRun({ $id: "in-2", startedAt: daysAgo(6.9) }),
      makeRun({ $id: "out-old", startedAt: daysAgo(8) }),
      makeRun({ $id: "out-older", startedAt: daysAgo(30) }),
    ];

    const result = selectRecentRuns(runs, NOW);

    expect(result.map((r) => r.$id)).toEqual(["in-1", "in-2"]);
  });

  it("sorts newest first and caps at 10", () => {
    const runs: Run[] = [];
    for (let i = 0; i < 15; i++) {
      // Older index → older startedAt; shuffle insertion order.
      runs.push(
        makeRun({
          $id: `run-${i}`,
          startedAt: hoursAgo(14 - i),
        }),
      );
    }
    // Reverse insertion so helper must sort, not rely on input order.
    runs.reverse();

    const result = selectRecentRuns(runs, NOW);

    expect(result).toHaveLength(DASHBOARD_RECENT_RUNS_CAP);
    expect(result.map((r) => r.$id)).toEqual([
      "run-14",
      "run-13",
      "run-12",
      "run-11",
      "run-10",
      "run-9",
      "run-8",
      "run-7",
      "run-6",
      "run-5",
    ]);
    for (const run of result) {
      expect(Date.parse(run.startedAt)).toBeGreaterThanOrEqual(NOW_MS - 7 * DAY_MS);
    }
  });

  it("includes a run exactly at the 7-day boundary and excludes just outside", () => {
    const atBoundary = new Date(NOW_MS - 7 * DAY_MS).toISOString();
    const justOutside = new Date(NOW_MS - 7 * DAY_MS - 1).toISOString();

    const result = selectRecentRuns(
      [
        makeRun({ $id: "boundary", startedAt: atBoundary }),
        makeRun({ $id: "outside", startedAt: justOutside }),
      ],
      NOW,
    );

    expect(result.map((r) => r.$id)).toEqual(["boundary"]);
  });
});

describe("selectRecentIssues (slice)", () => {
  it("yields at most 5 newest when given more than 5 eligible issues", () => {
    const issues = [
      makeRun({ $id: "old-1", endedAt: daysAgo(10), startedAt: daysAgo(10) }),
      makeRun({ $id: "new-1", endedAt: hoursAgo(1), startedAt: hoursAgo(2) }),
      makeRun({ $id: "new-2", endedAt: hoursAgo(2), startedAt: hoursAgo(3) }),
      makeRun({ $id: "new-3", endedAt: hoursAgo(3), startedAt: hoursAgo(4) }),
      makeRun({ $id: "new-4", endedAt: null, startedAt: hoursAgo(4) }),
      makeRun({ $id: "new-5", endedAt: hoursAgo(5), startedAt: hoursAgo(6) }),
      makeRun({ $id: "new-6", endedAt: hoursAgo(6), startedAt: hoursAgo(7) }),
    ];

    const result = selectRecentIssues(issues);

    expect(result).toHaveLength(DASHBOARD_RECENT_ISSUES_LIMIT);
    expect(result.map((r) => r.$id)).toEqual(["new-1", "new-2", "new-3", "new-4", "new-5"]);
  });

  it("returns all issues when fewer than the limit", () => {
    const issues = [
      makeRun({ $id: "a", endedAt: hoursAgo(1), startedAt: hoursAgo(2) }),
      makeRun({ $id: "b", endedAt: hoursAgo(3), startedAt: hoursAgo(4) }),
    ];
    expect(selectRecentIssues(issues).map((r) => r.$id)).toEqual(["a", "b"]);
  });
});

describe("selectFailedDeliveryIssues (P1 reuse helper)", () => {
  it("keeps only membership + any_failure rows", () => {
    const issues = [
      makeRun({ $id: "email-fail", emailDeliveryStatus: "failed" }),
      makeRun({ $id: "rss-fail", rssDeliveryStatus: "failed" }),
      makeRun({
        $id: "sent",
        emailDeliveryStatus: "sent",
        rssDeliveryStatus: "published",
      }),
      makeRun({ $id: "none", emailDeliveryStatus: "none", rssDeliveryStatus: "none" }),
    ];

    expect(selectFailedDeliveryIssues(issues).map((r) => r.$id)).toEqual([
      "email-fail",
      "rss-fail",
    ]);
  });
});

describe("computeAttentionCounts + buildAttentionItems", () => {
  it("counts unhealthy feeds with no time window", () => {
    const feeds = [
      makeFeed({ $id: "f1", operationalHealth: "unhealthy" }),
      makeFeed({ $id: "f2", operationalHealth: "healthy" }),
      makeFeed({ $id: "f3", operationalHealth: "unhealthy" }),
    ];

    const counts = computeAttentionCounts({
      feeds,
      runs: [],
      issues: [],
      now: NOW,
    });

    expect(counts.unhealthyFeeds).toBe(2);
    expect(counts.failedRuns).toBe(0);
    expect(counts.failedDelivery).toBe(0);
  });

  it("counts failed runs only when startedAt is in-window", () => {
    const runs = [
      makeRun({ $id: "fail-in", status: "failed", startedAt: hoursAgo(12) }),
      makeRun({ $id: "fail-out", status: "failed", startedAt: daysAgo(10) }),
      makeRun({ $id: "ok-in", status: "completed", startedAt: hoursAgo(1) }),
      makeRun({ $id: "pending-in", status: "pending", startedAt: hoursAgo(2) }),
    ];

    const counts = computeAttentionCounts({
      feeds: [],
      runs,
      issues: [],
      now: NOW,
    });

    expect(counts.failedRuns).toBe(1);
  });

  it("does not undercount failedRuns when newer completed runs fill the unfiltered limit-100 (C2)", () => {
    // Mixed newest-100 pool: 100 completed runs crowd out older in-window failures.
    const newestCompleted: Run[] = [];
    for (let i = 0; i < 100; i++) {
      newestCompleted.push(
        makeRun({
          $id: `ok-${i}`,
          status: "completed",
          startedAt: hoursAgo(i * 0.5),
        }),
      );
    }
    const olderInWindowFailures = [
      makeRun({ $id: "fail-old-1", status: "failed", startedAt: daysAgo(5) }),
      makeRun({ $id: "fail-old-2", status: "failed", startedAt: daysAgo(6) }),
    ];

    // Bug path: counting from the shared unfiltered newest-100 → undercount.
    const undercounted = computeAttentionCounts({
      feeds: [],
      runs: newestCompleted,
      issues: [],
      now: NOW,
    });
    expect(undercounted.failedRuns).toBe(0);

    // Fixed path: dedicated failed-status set (what page.tsx passes after C2).
    const counts = computeAttentionCounts({
      feeds: [],
      runs: olderInWindowFailures,
      issues: [],
      now: NOW,
    });
    expect(counts.failedRuns).toBe(2);
    expect(buildAttentionItems(counts).some((i) => i.kind === "failed_runs")).toBe(true);

    // Recent-runs snapshot from the unfiltered pool stays 7-day / cap 10.
    const recent = selectRecentRuns(newestCompleted, NOW);
    expect(recent).toHaveLength(DASHBOARD_RECENT_RUNS_CAP);
    expect(recent.every((r) => r.status === "completed")).toBe(true);
  });

  it("counts delivery failures only in-window with email or rss failed", () => {
    const issues = [
      makeRun({
        $id: "email-fail-in",
        emailDeliveryStatus: "failed",
        endedAt: hoursAgo(3),
        startedAt: hoursAgo(4),
      }),
      makeRun({
        $id: "rss-fail-in",
        rssDeliveryStatus: "failed",
        endedAt: null,
        startedAt: hoursAgo(5),
      }),
      makeRun({
        $id: "email-fail-out",
        emailDeliveryStatus: "failed",
        endedAt: daysAgo(9),
        startedAt: daysAgo(9),
      }),
      makeRun({
        $id: "sent-in",
        emailDeliveryStatus: "sent",
        rssDeliveryStatus: "published",
        endedAt: hoursAgo(1),
        startedAt: hoursAgo(2),
      }),
      makeRun({
        $id: "none-in",
        emailDeliveryStatus: "none",
        rssDeliveryStatus: "none",
        endedAt: hoursAgo(1),
        startedAt: hoursAgo(2),
      }),
    ];

    const counts = computeAttentionCounts({
      feeds: [],
      runs: [],
      issues,
      now: NOW,
    });

    expect(counts.failedDelivery).toBe(2);
  });

  it("produces no attention items when all counts are zero", () => {
    const counts = computeAttentionCounts({
      feeds: [makeFeed({ operationalHealth: "healthy" })],
      runs: [makeRun({ status: "completed", startedAt: hoursAgo(1) })],
      issues: [
        makeRun({
          emailDeliveryStatus: "sent",
          rssDeliveryStatus: "none",
          endedAt: hoursAgo(1),
        }),
      ],
      now: NOW,
    });

    expect(counts).toEqual({
      unhealthyFeeds: 0,
      failedRuns: 0,
      failedDelivery: 0,
    });
    expect(buildAttentionItems(counts)).toEqual([]);
  });

  it("builds attention items only for positive counts with pinned hrefs", () => {
    const items = buildAttentionItems({
      unhealthyFeeds: 3,
      failedRuns: 1,
      failedDelivery: 2,
    });

    expect(items).toEqual([
      { kind: "unhealthy_feeds", count: 3, href: "/feeds?health=unhealthy" },
      { kind: "failed_runs", count: 1, href: buildRunsHref({ status: "failed" }) },
      { kind: "failed_delivery", count: 2, href: "/delivery?outcome=any_failure" },
    ]);
  });

  it("uses buildRunsHref for failed_runs attention href (single encoding source)", () => {
    const items = buildAttentionItems({
      unhealthyFeeds: 0,
      failedRuns: 2,
      failedDelivery: 0,
    });

    const failedRuns = items.find((item) => item.kind === "failed_runs");
    expect(failedRuns).toBeDefined();
    expect(failedRuns!.href).toBe(buildRunsHref({ status: "failed" }));
  });
});
