/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HealthCheckResult } from "@newsletter/shared";
import { HealthCard } from "@/components/health-card/health-card";

vi.mock("@/components/health-card/actions", () => ({
  revalidateHealthCheck: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function okResult(): HealthCheckResult {
  return {
    status: "ok",
    checkedAt: "2026-07-21T12:00:00.000Z",
    documentId: "doc-1",
    steps: [
      { step: "create", status: "ok", durationMs: 12 },
      { step: "read", status: "ok", durationMs: 8 },
      { step: "delete", status: "ok", durationMs: 5 },
    ],
  };
}

function failedResult(): HealthCheckResult & { error?: string } {
  return {
    status: "failed",
    checkedAt: "2026-07-21T12:00:00.000Z",
    steps: [
      {
        step: "create",
        status: "failed",
        durationMs: 3,
        errorCode: 404,
        errorMessage: "Collection not found",
      },
    ],
  };
}

describe("HealthCard — compact healthy density (case 8)", () => {
  it("hides per-step list when status is ok and there is no error", () => {
    render(<HealthCard result={okResult()} />);

    expect(screen.getByTestId("health-card")).toHaveAttribute("data-density", "compact");
    expect(screen.getByTestId("health-badge")).toHaveTextContent("Healthy");
    expect(screen.getByRole("button", { name: /re-run/i })).toBeInTheDocument();

    expect(screen.queryByTestId("health-step-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("health-step-read")).not.toBeInTheDocument();
    expect(screen.queryByTestId("health-step-delete")).not.toBeInTheDocument();
  });
});

describe("HealthCard — expanded unhealthy/error (case 8)", () => {
  it("shows failed step detail, alert, and Re-run when unhealthy", () => {
    render(<HealthCard result={failedResult()} />);

    expect(screen.getByTestId("health-card")).toHaveAttribute("data-density", "expanded");
    expect(screen.getByTestId("health-badge")).toHaveTextContent("Unhealthy");
    expect(screen.getByTestId("health-step-create")).toBeInTheDocument();
    // Message appears on the failed step row and in the alert body.
    expect(screen.getAllByText(/404 Collection not found/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/one or more steps failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-run/i })).toBeInTheDocument();
  });

  it("shows alert and Re-run when page-level error is present", () => {
    const result: HealthCheckResult & { error?: string } = {
      status: "failed",
      checkedAt: "2026-07-21T12:00:00.000Z",
      steps: [
        {
          step: "create",
          status: "failed",
          durationMs: 0,
          errorMessage: "Unable to run database health check",
        },
      ],
      error: "Unable to run database health check",
    };

    render(<HealthCard result={result} />);

    expect(screen.getByTestId("health-card")).toHaveAttribute("data-density", "expanded");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/one or more steps failed/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Unable to run database health check/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /re-run/i })).toBeInTheDocument();
  });
});
