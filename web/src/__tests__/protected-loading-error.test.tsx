/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProtectedLoading from "@/app/(protected)/loading";
import ProtectedError from "@/app/(protected)/error";

afterEach(() => {
  cleanup();
});

describe("protected loading fallback", () => {
  it("shows operator-visible Loading… content", () => {
    render(<ProtectedLoading />);

    expect(screen.getByTestId("protected-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

describe("protected error fallback", () => {
  it("shows a safe message and Try again invokes reset", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("AppwriteException: document_not_found"), {
      digest: "digest-abc",
      stack: "Error: AppwriteException\n    at Object.<anonymous>",
    });

    render(<ProtectedError error={error} reset={reset} />);

    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/AppwriteException/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/document_not_found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/digest-abc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Object\.<anonymous>/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
