/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { EmailDeliveryStatus, RssDeliveryStatus } from "@newsletter/shared";
import { RegenerateDraftButton } from "@/components/runs/regenerate-draft-button";

const mocks = vi.hoisted(() => ({
  regenerateDraft: vi.fn(),
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
  regenerateDraft: mocks.regenerateDraft,
  retryFailedRun: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

afterEach(() => {
  cleanup();
  mocks.regenerateDraft.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

const BODY =
  "Replace this issue’s draft with a new one from the same selected articles? Fetch, tags, scores, and selection will not run again.";
const DELIVERY_WARNING =
  "Email and RSS already delivered will not be updated. Send or Publish again if you want the new draft delivered.";

function renderButton(
  overrides: {
    emailDeliveryStatus?: EmailDeliveryStatus;
    rssDeliveryStatus?: RssDeliveryStatus;
  } = {},
) {
  return render(
    <RegenerateDraftButton
      runId="run-1"
      newsletterName="Weekly Tech"
      emailDeliveryStatus={overrides.emailDeliveryStatus ?? "none"}
      rssDeliveryStatus={overrides.rssDeliveryStatus ?? "none"}
    />,
  );
}

describe("RegenerateDraftButton — dialog confirm (case 19)", () => {
  it("opens the dialog on click; Cancel does not call regenerateDraft", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft for Weekly Tech" }));

    expect(screen.getByRole("heading", { name: "Regenerate draft" })).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.regenerateDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Regenerate draft" })).not.toBeInTheDocument();
  });

  it("Confirm calls regenerateDraft; success toast is Draft regeneration started", async () => {
    mocks.regenerateDraft.mockResolvedValue({ ok: true });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft for Weekly Tech" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft" }));

    await waitFor(() => {
      expect(mocks.regenerateDraft).toHaveBeenCalledWith("run-1");
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Draft regeneration started");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("toasts result.error when regenerateDraft fails", async () => {
    mocks.regenerateDraft.mockResolvedValue({
      ok: false,
      error: "Only completed runs can regenerate their draft",
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft for Weekly Tech" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft" }));

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Only completed runs can regenerate their draft",
      );
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("RegenerateDraftButton — delivery warning (case 20)", () => {
  it("includes the delivery paragraph when emailDeliveryStatus is sent", () => {
    renderButton({ emailDeliveryStatus: "sent" });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft for Weekly Tech" }));

    expect(screen.getByText(DELIVERY_WARNING)).toBeInTheDocument();
  });

  it("includes the delivery paragraph when rssDeliveryStatus is published", () => {
    renderButton({ rssDeliveryStatus: "published" });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft for Weekly Tech" }));

    expect(screen.getByText(DELIVERY_WARNING)).toBeInTheDocument();
  });

  it("omits the delivery paragraph when both statuses are none", () => {
    renderButton({ emailDeliveryStatus: "none", rssDeliveryStatus: "none" });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft for Weekly Tech" }));

    expect(screen.getByText(BODY)).toBeInTheDocument();
    expect(screen.queryByText(DELIVERY_WARNING)).not.toBeInTheDocument();
  });
});
