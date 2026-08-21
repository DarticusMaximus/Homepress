/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  formatIssueFallbackTitle,
  resolveIssueDisplayTitle,
  type Run,
} from "@newsletter/shared";
import {
  INSPECT_PIPELINE_LABEL,
  ISSUE_LOAD_ERROR_COPY,
  ISSUE_NOT_AVAILABLE_COPY,
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";

afterEach(() => {
  cleanup();
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

describe("IssueReader", () => {
  it("shows locked not-an-issue copy and Back to Home", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.getByText(ISSUE_NOT_AVAILABLE_COPY)).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Home" });
    expect(back).toHaveAttribute("href", "/");
    expect(back.className).toContain("min-h-11");
    expect(back.className).toContain("px-3");
  });

  it("renders chrome with heading title then unstripped markdown body on success (case 14)", () => {
    const run = makeRun();
    const dateIso = run.endedAt ?? run.startedAt;
    const dateLabel = new Date(dateIso).toLocaleDateString(undefined, { dateStyle: "short" });
    const markdown = `## Hello

Body text.`;
    const title = resolveIssueDisplayTitle({
      markdown,
      newsletterName: run.newsletterName,
      dateIso,
    });

    const { container } = render(<IssueReader run={run} runId={run.$id} markdown={markdown} />);

    // Chrome + body share one centered column (max-w-3xl; no Stage 10/13 max-w-prose).
    const column = container.firstElementChild;
    expect(column?.className).toMatch(/mx-auto/);
    expect(column?.className).toMatch(/max-w-3xl/);
    expect(column?.className).not.toMatch(/max-w-prose/);
    expect(column?.className).not.toMatch(/max-w-\[\d+ch\]/);

    const back = screen.getByRole("link", { name: "Back to Home" });
    expect(back).toHaveAttribute("href", "/");
    expect(back.className).toContain("min-h-11");
    expect(back.className).toContain("px-3");
    expect(screen.getByText(`${run.newsletterName} · ${dateLabel}`)).toBeInTheDocument();
    // Chrome uses first heading; body still renders that heading in place (intentional duplication).
    expect(title).toBe("Hello");
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();

    // Factory downloads live on showOps chrome (issue-reader-chrome cases 3–4), not default reader.
    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });

  it("uses stored issueTitle for chrome h1 and leaves the draft heading in the body (case 13)", () => {
    const run = makeRun({ issueTitle: "Digest Name" });
    const markdown = `## Hello

Body text.`;

    render(<IssueReader run={run} runId={run.$id} markdown={markdown} />);

    expect(screen.getByRole("heading", { level: 1, name: "Digest Name" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Hello" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
  });

  it("shows factory ops and Back to Issues when showOps (case 14)", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." showOps />);

    const back = screen.getByRole("link", { name: "Back to Issues" });
    expect(back).toHaveAttribute("href", "/admin/issues");
    expect(back.className).toContain("min-h-11");
    expect(screen.getByRole("link", { name: INSPECT_PIPELINE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download HTML" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("RSS")).toBeInTheDocument();
  });

  it("uses fallback chrome title when draft has no heading", () => {
    const run = makeRun();
    const dateIso = run.endedAt ?? run.startedAt;
    const markdown = "Just a paragraph with no heading.";
    const title = formatIssueFallbackTitle(run.newsletterName, dateIso);

    render(<IssueReader run={run} runId={run.$id} markdown={markdown} />);

    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(markdown)).toBeInTheDocument();
  });

  it("shows locked load-error alert with chrome when run metadata is present (case 16)", () => {
    const run = makeRun();
    const title = formatIssueFallbackTitle(run.newsletterName, run.endedAt ?? run.startedAt);

    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(ISSUE_LOAD_ERROR_COPY);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    // Feature 04 case 13 — no download links on load-error.
    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });

  it("uses stored issueTitle on load-error chrome instead of newsletter-and-date (case 15)", () => {
    const run = makeRun({ issueTitle: "Stored" });
    const fallback = formatIssueFallbackTitle(run.newsletterName, run.endedAt ?? run.startedAt);

    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.getByRole("heading", { level: 1, name: "Stored" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: fallback })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(ISSUE_LOAD_ERROR_COPY);
  });

  it("shows locked load-error alert without run chrome when bare", () => {
    render(<IssueReaderLoadErrorBare />);

    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("alert")).toHaveTextContent(ISSUE_LOAD_ERROR_COPY);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    // Feature 04 case 13 — no download links on bare load-error.
    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });

  it("does not show download links on not-available path (case 13)", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });
});

