/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import {
  parseSuppressSummary,
  type Run,
  type SuppressItem,
  type SuppressSummary,
} from "@newsletter/shared";
import { RunsTable } from "@/components/runs/runs-table";
import { formatRunDateTime } from "@/components/runs/run-display";
import { formatPriorIssueLabel, type RunLookup } from "@/components/runs/run-suppress-summary";

afterEach(() => {
  cleanup();
});

const STARTED_AT = "2026-03-15T14:30:00.000Z";
const ENDED_AT = "2026-03-15T14:35:00.000Z";
const PRIOR_STARTED_AT = "2026-03-08T09:00:00.000Z";
const PRIOR_ENDED_AT = "2026-03-08T09:10:00.000Z";

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
    checkpointDraftId: "",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    ...overrides,
  };
}

function makeSuppressItem(overrides: Partial<SuppressItem> = {}): SuppressItem {
  return {
    title: "Suppressed candidate",
    link: "https://example.com/article",
    matchedRunId: "run-prior",
    matchedTitle: "Prior topic",
    similarity: 0.92,
    ...overrides,
  };
}

function summaryOf(items: SuppressItem[]): SuppressSummary {
  return { count: items.length, items };
}

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

/**
 * Fragment is present as VISIBLE text in the slot — text rendered in an
 * `.sr-only` element does NOT count. The spec (Display §3) requires the card to
 * list each `formatSuppressItemLine` in genuinely visible text, not a tooltip
 * or a 1px-clipped span. This helper enforces that by cloning the slot,
 * stripping every `.sr-only` subtree, then checking `textContent` of what
 * remains. A naive `textContent` check (or `:not(.sr-only)` querySelector)
 * would pass against an sr-only implementation because parent elements still
 * carry the hidden text in their own `textContent`.
 *
 * NOTE: takes the raw slot element (from {@link getSlot}), not a `within()`
 * bound result — the bound result has no `textContent`.
 */
function hasVisibleText(slot: HTMLElement, fragment: string): boolean {
  const clone = slot.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((el) => el.remove());
  return (clone.textContent ?? "").includes(fragment);
}

/**
 * Fragment is exposed in the table compact cell — either as DOM text (visually
 * hidden list) or carried inside a `title` attribute. The feature spec permits
 * either strategy for the table.
 *
 * NOTE: takes the raw slot element (from {@link getSlot}), not a `within()`
 * bound result.
 */
function isExposed(slot: HTMLElement, fragment: string): boolean {
  if ((slot.textContent ?? "").includes(fragment)) return true;
  const titled = slot.querySelectorAll("[title]");
  for (const el of titled) {
    if ((el.getAttribute("title") ?? "").includes(fragment)) return true;
  }
  return false;
}

