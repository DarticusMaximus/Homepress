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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Task 1 fixture — `trigger` lands on `Run` in Task 2. */
type RunWithTrigger = Run & { trigger: "manual" | "scheduled" };

function makeRun(overrides: Partial<RunWithTrigger> = {}): RunWithTrigger {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Weekly Tech",
    status: "completed",
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
    checkpointDraftId: "",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    trigger: "manual",
    ...overrides,
  };
}

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

const missingPhase = { status: "missing" as const };

describe("Runs list trigger labels (Feature 06 Task 1 case 10)", () => {
  it("renders Manual and Scheduled in both table and card slots", () => {
    const fixtures: RunWithTrigger[] = [
      makeRun({
        $id: "run-manual",
        newsletterName: "Manual Digest",
        trigger: "manual",
      }),
      makeRun({
        $id: "run-scheduled",
        newsletterName: "Scheduled Digest",
        status: "completed",
        trigger: "scheduled",
        startedAt: "2026-04-01T09:00:00.000Z",
        endedAt: "2026-04-01T09:05:00.000Z",
      }),
    ];

    render(
      <RunsTable
        runs={fixtures as Run[]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    expect(table.getByText("Manual")).toBeInTheDocument();
    expect(table.getByText("Scheduled")).toBeInTheDocument();
    expect(cards.getByText("Manual")).toBeInTheDocument();
    expect(cards.getByText("Scheduled")).toBeInTheDocument();

    expect(table.getByText("Manual Digest")).toBeInTheDocument();
    expect(cards.getByText("Manual Digest")).toBeInTheDocument();
    expect(table.getByText("Scheduled Digest")).toBeInTheDocument();
    expect(cards.getByText("Scheduled Digest")).toBeInTheDocument();
  });
});

describe("Inspect shell trigger in meta (Feature 06 Task 1 case 11)", () => {
  it("includes Scheduled in the meta line for a scheduled run", () => {
    const run = makeRun({
      newsletterName: "Morning Brief",
      status: "completed",
      trigger: "scheduled",
    });

    render(
      <InspectShell
        run={run as Run}
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

    const dateLabel = new Date(STARTED_AT).toLocaleDateString(undefined, { dateStyle: "short" });
    expect(
      screen.getByText(
        new RegExp(
          `Morning Brief\\s*·\\s*Completed\\s*·\\s*Scheduled\\s*·\\s*${escapeRegExp(dateLabel)}`,
        ),
      ),
    ).toBeInTheDocument();
  });

  it("includes Manual in the meta line for a manual run", () => {
    const run = makeRun({
      newsletterName: "On Demand",
      status: "failed",
      failedPhase: "score",
      trigger: "manual",
    });

    render(
      <InspectShell
        run={run as Run}
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

    const dateLabel = new Date(STARTED_AT).toLocaleDateString(undefined, { dateStyle: "short" });
    expect(
      screen.getByText(
        new RegExp(
          `On Demand\\s*·\\s*Failed\\s*·\\s*Manual\\s*·\\s*${escapeRegExp(dateLabel)}`,
        ),
      ),
    ).toBeInTheDocument();
  });
});
