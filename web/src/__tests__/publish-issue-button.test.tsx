/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import {
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";
import { PublishIssueButton } from "@/components/issues/publish-issue-button";

const mocks = vi.hoisted(() => ({
  publishIssueToRssAction: vi.fn(),
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
  publishIssueToRssAction: mocks.publishIssueToRssAction,
  sendIssueEmailAction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

afterEach(() => {
  cleanup();
  mocks.publishIssueToRssAction.mockReset();
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

describe("Publish button visibility (case 18)", () => {
  it("shows Publish on success-path IssueReader", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." showOps />);

    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("does not show Publish on load-error path", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("does not show Publish on not-available path", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("does not show Publish on bare load-error path", () => {
    render(<IssueReaderLoadErrorBare />);

    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });
});

describe("PublishIssueButton — action toasts (case 18)", () => {
  it("toasts success on ok", async () => {
    mocks.publishIssueToRssAction.mockResolvedValue({
      ok: true,
      newsletterId: "nl-1",
      runId: "run-1",
    });
    render(<PublishIssueButton runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(mocks.publishIssueToRssAction).toHaveBeenCalledWith("run-1");
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Published to RSS");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("toasts error and re-enables Publish after failure", async () => {
    mocks.publishIssueToRssAction.mockResolvedValue({
      ok: false,
      error: "Failed to publish to RSS",
    });
    render(<PublishIssueButton runId="run-1" />);

    const button = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to publish to RSS");
    });
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  it("disables Publish while the action is pending", async () => {
    let resolveAction!: (v: {
      ok: true;
      newsletterId: string;
      runId: string;
    }) => void;
    mocks.publishIssueToRssAction.mockImplementation(
      () =>
        new Promise<{ ok: true; newsletterId: string; runId: string }>((r) => {
          resolveAction = r;
        }),
    );
    render(<PublishIssueButton runId="run-1" />);

    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toBeDisabled();

    await act(async () => {
      resolveAction({ ok: true, newsletterId: "nl-1", runId: "run-1" });
    });

    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Published to RSS");
  });

  it("allows re-publish with the same button after success", async () => {
    mocks.publishIssueToRssAction.mockResolvedValue({
      ok: true,
      newsletterId: "nl-1",
      runId: "run-1",
    });
    render(<PublishIssueButton runId="run-1" />);

    const button = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mocks.publishIssueToRssAction).toHaveBeenCalledTimes(2);
    });
    expect(mocks.toast.success).toHaveBeenCalledTimes(2);
  });
});
