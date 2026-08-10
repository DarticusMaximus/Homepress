/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type { FeedFailure, Run } from "@newsletter/shared";
import { RunsTable } from "@/components/runs/runs-table";
import type { FeedLookup } from "@/components/runs/run-failed-feeds";

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

const BROKEN_URL = "https://broken.example.com/feed.xml";
const OK_URL = "https://ok.example.com/feed.xml";

const feedLookup: FeedLookup = {
  [BROKEN_URL]: { name: "Broken Feed", unhealthy: true },
  [OK_URL]: { name: "OK Feed", unhealthy: false },
};

function failuresOf(
  items: Array<{ feedUrl: string; errorType?: string; errorMessage?: string; statusCode?: number }>,
): FeedFailure[] {
  return items.map((i) => {
    const f: FeedFailure = {
      feedUrl: i.feedUrl,
      errorType: (i.errorType as FeedFailure["errorType"]) ?? "NetworkError",
      errorMessage: i.errorMessage ?? "",
    };
    if (i.statusCode !== undefined) f.statusCode = i.statusCode;
    return f;
  });
}

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("Runs failed-feed indicators (Task 5)", () => {
  it("shows an em-dash for a run with empty failedFeeds (table + cards)", () => {
    const run = makeRun({ $id: "run-empty" });
    render(
      <RunsTable
        runs={[run]}
        feedLookup={feedLookup}
        failedFeedsByRun={{ "run-empty": [] }}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    // Header is present in the table.
    expect(table.getByText("Failed feeds")).toBeInTheDocument();

    // No unhealthy badge in either presentation for a run with no failures.
    expect(table.queryByTestId("run-unhealthy-badge")).toBeNull();
    expect(cards.queryByTestId("run-unhealthy-badge")).toBeNull();
  });

  it("resolves a failed URL to its feed name and shows the Unhealthy badge", () => {
    const run = makeRun({
      $id: "run-broken",
      status: "failed",
      failedPhase: "fetch",
      failureMessage: "some feeds failed",
    });
    render(
      <RunsTable
        runs={[run]}
        feedLookup={feedLookup}
        failedFeedsByRun={{
          "run-broken": failuresOf([
            {
              feedUrl: BROKEN_URL,
              errorType: "HttpError",
              errorMessage: "503",
              statusCode: 503,
            },
          ]),
        }}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    // Single failure: label is the resolved name.
    expect(table.getByText("Broken Feed")).toBeInTheDocument();
    expect(cards.getByText("Broken Feed")).toBeInTheDocument();

    // Unhealthy badge appears once in each presentation.
    expect(table.getByTestId("run-unhealthy-badge")).toHaveTextContent("Unhealthy");
    expect(cards.getByTestId("run-unhealthy-badge")).toHaveTextContent("Unhealthy");
  });

  it("shows a count summary for multiple failures and no badge when none are unhealthy", () => {
    const run = makeRun({ $id: "run-multi" });
    render(
      <RunsTable
        runs={[run]}
        feedLookup={feedLookup}
        failedFeedsByRun={{
          "run-multi": failuresOf([
            { feedUrl: OK_URL, errorMessage: "timeout" },
            {
              feedUrl: "https://unknown.example.com/feed",
              errorMessage: "dns",
            },
          ]),
        }}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    expect(table.getByText("2 feeds failed")).toBeInTheDocument();
    expect(cards.getByText("2 feeds failed")).toBeInTheDocument();

    // Neither failed URL is unhealthy -> no badge in either presentation.
    expect(table.queryByTestId("run-unhealthy-badge")).toBeNull();
    expect(cards.queryByTestId("run-unhealthy-badge")).toBeNull();
  });

  it("falls back to the raw URL when the feed is not in the lookup", () => {
    const unknownUrl = "https://mystery.example.com/rss";
    const run = makeRun({ $id: "run-unknown" });
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{
          "run-unknown": failuresOf([{ feedUrl: unknownUrl }]),
        }}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    expect(table.getByText(unknownUrl)).toBeInTheDocument();
    expect(cards.getByText(unknownUrl)).toBeInTheDocument();
    expect(table.queryByTestId("run-unhealthy-badge")).toBeNull();
  });
});
