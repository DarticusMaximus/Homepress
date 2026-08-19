/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Feed } from "@newsletter/shared";
import { FeedsView } from "@/components/feeds/feeds-view";

afterEach(() => {
  cleanup();
});

const healthyFeed: Feed = {
  $id: "feed-alpha",
  name: "Alpha Feed",
  url: "https://alpha.example.com/feed.xml",
  notes: "",
  status: "ok",
  lastTestedAt: null,
  lastTestError: null,
  operationalHealth: "healthy",
  consecutiveFetchFailures: 0,
  lastFetchError: "",
  lastFetchAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("FeedsView — health filter UX (C7, U2)", () => {
  it("shows filter-aware empty state when filtered with zero results", () => {
    render(<FeedsView feeds={[]} total={0} health="unhealthy" />);

    expect(screen.queryByText(/No feeds yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No unhealthy feeds/i)).toBeInTheDocument();
  });

  it("shows greenfield empty state when unfiltered with zero feeds", () => {
    render(<FeedsView feeds={[]} total={0} />);

    expect(screen.getByText(/No feeds yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No unhealthy feeds/i)).not.toBeInTheDocument();
  });

  it("shows filter indicator and clear link when filter is active (empty)", () => {
    render(<FeedsView feeds={[]} total={0} health="unhealthy" />);

    const indicator = screen.getByTestId("feeds-filter-indicator");
    expect(indicator).toHaveTextContent(/unhealthy only/i);

    const clearLink = screen.getByTestId("feeds-clear-filter");
    expect(clearLink).toHaveAttribute("href", "/admin/feeds");
    expect(clearLink).not.toHaveAttribute("href", expect.stringContaining("health="));
  });

  it("shows filter indicator and clear link when filter is active (non-empty)", () => {
    render(<FeedsView feeds={[healthyFeed]} total={1} health="unhealthy" />);

    expect(screen.getByTestId("feeds-filter-indicator")).toHaveTextContent(/unhealthy only/i);
    expect(screen.getByTestId("feeds-clear-filter")).toHaveAttribute("href", "/admin/feeds");
  });

  it("does not show filter indicator when no filter is active", () => {
    render(<FeedsView feeds={[healthyFeed]} total={1} />);

    expect(screen.queryByTestId("feeds-filter-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feeds-clear-filter")).not.toBeInTheDocument();
  });
});
