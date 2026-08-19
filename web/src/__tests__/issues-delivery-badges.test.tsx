/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import { IssuesTable } from "@/components/issues/issues-table";
import { IssueListCard } from "@/components/issues/issue-list-card";
import {
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";

vi.mock("@/components/issues/send-issue-button", () => ({
  SendIssueButton: ({ runId }: { runId: string }) => (
    <button type="button" data-testid={`send-${runId}`}>
      Send
    </button>
  ),
}));

vi.mock("@/components/issues/publish-issue-button", () => ({
  PublishIssueButton: ({ runId }: { runId: string }) => (
    <button type="button" data-testid={`publish-${runId}`}>
      Publish
    </button>
  ),
}));

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

describe("Issues delivery badges (case 17)", () => {
  it("shows Email + RSS badges on Issues table and cards from run fields", () => {
    const issue = makeIssue({
      emailDeliveryStatus: "sent",
      rssDeliveryStatus: "failed",
    });

    render(<IssuesTable issues={[issue]} />);

    const table = within(getSlot("domain-list-table"));
    expect(table.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    expect(table.getByRole("columnheader", { name: "RSS" })).toBeInTheDocument();
    expect(table.getByText("Sent")).toBeInTheDocument();
    expect(table.getByText("Failed")).toBeInTheDocument();

    const cards = within(getSlot("domain-list-cards"));
    expect(cards.getByText("Email:")).toBeInTheDocument();
    expect(cards.getByText("RSS:")).toBeInTheDocument();
    expect(cards.getByText("Sent")).toBeInTheDocument();
    expect(cards.getByText("Failed")).toBeInTheDocument();
  });

  it("renders none status as em dash on list card", () => {
    const issue = makeIssue({
      emailDeliveryStatus: "none",
      rssDeliveryStatus: "none",
    });

    render(<IssueListCard issue={issue} />);

    expect(screen.getByText("Email:")).toBeInTheDocument();
    expect(screen.getByText("RSS:")).toBeInTheDocument();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows compact badges on issue detail success chrome", () => {
    const run = makeIssue({
      emailDeliveryStatus: "failed",
      rssDeliveryStatus: "published",
    });

    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." showOps />);

    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("RSS")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByTestId(`send-${run.$id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`publish-${run.$id}`)).toBeInTheDocument();
  });

  it("does not show delivery badges on load-error path", () => {
    const run = makeIssue({
      emailDeliveryStatus: "sent",
      rssDeliveryStatus: "published",
    });

    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    // Labels alone should not appear without the success chrome badge cluster.
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
  });

  it("does not show delivery badges on not-available path", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
  });

  it("does not show delivery badges on bare load-error path", () => {
    render(<IssueReaderLoadErrorBare />);

    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
  });
});
