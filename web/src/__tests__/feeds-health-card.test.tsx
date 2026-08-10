/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FeedsHealthCard } from "@/components/feeds-health-card/feeds-health-card";

afterEach(() => {
  cleanup();
});

describe("FeedsHealthCard — compact healthy density (case 7)", () => {
  it('shows a "Healthy" badge and links to /feeds', () => {
    render(<FeedsHealthCard unhealthyCount={0} />);

    expect(screen.getByTestId("feeds-health-card")).toHaveAttribute("data-density", "compact");
    expect(screen.getByTestId("feeds-health-badge")).toHaveTextContent("Healthy");
    const link = screen.getByTestId("feeds-health-link");
    expect(link).toHaveAttribute("href", "/feeds");
    expect(link).not.toHaveAttribute("href", expect.stringContaining("health="));
    expect(link).toHaveTextContent(/view feeds/i);
  });

  it("omits the large healthy body copy (compact footprint)", () => {
    render(<FeedsHealthCard unhealthyCount={0} />);
    expect(screen.queryByText(/operationally healthy/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ok")).not.toBeInTheDocument();
  });
});

describe("FeedsHealthCard — unhealthy state (unhealthyCount > 0)", () => {
  it("links to /feeds?health=unhealthy and shows the count", () => {
    render(<FeedsHealthCard unhealthyCount={3} />);

    expect(screen.getByTestId("feeds-health-card")).toHaveAttribute("data-density", "expanded");
    expect(screen.getByTestId("feeds-health-badge")).toHaveTextContent("Unhealthy");
    expect(screen.getByTestId("feeds-unhealthy-count")).toHaveTextContent("3");
    const link = screen.getByTestId("feeds-health-link");
    expect(link.getAttribute("href")).toContain("health=unhealthy");
  });

  it("pluralises the feed label for counts > 1", () => {
    render(<FeedsHealthCard unhealthyCount={5} />);
    expect(screen.getByTestId("feeds-health-card")).toHaveTextContent(
      /5 unhealthy feeds need attention/i,
    );
  });

  it("uses singular label when count is exactly 1", () => {
    render(<FeedsHealthCard unhealthyCount={1} />);
    expect(screen.getByTestId("feeds-health-card")).toHaveTextContent(
      /1 unhealthy feed needs attention/i,
    );
  });
});

describe("FeedsHealthCard — error state", () => {
  it("shows an Error badge and the safe message without crashing", () => {
    const safeMessage = "Something went wrong while talking to the database.";
    render(<FeedsHealthCard unhealthyCount={0} error={safeMessage} />);

    expect(screen.getByTestId("feeds-health-card")).toHaveAttribute("data-density", "expanded");
    expect(screen.getByTestId("feeds-health-badge")).toHaveTextContent("Error");
    expect(screen.getByText(safeMessage)).toBeInTheDocument();
  });

  it("falls back to a /feeds link on error (not the unhealthy filter)", () => {
    render(<FeedsHealthCard unhealthyCount={0} error="boom" />);
    const link = screen.getByTestId("feeds-health-link");
    expect(link).toHaveAttribute("href", "/feeds");
  });
});
