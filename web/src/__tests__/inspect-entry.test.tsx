/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RunRepositoryError, type Run, type RunStatus } from "@newsletter/shared";
import { inspectRunHref } from "@/components/runs/inspect-url";
import {
  InspectShell,
  InspectShellNotAvailable,
  INSPECT_NOT_AVAILABLE_COPY,
} from "@/components/runs/inspect-shell";
import { PHASE_MISSING_COPY } from "@/components/runs/inspect-phase-section";
import { RunsTable } from "@/components/runs/runs-table";
import {
  INSPECT_PIPELINE_LABEL,
  IssueReader,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";
import { navItems } from "@/lib/nav-items";
import { expandInspectSection } from "./inspect-expand-section";

const missingPhase = { status: "missing" as const };

afterEach(() => {
  cleanup();
});

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
    endedAt: "2026-03-15T14:35:00.000Z",
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

const ALL_STATUSES: RunStatus[] = ["pending", "running", "completed", "failed"];

const statusFixtures: Run[] = ALL_STATUSES.map((status) =>
  makeRun({
    $id: `run-${status}`,
    newsletterName: `${status} Newsletter`,
    status,
    ...(status === "failed"
      ? { failedPhase: "score", failureMessage: "Upstream failed", completedPhase: "" }
      : {}),
    ...(status === "pending" || status === "running"
      ? { completedPhase: "", endedAt: null, checkpointDraftId: "" }
      : {}),
  }),
);

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("inspectRunHref", () => {
  it("returns /admin/runs/{id}/inspect for a given run id", () => {
    expect(inspectRunHref("run-abc")).toBe("/admin/runs/run-abc/inspect");
  });
});

describe("Runs list Inspect links", () => {
  it("renders Inspect href on table and cards for every status; Retry failed-only", () => {
    render(
      <RunsTable
        runs={statusFixtures}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{}}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    const tableLinks = table.getAllByRole("link", { name: "Inspect" });
    const cardLinks = cards.getAllByRole("link", { name: "Inspect" });
    expect(tableLinks).toHaveLength(ALL_STATUSES.length);
    expect(cardLinks).toHaveLength(ALL_STATUSES.length);

    for (const run of statusFixtures) {
      const href = inspectRunHref(run.$id);
      expect(tableLinks.some((el) => el.getAttribute("href") === href)).toBe(true);
      expect(cardLinks.some((el) => el.getAttribute("href") === href)).toBe(true);
    }

    const failedCount = statusFixtures.filter((r) => r.status === "failed").length;
    expect(table.getAllByRole("button", { name: /retry/i })).toHaveLength(failedCount);
    expect(cards.getAllByRole("button", { name: /retry/i })).toHaveLength(failedCount);
  });
});

describe("navItems Inspect absence", () => {
  it("has no Inspect title or href; Issues is not a top-level nav item", () => {
    expect(navItems.some((item) => item.title === "Inspect")).toBe(false);
    expect(navItems.some((item) => item.href.includes("inspect"))).toBe(false);
    expect(navItems.some((item) => item.title === "Issues")).toBe(false);
  });
});

describe("Inspect shell not-available", () => {
  it("shows locked not-available copy and Back to Runs; does not show error .message", () => {
    const err = new RunRepositoryError("not_found", "Run not found — secret leak");

    render(<InspectShellNotAvailable />);

    expect(screen.getByText(INSPECT_NOT_AVAILABLE_COPY)).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Runs" });
    expect(back).toHaveAttribute("href", "/admin/runs");
    expect(back.className).toContain("min-h-11");
    expect(back.className).toContain("px-3");
    expect(screen.queryByText(err.message)).not.toBeInTheDocument();
  });
});

describe("Inspect shell success", () => {
  it("item 8: renders Inspect heading, phase + audit + Draft sections, Back to Runs; no Feature 04 placeholder", () => {
    const run = makeRun();

    render(
      <InspectShell
        run={run}
        fetchResult={missingPhase}
        scrapeResult={missingPhase}
        tagResult={missingPhase}
        scoreResult={missingPhase}
        selectionResult={missingPhase}
        draftResult={missingPhase}
        suppressSummary={{ count: 0, items: [] }}
        runLookup={{}}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Inspect" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fetched" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scraped" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tagged" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scored" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selected" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selection drops" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Suppressed (0)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Draft" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="inspect-draft-selected"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="inspect-draft-output"]')).toBeTruthy();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((el) => el.textContent);
    expect(headings.indexOf("Suppressed (0)")).toBeLessThan(headings.indexOf("Draft"));

    // Draft panes stay visible; phase/audit bodies are collapsed by default (Feature 04)
    expect(screen.getAllByText(PHASE_MISSING_COPY)).toHaveLength(2);

    const shell = document.body;
    for (const label of [
      "Fetched",
      "Scraped",
      "Tagged",
      "Scored",
      "Selected",
      "Selection drops",
    ]) {
      expandInspectSection(shell, label);
    }

    // Four Feature 05 phases + Selected + Selection drops + Draft selected inputs + Draft output
    // (Suppressed uses empty copy, not PHASE_MISSING_COPY)
    expect(screen.getAllByText(PHASE_MISSING_COPY)).toHaveLength(8);
    const back = screen.getByRole("link", { name: "Back to Runs" });
    expect(back).toHaveAttribute("href", "/admin/runs");
  });

  it("Feature 07 wiring: Draft below Suppressed shares selection; draft missing keeps selected inputs", () => {
    const run = makeRun();
    const selectionLoaded = {
      status: "loaded" as const,
      data: {
        selectedArticles: [
          {
            title: "Shared Selected Title",
            link: "https://example.com/shared",
            published: new Date(STARTED_AT),
            content: "SECRET_SHOULD_NOT_RENDER",
            source: "Example Source",
            tags: ["ai"],
            score: 0.9,
          },
        ],
        failures: [],
      },
    };

    render(
      <InspectShell
        run={run}
        fetchResult={missingPhase}
        scrapeResult={missingPhase}
        tagResult={missingPhase}
        scoreResult={missingPhase}
        selectionResult={selectionLoaded}
        draftResult={missingPhase}
        suppressSummary={{ count: 0, items: [] }}
        runLookup={{}}
      />,
    );

    // Feature 06 Selected audit retained
    expect(screen.getByRole("heading", { name: "Selected (1)" })).toBeInTheDocument();
    // Draft left pane reuses the same selection result (titles appear in both)
    expect(screen.getByRole("heading", { name: "Selected inputs (1)" })).toBeInTheDocument();
    expect(screen.getAllByText("Shared Selected Title").length).toBeGreaterThanOrEqual(2);
    // Draft missing copy in output pane only
    const draftOutput = document.querySelector('[data-slot="inspect-draft-output"]');
    expect(draftOutput).toBeTruthy();
    expect(within(draftOutput as HTMLElement).getByText(PHASE_MISSING_COPY)).toBeInTheDocument();
  });
});

describe("Issue reader Inspect pipeline link", () => {
  it("success chrome includes Inspect pipeline with correct href; not-an-issue does not", () => {
    const run = makeRun({ $id: "run-issue-1" });

    const { unmount } = render(
      <IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." showOps />,
    );

    const inspect = screen.getByRole("link", { name: INSPECT_PIPELINE_LABEL });
    expect(inspect).toHaveAttribute("href", inspectRunHref(run.$id));
    expect(inspect.className).toContain("min-h-11");
    expect(inspect.className).toContain("px-3");

    unmount();
    cleanup();

    render(<IssueReaderNotAvailable />);

    expect(screen.queryByRole("link", { name: INSPECT_PIPELINE_LABEL })).not.toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Home" });
    expect(back).toHaveAttribute("href", "/");
    expect(back.className).toContain("min-h-11");
  });

  it("omits Inspect pipeline on draft load-error path", () => {
    const run = makeRun({ $id: "run-issue-err" });

    render(<IssueReader run={run} runId={run.$id} loadError />);

    expect(screen.queryByRole("link", { name: INSPECT_PIPELINE_LABEL })).not.toBeInTheDocument();
  });
});
