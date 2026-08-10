/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import {
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";

// Intentionally imports a component that does not exist yet (Task 5).
// Case 12 fails red for missing module / missing download links.
import { IssueDownloadLinks } from "@/components/issues/issue-download-links";

vi.mock("@/app/(protected)/issues/actions", () => ({
  sendIssueEmailAction: vi.fn(),
  publishIssueToRssAction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
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

afterEach(() => {
  cleanup();
});

const ENDED_AT = "2026-03-15T14:35:00.000Z";
const STARTED_AT = "2026-03-15T14:30:00.000Z";
const RUN_ID = "run-dl-1";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    $id: RUN_ID,
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
    ...overrides,
  };
}

describe("IssueDownloadLinks (case 12)", () => {
  it("renders Markdown and HTML download anchors with locked hrefs and aria-labels", () => {
    render(<IssueDownloadLinks runId={RUN_ID} />);

    const md = screen.getByRole("link", { name: "Download Markdown" });
    expect(md).toHaveTextContent("Markdown");
    expect(md).toHaveAttribute("href", `/api/issues/${RUN_ID}/export?format=md`);

    const html = screen.getByRole("link", { name: "Download HTML" });
    expect(html).toHaveTextContent("HTML");
    expect(html).toHaveAttribute("href", `/api/issues/${RUN_ID}/export?format=html`);
  });
});

describe("Download links visibility on IssueReader (cases 12–13)", () => {
  it("shows Markdown and HTML download links on success path (case 12)", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." />);

    const md = screen.getByRole("link", { name: "Download Markdown" });
    expect(md).toHaveTextContent("Markdown");
    expect(md).toHaveAttribute("href", `/api/issues/${run.$id}/export?format=md`);

    const html = screen.getByRole("link", { name: "Download HTML" });
    expect(html).toHaveTextContent("HTML");
    expect(html).toHaveAttribute("href", `/api/issues/${run.$id}/export?format=html`);
  });

  it("does not show download links on load-error path (case 13)", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });

  it("does not show download links on not-available path (case 13)", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });

  it("does not show download links on bare load-error path (case 13)", () => {
    render(<IssueReaderLoadErrorBare />);

    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });
});
