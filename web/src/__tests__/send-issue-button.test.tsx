/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import {
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";
import { SendIssueButton } from "@/components/issues/send-issue-button";

const mocks = vi.hoisted(() => ({
  sendIssueEmailAction: vi.fn(),
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

vi.mock("@/app/(protected)/issues/actions", () => ({
  sendIssueEmailAction: mocks.sendIssueEmailAction,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

afterEach(() => {
  cleanup();
  mocks.sendIssueEmailAction.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

const ENDED_AT = "2026-03-15T14:35:00.000Z";
const STARTED_AT = "2026-03-15T14:30:00.000Z";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Weekly Tech",
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "draft-1",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    ...overrides,
  };
}

describe("Send button visibility (case 12)", () => {
  it("shows Send on success-path IssueReader", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." showOps />);

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("does not show Send on load-error path", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("does not show Send on not-available path", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("does not show Send on bare load-error path", () => {
    render(<IssueReaderLoadErrorBare />);

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });
});

describe("SendIssueButton — action toasts", () => {
  it("toasts success with recipient count on ok (case 13)", async () => {
    mocks.sendIssueEmailAction.mockResolvedValue({ ok: true, recipientCount: 3 });
    render(<SendIssueButton runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mocks.sendIssueEmailAction).toHaveBeenCalledWith("run-1");
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Sent to 3 recipients");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("toasts singular recipient copy when count is 1", async () => {
    mocks.sendIssueEmailAction.mockResolvedValue({ ok: true, recipientCount: 1 });
    render(<SendIssueButton runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledWith("Sent to 1 recipient");
    });
  });

  it("toasts error and re-enables Send after failure (case 14)", async () => {
    mocks.sendIssueEmailAction.mockResolvedValue({
      ok: false,
      error: "No recipients configured for this newsletter",
    });
    render(<SendIssueButton runId="run-1" />);

    const button = screen.getByRole("button", { name: "Send" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "No recipients configured for this newsletter",
      );
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  it("disables Send while the action is pending (case 15)", async () => {
    let resolveAction!: (v: { ok: true; recipientCount: number }) => void;
    mocks.sendIssueEmailAction.mockImplementation(
      () =>
        new Promise<{ ok: true; recipientCount: number }>((r) => {
          resolveAction = r;
        }),
    );
    render(<SendIssueButton runId="run-1" />);

    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toBeDisabled();

    await act(async () => {
      resolveAction({ ok: true, recipientCount: 2 });
    });

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Sent to 2 recipients");
  });
});
