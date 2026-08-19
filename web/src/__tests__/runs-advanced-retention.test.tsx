/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RunsAdvancedRetention } from "@/components/runs/runs-advanced-retention";

const mocks = vi.hoisted(() => ({
  updateRunRetentionSetting: vi.fn(),
  purgeRunsNow: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/app/(protected)/admin/runs/actions", () => ({
  updateRunRetentionSetting: mocks.updateRunRetentionSetting,
  purgeRunsNow: mocks.purgeRunsNow,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

afterEach(() => {
  cleanup();
  mocks.updateRunRetentionSetting.mockReset();
  mocks.purgeRunsNow.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

const INPUT_LABEL = /keep run history for/i;
const HELPER_TEXT = /latest three completed runs/i;

function renderAdvanced(retentionDays = 30) {
  return render(<RunsAdvancedRetention retentionDays={retentionDays} />);
}

function expandAdvanced() {
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
}

describe("RunsAdvancedRetention — collapsed by default", () => {
  it("shows the Advanced trigger but hides retention controls", () => {
    renderAdvanced(30);

    expect(screen.getByRole("button", { name: "Advanced" })).toBeInTheDocument();
    expect(screen.queryByLabelText(INPUT_LABEL)).not.toBeInTheDocument();
    expect(document.getElementById("run-retention-days")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clean up now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByText(HELPER_TEXT)).not.toBeInTheDocument();
  });
});

describe("RunsAdvancedRetention — expand reveals controls", () => {
  it("reveals days input, Save, Clean up now, and helper text when Advanced opens", () => {
    renderAdvanced(30);

    expandAdvanced();

    expect(screen.getByLabelText(INPUT_LABEL)).toBeVisible();
    expect(document.getElementById("run-retention-days")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Clean up now" })).toBeVisible();
    expect(screen.getByText(HELPER_TEXT)).toBeVisible();
  });
});

describe("RunsAdvancedRetention — controls still work when open", () => {
  it("calls updateRunRetentionSetting after expand, change days, and Save", async () => {
    mocks.updateRunRetentionSetting.mockResolvedValue({ ok: true, days: 14 });
    renderAdvanced(30);

    expandAdvanced();

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateRunRetentionSetting).toHaveBeenCalledWith(14);
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Run history kept for 14 days");
  });
});
