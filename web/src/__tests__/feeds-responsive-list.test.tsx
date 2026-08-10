/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type { Feed } from "@newsletter/shared";
import { FeedsTable } from "@/components/feeds/feeds-table";
import { formatFeedHealthLabel, formatFeedStatusLabel } from "@/lib/status-labels";

afterEach(() => {
  cleanup();
});

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const ALPHA_UPDATED_AT = "2026-03-15T14:30:00.000Z";
const BETA_UPDATED_AT = "2026-04-01T09:00:00.000Z";

const fixtures: Feed[] = [
  {
    $id: "feed-alpha",
    name: "Alpha Feed",
    url: "https://alpha.example.com/feed.xml",
    notes: "Alpha notes",
    status: "ok",
    lastTestedAt: "2026-03-15T14:00:00.000Z",
    lastTestError: null,
    operationalHealth: "healthy",
    consecutiveFetchFailures: 0,
    lastFetchError: "",
    lastFetchAt: "2026-03-15T14:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: ALPHA_UPDATED_AT,
  },
  {
    $id: "feed-beta",
    name: "Beta Feed",
    url: "https://beta.example.com/rss",
    notes: "",
    status: "failed",
    lastTestedAt: "2026-04-01T08:00:00.000Z",
    lastTestError: "Connection timed out",
    operationalHealth: "unhealthy",
    consecutiveFetchFailures: 3,
    lastFetchError: "upstream 502",
    lastFetchAt: "2026-04-01T08:00:00.000Z",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: BETA_UPDATED_AT,
  },
];

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("Feeds dual presentation (ResponsiveList)", () => {
  it("renders table and cards with field and action parity", () => {
    render(<FeedsTable feeds={fixtures} />);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const table = within(tableSlot);
    const cards = within(cardsSlot);

    for (const feed of fixtures) {
      expect(table.getByText(feed.name)).toBeInTheDocument();
      expect(cards.getByText(feed.name)).toBeInTheDocument();

      expect(table.getByText(formatFeedStatusLabel(feed.status))).toBeInTheDocument();
      expect(cards.getByText(formatFeedStatusLabel(feed.status))).toBeInTheDocument();

      expect(table.getByText(feed.url)).toBeInTheDocument();
      expect(cards.getByText(feed.url)).toBeInTheDocument();
    }

    expect(table.getByText("Alpha notes")).toBeInTheDocument();
    expect(cards.getByText("Alpha notes")).toBeInTheDocument();

    const emptyMarkersTable = table.getAllByText("—");
    const emptyMarkersCards = cards.getAllByText("—");
    expect(emptyMarkersTable.length).toBeGreaterThanOrEqual(1);
    expect(emptyMarkersCards.length).toBeGreaterThanOrEqual(1);

    const alphaUpdated = formatUpdatedAt(ALPHA_UPDATED_AT);
    const betaUpdated = formatUpdatedAt(BETA_UPDATED_AT);

    expect(table.getByText(alphaUpdated)).toBeInTheDocument();
    expect(cards.getByText(alphaUpdated)).toBeInTheDocument();
    expect(table.getByText(betaUpdated)).toBeInTheDocument();
    expect(cards.getByText(betaUpdated)).toBeInTheDocument();

    const editTable = table.getAllByRole("button", { name: /^Edit / });
    const editCards = cards.getAllByRole("button", { name: /^Edit / });
    const deleteTable = table.getAllByRole("button", { name: /^Delete / });
    const deleteCards = cards.getAllByRole("button", { name: /^Delete / });

    expect(editTable.length).toBe(fixtures.length);
    expect(editCards.length).toBe(fixtures.length);
    expect(deleteTable.length).toBe(fixtures.length);
    expect(deleteCards.length).toBe(fixtures.length);

    const testTable = table.queryAllByRole("button", { name: /^Test/i });
    const testCards = cards.queryAllByRole("button", { name: /^Test/i });
    if (testTable.length > 0) {
      expect(testCards.length).toBe(testTable.length);
    }
  });

  it("renders a Health badge with the right variant per feed (Task 4)", () => {
    render(<FeedsTable feeds={fixtures} />);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const table = within(tableSlot);
    const cards = within(cardsSlot);

    // Both presentations show every feed's operational health label (title case).
    for (const feed of fixtures) {
      expect(table.getByText(formatFeedHealthLabel(feed.operationalHealth))).toBeInTheDocument();
      expect(cards.getByText(formatFeedHealthLabel(feed.operationalHealth))).toBeInTheDocument();
    }

    // Unhealthy feeds get the destructive variant in both table and cards.
    const unhealthyBadges = [
      ...table.getAllByTestId("feed-health-badge"),
      ...cards.getAllByTestId("feed-health-badge"),
    ];
    const unhealthyDestructive = unhealthyBadges.filter(
      (b) => b.getAttribute("data-variant") === "destructive",
    );
    expect(unhealthyDestructive.length).toBeGreaterThanOrEqual(2);

    // Fetch failures count is shown for the unhealthy feed (3) in both.
    expect(table.getByText("3")).toBeInTheDocument();
    expect(cards.getByText("3")).toBeInTheDocument();
  });
});
