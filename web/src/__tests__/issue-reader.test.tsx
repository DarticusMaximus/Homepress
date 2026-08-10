/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  formatIssueFallbackTitle,
  resolveIssueDisplayTitle,
  type Run,
} from "@newsletter/shared";
import {
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
    ...overrides,
  };
}

describe("IssueReader", () => {
  it("shows locked not-an-issue copy and Back to Issues", () => {
    render(<IssueReaderNotAvailable />);

    expect(screen.getByText(ISSUE_NOT_AVAILABLE_COPY)).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Issues" });
    expect(back).toHaveAttribute("href", "/issues");
    expect(back.className).toContain("min-h-11");
    expect(back.className).toContain("px-3");
  });

  it("renders chrome with heading title then unstripped markdown body on success", () => {
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

    const back = screen.getByRole("link", { name: "Back to Issues" });
    expect(back).toHaveAttribute("href", "/issues");
    expect(back.className).toContain("min-h-11");
    expect(back.className).toContain("px-3");
    expect(screen.getByText(`${run.newsletterName} · ${dateLabel}`)).toBeInTheDocument();
    // Chrome uses first heading; body still renders that heading in place (intentional duplication).
    expect(title).toBe("Hello");
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();

    // Feature 04 case 12 — download links on success chrome.
    const md = screen.getByRole("link", { name: "Download Markdown" });
    expect(md).toHaveAttribute("href", `/api/issues/${run.$id}/export?format=md`);
    const html = screen.getByRole("link", { name: "Download HTML" });
    expect(html).toHaveAttribute("href", `/api/issues/${run.$id}/export?format=html`);

    // Chrome + body share one centered Typography-measure column (65ch via max-w-prose).
    const column = container.firstElementChild;
    expect(column?.className).toMatch(/mx-auto/);
    expect(column?.className).toMatch(/max-w-prose/);
    expect(column?.className).not.toMatch(/max-w-\[\d+ch\]/);
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

  it("shows locked load-error alert with chrome when run metadata is present", () => {
    const run = makeRun();
    const title = formatIssueFallbackTitle(run.newsletterName, run.endedAt ?? run.startedAt);

    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.getByRole("link", { name: "Back to Issues" })).toHaveAttribute("href", "/issues");
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(ISSUE_LOAD_ERROR_COPY);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    // Feature 04 case 13 — no download links on load-error.
    expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  });

  it("shows locked load-error alert without run chrome when bare", () => {
    render(<IssueReaderLoadErrorBare />);

    expect(screen.getByRole("link", { name: "Back to Issues" })).toHaveAttribute("href", "/issues");
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

