/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Feed } from "@newsletter/shared";
import { FeedFormDialog } from "@/components/feeds/feed-form-dialog";

const mocks = vi.hoisted(() => ({
  createFeedAction: vi.fn(async () => ({ ok: true as const })),
  updateFeedAction: vi.fn(async () => ({ ok: true as const })),
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

vi.mock("@/app/(protected)/admin/feeds/actions", () => ({
  createFeedAction: mocks.createFeedAction,
  updateFeedAction: mocks.updateFeedAction,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

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
    allowPrivateNetwork: false,
    ...overrides,
  };
}

const INTERNAL_LABEL = "Internal feed — may fetch private/LAN addresses";

function fillBasics() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Intranet Digest" } });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "http://10.0.0.5/rss" },
  });
}

function submittedFormData(
  action: typeof mocks.createFeedAction | typeof mocks.updateFeedAction,
): FormData {
  const call = action.mock.calls[0] as unknown as [unknown, FormData] | undefined;
  expect(call).toBeDefined();
  return call![1];
}

afterEach(() => {
  cleanup();
  mocks.createFeedAction.mockReset();
  mocks.createFeedAction.mockResolvedValue({ ok: true as const });
  mocks.updateFeedAction.mockReset();
  mocks.updateFeedAction.mockResolvedValue({ ok: true as const });
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("FeedFormDialog — allowPrivateNetwork checkbox", () => {
  it("create: checkbox is unchecked by default and omitted from the payload", async () => {
    render(<FeedFormDialog mode="create" open onOpenChange={() => {}} />);

    expect(screen.getByLabelText(INTERNAL_LABEL)).not.toBeChecked();

    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Add feed" }));

    await waitFor(() => expect(mocks.createFeedAction).toHaveBeenCalled());
    expect(submittedFormData(mocks.createFeedAction).get("allowPrivateNetwork")).toBeNull();
  });

  it("create: checking the box submits allowPrivateNetwork: true", async () => {
    render(<FeedFormDialog mode="create" open onOpenChange={() => {}} />);

    fillBasics();
    fireEvent.click(screen.getByLabelText(INTERNAL_LABEL));
    fireEvent.click(screen.getByRole("button", { name: "Add feed" }));

    await waitFor(() => expect(mocks.createFeedAction).toHaveBeenCalled());
    expect(submittedFormData(mocks.createFeedAction).get("allowPrivateNetwork")).toBe("true");
  });

  it("edit: reflects the feed's flag and submits allowPrivateNetwork: true", async () => {
    render(
      <FeedFormDialog
        mode="edit"
        feed={makeFeed({ allowPrivateNetwork: true })}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByLabelText(INTERNAL_LABEL)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateFeedAction).toHaveBeenCalled());
    const formData = submittedFormData(mocks.updateFeedAction);
    expect(formData.get("feedId")).toBe("feed-1");
    expect(formData.get("allowPrivateNetwork")).toBe("true");
  });

  it("edit: unchecking a flagged feed omits the flag from the payload", async () => {
    render(
      <FeedFormDialog
        mode="edit"
        feed={makeFeed({ allowPrivateNetwork: true })}
        open
        onOpenChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText(INTERNAL_LABEL));
    expect(screen.getByLabelText(INTERNAL_LABEL)).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateFeedAction).toHaveBeenCalled());
    expect(submittedFormData(mocks.updateFeedAction).get("allowPrivateNetwork")).toBeNull();
  });

  it("edit: an unflagged feed starts unchecked and can be flagged on save", async () => {
    render(
      <FeedFormDialog mode="edit" feed={makeFeed()} open onOpenChange={() => {}} />,
    );

    expect(screen.getByLabelText(INTERNAL_LABEL)).not.toBeChecked();

    fireEvent.click(screen.getByLabelText(INTERNAL_LABEL));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateFeedAction).toHaveBeenCalled());
    expect(submittedFormData(mocks.updateFeedAction).get("allowPrivateNetwork")).toBe("true");
  });
});
