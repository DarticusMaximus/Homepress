/// <reference types="@testing-library/jest-dom" />

import type { ReactNode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Run, RunStatus } from "@newsletter/shared";
import { formatRunDateTime } from "@/components/runs/run-display";
import { RunsTable } from "@/components/runs/runs-table";
import { RunsView } from "@/components/runs/runs-view";
import { formatRunStatusLabel } from "@/lib/status-labels";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** Native select stand-in — Radix Select needs scrollIntoView in jsdom. */
vi.mock("@/components/ui/select", () => {
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) {
    return (
      <select
        data-testid="mock-select"
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {children}
      </select>
    );
  }
  function SelectTrigger({
    id,
    children,
  }: {
    id?: string;
    children?: ReactNode;
    className?: string;
  }) {
    return <span id={id}>{children}</span>;
  }
  function SelectValue() {
    return null;
  }
  function SelectContent({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  function SelectItem({ value, children }: { value: string; children?: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

afterEach(() => {
  cleanup();
});

const STARTED_AT = "2026-03-15T14:30:00.000Z";
const ENDED_AT = "2026-03-15T14:35:00.000Z";

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
    checkpointDraftId: "",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    ...overrides,
  };
}

const fixtures: Run[] = [
  makeRun({
    $id: "run-completed",
    newsletterName: "Weekly Tech",
    status: "completed",
    completedPhase: "draft",
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
  }),
  makeRun({
    $id: "run-failed",
    newsletterName: "Daily News",
    status: "failed",
    failedPhase: "score",
    failureMessage: "Upstream API returned 503",
    startedAt: "2026-04-01T09:00:00.000Z",
    endedAt: "2026-04-01T09:02:00.000Z",
  }),
];

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("Runs dual presentation (ResponsiveList)", () => {
  it("renders table and cards with field parity", () => {
    render(
      <RunsTable
        runs={fixtures}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const table = within(tableSlot);
    const cards = within(cardsSlot);

    for (const run of fixtures) {
      expect(table.getByText(run.newsletterName)).toBeInTheDocument();
      expect(cards.getByText(run.newsletterName)).toBeInTheDocument();

      expect(table.getByText(formatRunStatusLabel(run.status))).toBeInTheDocument();
      expect(cards.getByText(formatRunStatusLabel(run.status))).toBeInTheDocument();
    }

    const completedStarted = formatRunDateTime(STARTED_AT);
    expect(table.getByText(completedStarted)).toBeInTheDocument();
    expect(cards.getByText(completedStarted)).toBeInTheDocument();

    expect(table.getByText("Upstream API returned 503")).toBeInTheDocument();
    expect(cards.getByText("Upstream API returned 503")).toBeInTheDocument();

    expect(table.getByText("draft")).toBeInTheDocument();
    expect(cards.getByText("draft")).toBeInTheDocument();

    expect(table.getByText("score")).toBeInTheDocument();
    expect(cards.getByText("score")).toBeInTheDocument();
  });

  it("renders a Retry button only on failed runs (Task 4)", () => {
    // fixtures contain exactly one failed run and one non-failed run.
    render(
      <RunsTable
        runs={fixtures}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const failedCount = fixtures.filter((r) => r.status === "failed").length;

    // Retry button IS present, one per failed run, in both slots.
    expect(within(tableSlot).getAllByRole("button", { name: /retry/i })).toHaveLength(failedCount);
    expect(within(cardsSlot).getAllByRole("button", { name: /retry/i })).toHaveLength(failedCount);

    // The completed (non-failed) run renders no Retry button: render a
    // non-failed-only set and assert none appear in either slot.
    const nonFailed = fixtures.filter((r) => r.status !== "failed");
    cleanup();
    render(
      <RunsTable
        runs={nonFailed}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const tableSlotNoFail = getSlot("domain-list-table");
    const cardsSlotNoFail = getSlot("domain-list-cards");

    expect(within(tableSlotNoFail).queryByRole("button", { name: /retry/i })).toBeNull();
    expect(within(cardsSlotNoFail).queryByRole("button", { name: /retry/i })).toBeNull();
  });
});

describe("Runs status filter labels (title case)", () => {
  const RUN_STATUSES: RunStatus[] = ["pending", "running", "completed", "failed"];

  it("shows title-case option text while SelectItem values stay lowercase", () => {
    render(
      <RunsView
        runs={[]}
        newsletters={[]}
        currentNewsletterId=""
        currentStatus=""
        total={0}
        page={1}
        totalPages={1}
        loadError={null}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    // Newsletter select is first; status filter is second (label not wired to mock <select>).
    const selects = screen.getAllByTestId("mock-select");
    expect(selects.length).toBeGreaterThanOrEqual(2);
    const statusSelect = selects[1];
    for (const status of RUN_STATUSES) {
      const option = within(statusSelect).getByRole("option", {
        name: formatRunStatusLabel(status),
      }) as HTMLOptionElement;
      expect(option.value).toBe(status);
      expect(option.textContent).toBe(formatRunStatusLabel(status));
    }
  });
});
