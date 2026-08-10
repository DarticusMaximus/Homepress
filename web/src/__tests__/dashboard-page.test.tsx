/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { HealthCheckResult, Run } from "@newsletter/shared";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { buildAttentionItems } from "@/lib/dashboard-data";

vi.mock("@/components/health-card/actions", () => ({
  revalidateHealthCheck: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const STARTED_AT = "2026-07-20T10:00:00.000Z";
const ENDED_AT = "2026-07-20T10:30:00.000Z";

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

function sectionOrderLabels(container: HTMLElement): string[] {
  const main = container.querySelector("main");
  if (!main) return [];
  return [...main.querySelectorAll("section[aria-label]")].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("Dashboard composition / section order (case 9)", () => {
  it("renders Needs attention → Recent issues → Recent runs → Health strip in DOM order", () => {
    const attentionItems = buildAttentionItems({
      unhealthyFeeds: 2,
      failedRuns: 1,
      failedDelivery: 0,
    });
    const issue = makeRun({ $id: "issue-1" });
    const run = makeRun({ $id: "run-recent", status: "failed" });

    const { container } = render(
      <DashboardView
        attentionItems={attentionItems}
        recentIssues={[issue]}
        titleByRunId={new Map([["issue-1", "Resolved Title"]])}
        recentRuns={[run]}
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    expect(sectionOrderLabels(container)).toEqual([
      "Needs attention",
      "Recent issues",
      "Recent runs",
      "Health strip",
    ]);

    expect(screen.getByRole("heading", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent issues/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent runs/i })).toBeInTheDocument();
    expect(screen.getByTestId("health-card")).toBeInTheDocument();
    expect(screen.getByTestId("feeds-health-card")).toBeInTheDocument();
  });

  it("when issues error is set, shows issues alert and still renders runs / attention / health", () => {
    const attentionItems = buildAttentionItems({
      unhealthyFeeds: 1,
      failedRuns: 0,
      failedDelivery: 0,
    });
    const run = makeRun({ $id: "run-ok" });

    render(
      <DashboardView
        attentionItems={attentionItems}
        recentIssues={[]}
        issuesError="Unable to load recent issues"
        recentRuns={[run]}
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    const issuesSection = screen.getByRole("region", { name: /recent issues/i });
    expect(within(issuesSection).getByRole("alert")).toHaveTextContent(
      /unable to load recent issues/i,
    );

    expect(screen.getByRole("region", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /recent runs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /weekly tech/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/runs/"),
    );
    expect(screen.getByRole("region", { name: /health strip/i })).toBeInTheDocument();
    expect(screen.getByTestId("health-card")).toBeInTheDocument();
    expect(screen.getByTestId("feeds-health-card")).toBeInTheDocument();
  });

  it("shows failed-run attention even when Recent runs are all completed (C2 isolation)", () => {
    // Dedicated failed-runs fetch can populate attention while the unfiltered
    // Recent-runs snapshot only shows newer completed rows.
    const attentionItems = buildAttentionItems({
      unhealthyFeeds: 0,
      failedRuns: 2,
      failedDelivery: 0,
    });
    const completedRecent = makeRun({ $id: "run-recent-ok", status: "completed" });

    render(
      <DashboardView
        attentionItems={attentionItems}
        recentIssues={[]}
        recentRuns={[completedRecent]}
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    expect(screen.getByRole("link", { name: /2 failed runs/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /recent runs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /weekly tech/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/runs/"),
    );
  });
});
