/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import { RunsTable } from "@/components/runs/runs-table";
import { InspectShell } from "@/components/runs/inspect-shell";

afterEach(() => {
  cleanup();
});

const STARTED_AT = "2026-03-15T14:30:00.000Z";
const ENDED_AT = "2026-03-15T14:35:00.000Z";

const missingPhase = { status: "missing" as const };

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
    // Delivery fields set as if badges would show — Runs/Inspect must stay chrome-free.
    emailDeliveryStatus: "sent",
    emailDeliveryAt: ENDED_AT,
    emailDeliveryError: "",
    rssDeliveryStatus: "published",
    rssDeliveryAt: ENDED_AT,
    rssDeliveryError: "",
    ...overrides,
  };
}

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

/** DeliveryStatusBadge cluster: Sent / Published / Failed + Email/RSS chrome labels. */
function expectNoDeliveryBadgeCluster(scope: ReturnType<typeof within> | typeof screen) {
  expect(scope.queryByText("Sent")).not.toBeInTheDocument();
  expect(scope.queryByText("Published")).not.toBeInTheDocument();
  expect(scope.queryByText("Failed")).not.toBeInTheDocument();
  expect(scope.queryByText("Email")).not.toBeInTheDocument();
  expect(scope.queryByText("RSS")).not.toBeInTheDocument();
  expect(scope.queryByText("Email:")).not.toBeInTheDocument();
  expect(scope.queryByText("RSS:")).not.toBeInTheDocument();
  expect(scope.queryByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();
  expect(scope.queryByRole("columnheader", { name: "RSS" })).not.toBeInTheDocument();
}

describe("Runs / Inspect — no delivery badges (T1)", () => {
  it("Runs list table and cards omit Email/RSS delivery badge cluster", () => {
    const run = makeRun({
      emailDeliveryStatus: "sent",
      rssDeliveryStatus: "failed",
    });

    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    expectNoDeliveryBadgeCluster(within(getSlot("domain-list-table")));
    expectNoDeliveryBadgeCluster(within(getSlot("domain-list-cards")));
  });

  it("Inspect shell omits Email/RSS delivery badge cluster even when delivery fields are set", () => {
    const run = makeRun({
      emailDeliveryStatus: "failed",
      rssDeliveryStatus: "published",
    });

    render(
      <InspectShell
        run={run}
        fetchResult={missingPhase}
        scrapeResult={missingPhase}
        tagResult={missingPhase}
        scoreResult={missingPhase}
        selectionResult={missingPhase}
        draftResult={missingPhase}
        suppressSummary={{ count: 0, items: [] }}
        runLookup={{}}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Inspect" })).toBeInTheDocument();
    expectNoDeliveryBadgeCluster(screen);
  });
});
