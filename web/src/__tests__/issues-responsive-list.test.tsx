/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { formatIssueFallbackTitle, type Run } from "@newsletter/shared";
import { IssuesTable } from "@/components/issues/issues-table";

afterEach(() => {
  cleanup();
});

const ENDED_AT = "2026-03-15T14:35:00.000Z";
const STARTED_AT = "2026-03-15T14:30:00.000Z";

function makeIssue(overrides: Partial<Run> = {}): Run {
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

const fixtures: Run[] = [
  makeIssue({
    $id: "issue-alpha",
    newsletterName: "Weekly Tech",
    endedAt: ENDED_AT,
    startedAt: STARTED_AT,
  }),
  makeIssue({
    $id: "issue-beta",
    newsletterName: "Daily News",
    endedAt: "2026-04-01T09:02:00.000Z",
    startedAt: "2026-04-01T09:00:00.000Z",
    checkpointDraftId: "draft-2",
  }),
];

function formatIssueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
}

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("Issues dual presentation (ResponsiveList)", () => {
  it("renders table and cards with field and Open href parity", () => {
    render(<IssuesTable issues={fixtures} />);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const table = within(tableSlot);
    const cards = within(cardsSlot);

    for (const issue of fixtures) {
      const dateIso = issue.endedAt ?? issue.startedAt;
      const title = formatIssueFallbackTitle(issue.newsletterName, dateIso);
      const dateLabel = formatIssueDate(dateIso);
      const href = `/issues/${issue.$id}`;

      expect(table.getByText(title)).toBeInTheDocument();
      expect(cards.getByText(title)).toBeInTheDocument();

      expect(table.getByText(issue.newsletterName)).toBeInTheDocument();
      expect(cards.getByText(issue.newsletterName)).toBeInTheDocument();

      expect(table.getByText(dateLabel)).toBeInTheDocument();
      expect(cards.getByText(dateLabel)).toBeInTheDocument();

      expect(
        table.getAllByRole("link", { name: "Open" }).some((a) => a.getAttribute("href") === href),
      ).toBe(true);
      expect(
        cards.getAllByRole("link", { name: "Open" }).some((a) => a.getAttribute("href") === href),
      ).toBe(true);
    }

    expect(table.getAllByRole("link", { name: "Open" })).toHaveLength(fixtures.length);
    expect(cards.getAllByRole("link", { name: "Open" })).toHaveLength(fixtures.length);
  });
});
