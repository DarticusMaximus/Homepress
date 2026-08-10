/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AttachmentRecord, Feed, FeedStatus } from "@newsletter/shared";
import { FeedHealthBadge } from "@/components/feeds/feed-health";
import { FeedsTable } from "@/components/feeds/feeds-table";
import { NewsletterFeedsSection } from "@/components/newsletters/newsletter-feeds-section";

vi.mock("@/app/(protected)/newsletters/actions", () => ({
  attachFeedToNewsletter: vi.fn(),
  detachFeedFromNewsletter: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    $id: "feed-1",
    name: "Example Feed",
    url: "https://example.com/rss",
    notes: "",
    status: "untested",
    lastTestedAt: null,
    lastTestError: null,
    operationalHealth: "healthy",
    consecutiveFetchFailures: 0,
    lastFetchError: "",
    lastFetchAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    $id: "att-1",
    attachmentId: "att-1",
    newsletterId: "nl-1",
    feedId: "feed-1",
    feedName: "Attached Feed",
    feedUrl: "https://example.com/rss",
    feedStatus: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Feed qualification badges (UI title case)", () => {
  const statuses: FeedStatus[] = ["untested", "ok", "failed"];
  const labels = ["Untested", "Ok", "Failed"] as const;

  it("Feeds table/cards render Untested / Ok / Failed", () => {
    const feeds = statuses.map((status, i) =>
      makeFeed({
        $id: `feed-${status}`,
        name: `${status} feed`,
        status,
        operationalHealth: status === "failed" ? "unhealthy" : "healthy",
        consecutiveFetchFailures: status === "failed" ? 3 : 0,
        updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      }),
    );

    render(<FeedsTable feeds={feeds} />);

    const table = within(document.querySelector('[data-slot="domain-list-table"]') as HTMLElement);
    const cards = within(document.querySelector('[data-slot="domain-list-cards"]') as HTMLElement);

    for (const label of labels) {
      expect(table.getByText(label)).toBeInTheDocument();
      expect(cards.getByText(label)).toBeInTheDocument();
    }

    for (const raw of statuses) {
      expect(table.queryByText(raw, { exact: true })).toBeNull();
      expect(cards.queryByText(raw, { exact: true })).toBeNull();
    }
  });
});

describe("FeedHealthBadge (UI title case)", () => {
  it("renders Healthy and Unhealthy", () => {
    const { rerender } = render(<FeedHealthBadge feed={{ operationalHealth: "healthy" }} />);
    expect(screen.getByTestId("feed-health-badge")).toHaveTextContent("Healthy");

    rerender(<FeedHealthBadge feed={{ operationalHealth: "unhealthy" }} />);
    expect(screen.getByTestId("feed-health-badge")).toHaveTextContent("Unhealthy");
  });
});

describe("Newsletter attached-feed status badges (UI title case)", () => {
  it("uses the same qualification title-case labels", () => {
    const attached = (
      [
        ["untested", "Untested"],
        ["ok", "Ok"],
        ["failed", "Failed"],
      ] as const
    ).map(([feedStatus, _label], i) =>
      makeAttachment({
        $id: `att-${feedStatus}`,
        attachmentId: `att-${feedStatus}`,
        feedId: `feed-${feedStatus}`,
        feedName: `${feedStatus} attached`,
        feedStatus,
        createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      }),
    );

    render(
      <NewsletterFeedsSection newsletterId="nl-1" attachedFeeds={attached} eligibleFeeds={[]} />,
    );

    expect(screen.getByText("Untested")).toBeInTheDocument();
    expect(screen.getByText("Ok")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();

    for (const raw of ["untested", "ok", "failed"] as const) {
      expect(screen.queryByText(raw, { exact: true })).toBeNull();
    }
  });
});
