/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { ToastProvider } from "@/components/toast-provider";
import { toast } from "@/lib/toast";

afterEach(() => {
  cleanup();
});

describe("ToastProvider", () => {
  it("renders a toast when success is called from @/lib/toast", async () => {
    render(
      <>
        <ToastProvider />
        <button onClick={() => toast.success("Newsletter saved")}>Trigger</button>
      </>,
    );

    const trigger = screen.getByText("Trigger");
    await act(async () => {
      trigger.click();
    });

    const toastEl = await screen.findByText("Newsletter saved", {}, { timeout: 3000 });
    expect(toastEl).toBeInTheDocument();
  });
});