describe("Runs suppress-summary visibility", () => {
  it("case 1 — empty suppressSummary renders an em-dash (table + cards)", () => {
    const run = makeRun({ $id: "run-empty" });
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-empty": summaryOf([]) }}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");
    const table = within(tableSlot);
    const cards = within(cardsSlot);

    // Column header present in the table; row label present in the card.
    expect(table.getByText("Suppressed")).toBeInTheDocument();
    expect(cards.getByText(/Suppressed:/)).toBeInTheDocument();

    // Em-dash shown in both surfaces for a run with no suppressions.
    expect(table.getAllByText("—").length).toBeGreaterThan(0);
    expect(cards.getAllByText("—").length).toBeGreaterThan(0);

    // No count label leaks when empty.
    expect(table.queryByText(/\d+ suppressed/)).toBeNull();
    expect(cards.queryByText(/\d+ suppressed/)).toBeNull();
  });

  it("case 2 — count label 'N suppressed' is visible in table and cards", () => {
    const run = makeRun({ $id: "run-count" });
    const summary = summaryOf([
      makeSuppressItem({ title: "First suppressed title" }),
      makeSuppressItem({ title: "Second suppressed title" }),
    ]);
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-count": summary }}
        runLookup={{}}
      />,
    );

    const table = within(getSlot("domain-list-table"));
    const cards = within(getSlot("domain-list-cards"));

    expect(table.getByText("2 suppressed")).toBeInTheDocument();
    expect(cards.getByText("2 suppressed")).toBeInTheDocument();
  });

  it("case 3 — both suppressed titles exposed in table and visible in cards", () => {
    const titleA = "Title Alpha Distinctive";
    const titleB = "Title Beta Distinctive";
    const run = makeRun({ $id: "run-titles" });
    const summary = summaryOf([
      makeSuppressItem({ title: titleA }),
      makeSuppressItem({ title: titleB }),
    ]);
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-titles": summary }}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    // Cards: each suppressed title in visible text.
    expect(hasVisibleText(cardsSlot, titleA)).toBe(true);
    expect(hasVisibleText(cardsSlot, titleB)).toBe(true);

    // Table: each suppressed title exposed (title attr and/or hidden list).
    expect(isExposed(tableSlot, titleA)).toBe(true);
    expect(isExposed(tableSlot, titleB)).toBe(true);
  });

  it("case 4 — matched prior issue resolved via runLookup (table + cards)", () => {
    const matchedTitle = "Lookback topic title";
    const priorRun = makeRun({
      $id: "run-prior",
      startedAt: PRIOR_STARTED_AT,
      endedAt: PRIOR_ENDED_AT,
    });
    const run = makeRun({ $id: "run-main" });
    const summary = summaryOf([makeSuppressItem({ matchedRunId: "run-prior", matchedTitle })]);
    const runLookup: RunLookup = {
      "run-prior": {
        endedAt: priorRun.endedAt,
        startedAt: priorRun.startedAt,
      },
    };
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-main": summary }}
        runLookup={runLookup}
      />,
    );

    // endedAt is preferred per spec (endedAt ?? startedAt); do not hard-code a
    // locale date string — compute it from the same helper the component uses.
    const expectedPrior = formatRunDateTime(PRIOR_ENDED_AT);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    // matchedTitle exposed on both surfaces.
    expect(isExposed(tableSlot, matchedTitle)).toBe(true);
    expect(hasVisibleText(cardsSlot, matchedTitle)).toBe(true);

    // Resolved prior-issue date exposed on both surfaces.
    expect(isExposed(tableSlot, expectedPrior)).toBe(true);
    expect(hasVisibleText(cardsSlot, expectedPrior)).toBe(true);
  });

  it("case 5 — unknown matchedRunId falls back to short id + matchedTitle", () => {
    const matchedTitle = "Unknown prior topic";
    const unknownId = "abcdefghijZQ9X7K"; // last 6 chars = "ZQ9X7K"
    const shortId = unknownId.slice(-6);
    const run = makeRun({ $id: "run-fallback" });
    const summary = summaryOf([makeSuppressItem({ matchedRunId: unknownId, matchedTitle })]);
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-fallback": summary }}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    // matchedTitle on both surfaces.
    expect(isExposed(tableSlot, matchedTitle)).toBe(true);
    expect(hasVisibleText(cardsSlot, matchedTitle)).toBe(true);

    // Short-id fallback (last 6 chars) on both surfaces.
    expect(isExposed(tableSlot, shortId)).toBe(true);
    expect(hasVisibleText(cardsSlot, shortId)).toBe(true);
  });

  it("case 6 — failed status with non-empty summary still shows count and titles", () => {
    const titleA = "Failed run suppression A";
    const titleB = "Failed run suppression B";
    const run = makeRun({
      $id: "run-failed",
      status: "failed",
      failedPhase: "score",
      failureMessage: "boom",
    });
    const summary = summaryOf([
      makeSuppressItem({ title: titleA }),
      makeSuppressItem({ title: titleB }),
    ]);
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-failed": summary }}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");
    const table = within(tableSlot);
    const cards = within(cardsSlot);

    expect(table.getByText("2 suppressed")).toBeInTheDocument();
    expect(cards.getByText("2 suppressed")).toBeInTheDocument();

    // Titles still surface even though the run failed.
    expect(isExposed(tableSlot, titleA)).toBe(true);
    expect(isExposed(tableSlot, titleB)).toBe(true);
    expect(hasVisibleText(cardsSlot, titleA)).toBe(true);
    expect(hasVisibleText(cardsSlot, titleB)).toBe(true);
  });

  it("formatPriorIssueLabel unit — empty matchedRunId is not the literal 'run …'", () => {
    const item: SuppressItem = {
      title: "Suppressed candidate",
      link: "https://example.com/article",
      matchedRunId: "",
      matchedTitle: "Prior topic",
      similarity: 0.92,
    };
    const label = formatPriorIssueLabel(item, {});
    expect(label).not.toBe("run …");
    expect(label).not.toContain("run …");
  });

  it("formatPriorIssueLabel unit — short 3-char matchedRunId returns 'run …abc'", () => {
    const item: SuppressItem = {
      title: "Suppressed candidate",
      link: "https://example.com/article",
      matchedRunId: "abc",
      matchedTitle: "Prior topic",
      similarity: 0.92,
    };
    expect(formatPriorIssueLabel(item, {})).toBe("run …abc");
  });

  it("case 7 — empty matchedRunId does not surface the literal 'run …' (table + cards)", () => {
    const matchedTitle = "Empty prior topic";
    const run = makeRun({ $id: "run-empty-id" });
    const summary = parseSuppressSummary(
      JSON.stringify({
        items: [
          {
            title: "Empty-id suppression",
            link: "https://example.com/a",
            matchedRunId: null,
            matchedTitle,
            similarity: 0.9,
          },
        ],
      }),
    );
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-empty-id": summary }}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    // matchedTitle still surfaces (data layer is intact).
    expect(isExposed(tableSlot, matchedTitle)).toBe(true);
    expect(hasVisibleText(cardsSlot, matchedTitle)).toBe(true);

    // The literal "run …" must NOT appear on either surface — the empty-id
    // prior label should be a different, non-run-shaped string.
    expect(isExposed(tableSlot, "run …")).toBe(false);
    expect(hasVisibleText(cardsSlot, "run …")).toBe(false);
  });

  it("case 8 — 3-char matchedRunId falls back to 'run …abc' (table + cards)", () => {
    const matchedTitle = "Short-id prior topic";
    const run = makeRun({ $id: "run-short-id" });
    const summary = summaryOf([makeSuppressItem({ matchedRunId: "abc", matchedTitle })]);
    render(
      <RunsTable
        runs={[run]}
        feedLookup={{}}
        failedFeedsByRun={{}}
        suppressSummaryByRun={{ "run-short-id": summary }}
        runLookup={{}}
      />,
    );

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    // matchedTitle on both surfaces (regression — same as case 5).
    expect(isExposed(tableSlot, matchedTitle)).toBe(true);
    expect(hasVisibleText(cardsSlot, matchedTitle)).toBe(true);

    // Short-id fallback shape on both surfaces (regression — slice behavior).
    expect(isExposed(tableSlot, "…abc")).toBe(true);
    expect(hasVisibleText(cardsSlot, "…abc")).toBe(true);
  });
});
