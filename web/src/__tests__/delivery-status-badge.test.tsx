/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";

afterEach(() => {
  cleanup();
});

describe("DeliveryStatusBadge", () => {
  it("renders locked email labels and variants", () => {
    const { rerender } = render(<DeliveryStatusBadge channel="email" status="none" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<DeliveryStatusBadge channel="email" status="sent" />);
    const sent = screen.getByText("Sent");
    expect(sent).toBeInTheDocument();
    expect(sent.closest("[data-slot='badge']")).toHaveAttribute("data-variant", "default");

    rerender(<DeliveryStatusBadge channel="email" status="failed" />);
    const failed = screen.getByText("Failed");
    expect(failed).toBeInTheDocument();
    expect(failed.closest("[data-slot='badge']")).toHaveAttribute("data-variant", "destructive");
  });

  it("renders locked RSS labels and variants", () => {
    const { rerender } = render(<DeliveryStatusBadge channel="rss" status="none" />);
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(<DeliveryStatusBadge channel="rss" status="published" />);
    const published = screen.getByText("Published");
    expect(published).toBeInTheDocument();
    expect(published.closest("[data-slot='badge']")).toHaveAttribute("data-variant", "default");

    rerender(<DeliveryStatusBadge channel="rss" status="failed" />);
    const failed = screen.getByText("Failed");
    expect(failed).toBeInTheDocument();
    expect(failed.closest("[data-slot='badge']")).toHaveAttribute("data-variant", "destructive");
  });
});
