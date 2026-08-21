/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { Run, RunStatus } from "@newsletter/shared";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { RecentIssues } from "@/components/dashboard/recent-issues";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { buildAttentionItems } from "@/lib/dashboard-data";
import { formatRunStatusLabel } from "@/lib/status-labels";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { formatRunDateTime } from "@/components/runs/run-display";

afterEach(() => {
  cleanup();
});

const STARTED_AT = "2026-07-20T10:00:00.000Z";
const ENDED_AT = "2026-07-20T10:30:00.000Z";

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

describe("NeedsAttention UI (case 4)", () => {
  it("renders links with pinned hrefs only for positive counts", () => {
    const items = buildAttentionItems({
      unhealthyFeeds: 3,
      failedRuns: 1,
      failedDelivery: 2,
    });

    render(<NeedsAttention items={items} />);

    const feeds = screen.getByRole("link", { name: /3 unhealthy feeds/i });
    expect(feeds).toHaveAttribute("href", "/admin/feeds?health=unhealthy");

    const runs = screen.getByRole("link", { name: /1 failed run/i });
    expect(runs).toHaveAttribute("href", "/admin/runs?status=failed");

    const delivery = screen.getByRole("link", { name: /2 delivery failures/i });
    expect(delivery).toHaveAttribute("href", "/admin/delivery?outcome=any_failure");
  });

  it("renders nothing when all counts are zero", () => {
    const items = buildAttentionItems({
      unhealthyFeeds: 0,
      failedRuns: 0,
      failedDelivery: 0,
    });

    const { container } = render(<NeedsAttention items={items} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits zero-count signals while keeping positive ones", () => {
    const items = buildAttentionItems({
      unhealthyFeeds: 0,
      failedRuns: 2,
      failedDelivery: 0,
    });

    render(<NeedsAttention items={items} />);

    expect(screen.getByRole("link", { name: /2 failed runs/i })).toHaveAttribute(
      "href",
      "/admin/runs?status=failed",
    );
    expect(screen.queryByRole("link", { name: /unhealthy feed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /delivery failure/i })).not.toBeInTheDocument();
  });
});

describe("RecentIssues UI (case 5)", () => {
  it("links each row to /issues/{id} and shows title, newsletter, date", () => {
    const issue = makeRun({
      $id: "issue-42",
      newsletterName: "Daily Digest",
      endedAt: ENDED_AT,
    });

    render(
      <RecentIssues
        issues={[issue]}
        titleByRunId={new Map([["issue-42", "AI Weekly Roundup"]])}
      />,
    );

    const row = screen.getByRole("link", { name: /AI Weekly Roundup/i });
    expect(row).toHaveAttribute("href", "/issues/issue-42");
    expect(screen.getByText("Daily Digest")).toBeInTheDocument();
    expect(
      screen.getByText(new Date(ENDED_AT).toLocaleDateString(undefined, { dateStyle: "short" })),
    ).toBeInTheDocument();
  });

  it("shows empty state copy with a link to /admin/newsletters", () => {
    render(<RecentIssues issues={[]} />);

    expect(screen.getByText(/No issues yet/i)).toBeInTheDocument();
    const newsletters = screen.getByRole("link", { name: /newsletters/i });
    expect(newsletters).toHaveAttribute("href", "/admin/newsletters");
  });

  it("includes a quiet View all link to /admin/issues in the section header", () => {
    render(<RecentIssues issues={[]} />);

    const viewAll = screen.getByRole("link", { name: /view all/i });
    expect(viewAll).toHaveAttribute("href", "/admin/issues");
  });
});

describe("RecentRuns UI (case 6)", () => {
  it("shows humanized status labels", () => {
    const statuses: RunStatus[] = ["pending", "running", "completed", "failed"];
    const runs = statuses.map((status) =>
      makeRun({
        $id: `run-${status}`,
        status,
        newsletterName: `NL ${status}`,
        endedAt: status === "pending" || status === "running" ? null : ENDED_AT,
      }),
    );

    render(<RecentRuns runs={runs} />);

    for (const status of statuses) {
      expect(screen.getByText(formatRunStatusLabel(status))).toBeInTheDocument();
    }
  });

  it("links completed/failed to inspect and pending/running to /admin/runs", () => {
    const runs = [
      makeRun({ $id: "done-1", status: "completed", newsletterName: "Done NL" }),
      makeRun({ $id: "fail-1", status: "failed", newsletterName: "Fail NL" }),
      makeRun({
        $id: "pend-1",
        status: "pending",
        newsletterName: "Pend NL",
        endedAt: null,
      }),
      makeRun({
        $id: "run-1",
        status: "running",
        newsletterName: "Run NL",
        endedAt: null,
      }),
    ];

    render(<RecentRuns runs={runs} />);

    expect(screen.getByRole("link", { name: /Done NL/i })).toHaveAttribute(
      "href",
      inspectRunHref("done-1"),
    );
    expect(screen.getByRole("link", { name: /Fail NL/i })).toHaveAttribute(
      "href",
      inspectRunHref("fail-1"),
    );
    expect(screen.getByRole("link", { name: /Pend NL/i })).toHaveAttribute("href", "/admin/runs");
    expect(screen.getByRole("link", { name: /Run NL/i })).toHaveAttribute("href", "/admin/runs");
  });

  it("shows started (and ended when present) via formatRunDateTime", () => {
    const run = makeRun({
      $id: "timed-1",
      newsletterName: "Timed NL",
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
    });

    render(<RecentRuns runs={[run]} />);

    const section = screen.getByRole("region", { name: /recent runs/i });
    expect(within(section).getByText(formatRunDateTime(STARTED_AT))).toBeInTheDocument();
    expect(within(section).getByText(formatRunDateTime(ENDED_AT))).toBeInTheDocument();
  });

  it("shows empty state with a link to /admin/runs", () => {
    render(<RecentRuns runs={[]} />);

    expect(screen.getByText(/No runs in the last 7 days/i)).toBeInTheDocument();
    const runsLinks = screen.getAllByRole("link", { name: /runs/i });
    expect(runsLinks.some((el) => el.getAttribute("href") === "/admin/runs")).toBe(true);
  });
});
