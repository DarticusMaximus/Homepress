/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { RetentionControls } from "@/components/runs/retention-controls";

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

vi.mock("@/app/(protected)/runs/actions", () => ({
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

function renderControls(retentionDays = 30) {
  return render(<RetentionControls retentionDays={retentionDays} />);
}

const INPUT_LABEL = /keep run history for/i;
const ERROR_TOAST = "Retention must be a whole number between 1 and 365.";

describe("RetentionControls — input validation", () => {
  it.each<[string, string]>([
    ["abc", "non-numeric"],
    ["0", "below the minimum"],
    ["-5", "negative"],
    ["366", "above the maximum"],
  ])("rejects %s (%s) with an error toast and does not call the action", async (bad) => {
    mocks.updateRunRetentionSetting.mockResolvedValue({ ok: true, days: 30 });
    renderControls();

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: bad },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(ERROR_TOAST);
    });
    expect(mocks.updateRunRetentionSetting).not.toHaveBeenCalled();
  });

  it("truncates fractional input to an integer via parseInt (documents real behavior)", async () => {
    mocks.updateRunRetentionSetting.mockResolvedValue({ ok: true, days: 1 });
    renderControls();

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateRunRetentionSetting).toHaveBeenCalledWith(1);
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Run history kept for 1 days");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("initializes the input from the retentionDays prop", () => {
    renderControls(42);
    expect(screen.getByLabelText(INPUT_LABEL)).toHaveValue(42);
  });
});

describe("RetentionControls — Save action", () => {
  it("calls updateRunRetentionSetting with the parsed value and toasts success", async () => {
    mocks.updateRunRetentionSetting.mockResolvedValue({ ok: true, days: 14 });
    renderControls();

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateRunRetentionSetting).toHaveBeenCalledWith(14);
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Run history kept for 14 days");
  });

  it("toasts the returned error message when the action fails", async () => {
    mocks.updateRunRetentionSetting.mockResolvedValue({
      ok: false,
      error: "Database unavailable",
    });
    renderControls();

    fireEvent.change(screen.getByLabelText(INPUT_LABEL), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith("Database unavailable");
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("RetentionControls — Clean up now branches", () => {
  it("shows a success toast with the count when runs are deleted", async () => {
    mocks.purgeRunsNow.mockResolvedValue({ ok: true, deleted: 3, errors: 0 });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

    await waitFor(() => {
      expect(mocks.purgeRunsNow).toHaveBeenCalledTimes(1);
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Removed 3 old runs");
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it("singularises the toast when exactly one run is deleted", async () => {
    mocks.purgeRunsNow.mockResolvedValue({ ok: true, deleted: 1, errors: 0 });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledWith("Removed 1 old run");
    });
  });

  it("shows a neutral toast when there is nothing to remove", async () => {
    mocks.purgeRunsNow.mockResolvedValue({ ok: true, deleted: 0, errors: 0 });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledWith("No old runs to remove");
    });
  });

  it("shows a warning toast with both counts on partial failure (errors > 0)", async () => {
    mocks.purgeRunsNow.mockResolvedValue({ ok: true, deleted: 5, errors: 2 });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

    await waitFor(() => {
      expect(mocks.toast.warning).toHaveBeenCalledWith("Removed 5 old runs (2 failed)");
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("singularises the deleted count in the warning toast (deleted === 1)", async () => {
    mocks.purgeRunsNow.mockResolvedValue({ ok: true, deleted: 1, errors: 3 });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

    await waitFor(() => {
      expect(mocks.toast.warning).toHaveBeenCalledWith("Removed 1 old run (3 failed)");
    });
  });

  it("shows an error toast when purge fails", async () => {
    mocks.purgeRunsNow.mockResolvedValue({
      ok: false,
      error: "Something went wrong while cleaning up old runs.",
    });
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Something went wrong while cleaning up old runs.",
      );
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });
});

describe("RetentionControls — button disabled states", () => {
  it("disables the Save button and input while the save transition is pending", async () => {
    let resolveSave!: (v: { ok: true; days: number }) => void;
    mocks.updateRunRetentionSetting.mockImplementation(
      () =>
        new Promise<{ ok: true; days: number }>((r) => {
          resolveSave = r;
        }),
    );
    renderControls();

    const input = screen.getByLabelText(INPUT_LABEL);
    fireEvent.change(input, { target: { value: "14" } });
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    });
    expect(input).toBeDisabled();

    await act(async () => {
      resolveSave({ ok: true, days: 14 });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Run history kept for 14 days");
  });

  it("disables the Clean up now button while the purge transition is pending", async () => {
    let resolvePurge!: (v: { ok: true; deleted: number; errors: number }) => void;
    mocks.purgeRunsNow.mockImplementation(
      () =>
        new Promise<{ ok: true; deleted: number; errors: number }>((r) => {
          resolvePurge = r;
        }),
    );
    renderControls();

    const cleanButton = screen.getByRole("button", { name: "Clean up now" });
    expect(cleanButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(cleanButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cleaning…" })).toBeDisabled();
    });

    await act(async () => {
      resolvePurge({ ok: true, deleted: 2, errors: 0 });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clean up now" })).toBeEnabled();
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Removed 2 old runs");
  });
});
