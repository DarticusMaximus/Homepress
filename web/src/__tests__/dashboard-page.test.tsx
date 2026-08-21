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
    issueTitle: "",
    issueDek: "",
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

describe("Admin hub composition / section order", () => {
  it("renders Needs attention → Recent runs → Health strip in DOM order", () => {
    const attentionItems = buildAttentionItems({
      unhealthyFeeds: 2,
      failedRuns: 1,
      failedDelivery: 0,
    });
    const run = makeRun({ $id: "run-recent", status: "failed" });

    const { container } = render(
      <DashboardView
        attentionItems={attentionItems}
        recentRuns={[run]}
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    expect(sectionOrderLabels(container)).toEqual([
      "Needs attention",
      "Recent runs",
      "Health strip",
    ]);

    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /recent issues/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent runs/i })).toBeInTheDocument();
    expect(screen.getByTestId("health-card")).toBeInTheDocument();
    expect(screen.getByTestId("feeds-health-card")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Factory" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Factory" })).toBeNull();
  });

  it("when runs error is set, shows runs alert and still renders attention / health without a Factory dump", () => {
    const attentionItems = buildAttentionItems({
      unhealthyFeeds: 1,
      failedRuns: 0,
      failedDelivery: 0,
    });

    render(
      <DashboardView
        attentionItems={attentionItems}
        recentRuns={[]}
        runsError="Unable to load recent runs"
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    const runsSection = screen.getByRole("region", { name: /recent runs/i });
    expect(within(runsSection).getByRole("alert")).toHaveTextContent(
      /unable to load recent runs/i,
    );

    expect(screen.getByRole("region", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /health strip/i })).toBeInTheDocument();
    expect(screen.getByTestId("health-card")).toBeInTheDocument();
    expect(screen.getByTestId("feeds-health-card")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Factory" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Factory" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /recent issues/i })).not.toBeInTheDocument();
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
        recentRuns={[completedRecent]}
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    expect(screen.getByRole("link", { name: /2 failed runs/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /recent runs/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /weekly tech/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/admin/runs/"),
    );
  });
});
