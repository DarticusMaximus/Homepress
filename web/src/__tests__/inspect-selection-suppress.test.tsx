/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type {
  CheckpointSelectedArticle,
  SelectionCheckpoint,
  SelectionFailureJson,
  SuppressItem,
  SuppressSummary,
} from "@newsletter/shared";
import {
  PHASE_EMPTY_COPY,
  PHASE_ERROR_COPY,
  PHASE_MISSING_COPY,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";
import {
  InspectSelectedSection,
  InspectSelectionAuditSections,
  InspectSelectionDropsSection,
  InspectSuppressedSection,
  SELECTION_DROPS_EMPTY_COPY,
  SELECTION_DROPS_LEGACY_COPY,
  SUPPRESS_EMPTY_COPY,
  formatSelectionFailureReason,
} from "@/components/runs/inspect-selection-section";
import { formatPriorIssueLabel, type RunLookup } from "@/components/runs/run-suppress-summary";
import { formatRunDateTime } from "@/components/runs/run-display";
import { expandInspectSection } from "./inspect-expand-section";

afterEach(() => {
  cleanup();
});

const PUBLISHED = new Date("2026-03-15T14:30:00.000Z");
const PRIOR_ENDED_AT = "2026-03-08T09:10:00.000Z";
const PRIOR_STARTED_AT = "2026-03-08T09:00:00.000Z";

function selectedArticle(
  overrides: Partial<CheckpointSelectedArticle> = {},
): CheckpointSelectedArticle {
  return {
    title: "Selected Title",
    link: "https://example.com/selected",
    published: PUBLISHED,
    content: "SECRET_FULL_CONTENT_SHOULD_NOT_RENDER",
    source: "Example Source",
    tags: ["ai", "news"],
    score: 0.82,
    ...overrides,
  };
}

function failure(overrides: Partial<SelectionFailureJson> = {}): SelectionFailureJson {
  return {
    articleTitle: "Dropped Title",
    articleLink: "https://example.com/dropped",
    reason: "below-threshold",
    ...overrides,
  };
}

function suppressItem(overrides: Partial<SuppressItem> = {}): SuppressItem {
  return {
    title: "Suppressed candidate",
    link: "https://example.com/suppressed",
    matchedRunId: "run-prior-abcdef",
    matchedTitle: "Prior topic headline",
    similarity: 0.91,
    ...overrides,
  };
}

function summaryOf(items: SuppressItem[]): SuppressSummary {
  return { count: items.length, items };
}

const runLookup: RunLookup = {
  "run-prior-abcdef": {
    startedAt: PRIOR_STARTED_AT,
    endedAt: PRIOR_ENDED_AT,
  },
};

function getSlots(container: HTMLElement): {
  tables: HTMLElement[];
  cards: HTMLElement[];
} {
  return {
    tables: Array.from(container.querySelectorAll('[data-slot="domain-list-table"]')),
    cards: Array.from(container.querySelectorAll('[data-slot="domain-list-cards"]')),
  };
}

describe("Inspect selection + suppress sections (Feature 06 Task 2)", () => {
  it("item 4: Selected section renders titles/scores; empty selected shows locked empty copy", () => {
    const loaded: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [
          selectedArticle({ title: "High score pick", score: 0.95, link: "https://example.com/h" }),
          selectedArticle({ title: "Lower pick", score: 0.7, link: "https://example.com/l" }),
        ],
        failures: [],
      },
    };

    const { container: loadedEl } = render(<InspectSelectedSection result={loaded} />);
    expect(loadedEl).toHaveTextContent("Selected (2)");
    expandInspectSection(loadedEl, "Selected");
    const selectedSection = loadedEl.querySelector(
      'section[aria-label="Selected"]',
    ) as HTMLElement;
    expect(within(selectedSection).getAllByText("High score pick").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(within(selectedSection).getAllByText("Lower pick").length).toBeGreaterThanOrEqual(1);
    expect(within(selectedSection).getAllByText("0.95").length).toBeGreaterThanOrEqual(1);
    expect(within(selectedSection).getAllByText("0.7").length).toBeGreaterThanOrEqual(1);
    expect(loadedEl).not.toHaveTextContent("SECRET_FULL_CONTENT_SHOULD_NOT_RENDER");

    const empty: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: { selectedArticles: [], failures: [] },
    };
    const { container: emptyEl } = render(<InspectSelectedSection result={empty} />);
    expect(emptyEl).toHaveTextContent("Selected (0)");
    expandInspectSection(emptyEl, "Selected");
    expect(emptyEl).toHaveTextContent(PHASE_EMPTY_COPY);
  });

  it("item 5: Selection drops reason labels for all three reasons; Detail shows error when present", () => {
    const result: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [selectedArticle()],
        failures: [
          failure({
            articleTitle: "Threshold drop",
            articleLink: "https://example.com/t",
            reason: "below-threshold",
          }),
          failure({
            articleTitle: "MMR drop",
            articleLink: "https://example.com/m",
            reason: "not-selected",
            error: "not selected by MMR (target=3, candidates=5)",
          }),
          failure({
            articleTitle: "Embed drop",
            articleLink: "https://example.com/e",
            reason: "embedding-failed",
            error: "embeddings timed out",
          }),
        ],
      },
    };

    const { container } = render(<InspectSelectionDropsSection result={result} />);
    expect(container).toHaveTextContent("Selection drops (3)");
    expandInspectSection(container, "Selection drops");
    const dropsSection = container.querySelector(
      'section[aria-label="Selection drops"]',
    ) as HTMLElement;
    expect(dropsSection).toHaveTextContent(formatSelectionFailureReason("below-threshold"));
    expect(dropsSection).toHaveTextContent(formatSelectionFailureReason("not-selected"));
    expect(dropsSection).toHaveTextContent(formatSelectionFailureReason("embedding-failed"));
    expect(dropsSection).toHaveTextContent("Below score threshold");
    expect(dropsSection).toHaveTextContent("Not selected by MMR");
    expect(dropsSection).toHaveTextContent("Embedding failed");
    expect(dropsSection).toHaveTextContent("not selected by MMR (target=3, candidates=5)");
    expect(dropsSection).toHaveTextContent("embeddings timed out");
    expect(within(dropsSection).getAllByText("Threshold drop").length).toBeGreaterThanOrEqual(1);
    expect(within(dropsSection).getAllByText("MMR drop").length).toBeGreaterThanOrEqual(1);
    expect(within(dropsSection).getAllByText("Embed drop").length).toBeGreaterThanOrEqual(1);
  });

  it("item 6: legacy drops copy when failures key absent and selected non-empty", () => {
    const result: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [selectedArticle()],
        // failures omitted → legacy
      },
    };

    const { container } = render(<InspectSelectionDropsSection result={result} />);
    expect(container).toHaveTextContent("Selection drops");
    expect(container).not.toHaveTextContent("Selection drops (");
    expandInspectSection(container, "Selection drops");
    expect(container).toHaveTextContent(SELECTION_DROPS_LEGACY_COPY);
    expect(container.querySelector('[data-slot="domain-list-table"]')).toBeNull();
  });

  it("item 7: explicit empty failures with selected shows no-drops copy", () => {
    const result: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [selectedArticle()],
        failures: [],
      },
    };

    const { container } = render(<InspectSelectionDropsSection result={result} />);
    expect(container).toHaveTextContent("Selection drops (0)");
    expandInspectSection(container, "Selection drops");
    expect(container).toHaveTextContent(SELECTION_DROPS_EMPTY_COPY);
    expect(container).not.toHaveTextContent(SELECTION_DROPS_LEGACY_COPY);
  });

  it("item 8: Suppressed list renders fields; count 0 shows locked empty copy", () => {
    const items = [
      suppressItem({
        title: "Dup story",
        matchedTitle: "Original prior",
        similarity: 0.88,
        matchedRunId: "run-prior-abcdef",
      }),
    ];
    const { container: listEl } = render(
      <InspectSuppressedSection summary={summaryOf(items)} runLookup={runLookup} />,
    );

    const expectedPrior = formatPriorIssueLabel(items[0]!, runLookup);
    expect(expectedPrior).toBe(formatRunDateTime(PRIOR_ENDED_AT));
    expect(listEl).toHaveTextContent("Suppressed (1)");
    expandInspectSection(listEl, "Suppressed");
    const suppressedSection = listEl.querySelector(
      'section[aria-label="Suppressed"]',
    ) as HTMLElement;
    expect(within(suppressedSection).getAllByText("Dup story").length).toBeGreaterThanOrEqual(1);
    expect(within(suppressedSection).getAllByText("Original prior").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(suppressedSection).toHaveTextContent(expectedPrior);
    expect(within(suppressedSection).getAllByText("0.88").length).toBeGreaterThanOrEqual(1);

    const { container: emptyEl } = render(
      <InspectSuppressedSection summary={{ count: 0, items: [] }} runLookup={{}} />,
    );
    expect(emptyEl).toHaveTextContent("Suppressed (0)");
    expandInspectSection(emptyEl, "Suppressed");
    expect(emptyEl).toHaveTextContent(SUPPRESS_EMPTY_COPY);
  });

  it("item 9: missing selection copy + suppress still lists items", () => {
    const selection: PhaseLoadResult<SelectionCheckpoint> = { status: "missing" };
    const suppress = summaryOf([
      suppressItem({ title: "Empty-after-suppress item", matchedTitle: "Prior match" }),
    ]);

    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={suppress}
        runLookup={runLookup}
      />,
    );

    expect(container).toHaveTextContent("Selected");
    expect(container).not.toHaveTextContent("Selected (");
    expect(container).toHaveTextContent("Selection drops");
    expect(container).not.toHaveTextContent("Selection drops (");

    expandInspectSection(container, "Selected");
    expandInspectSection(container, "Selection drops");
    // Missing copy appears for both Selected and Selection drops
    const missingMatches = within(container as HTMLElement).getAllByText(PHASE_MISSING_COPY);
    expect(missingMatches.length).toBeGreaterThanOrEqual(2);

    expect(container).toHaveTextContent("Suppressed (1)");
    expandInspectSection(container, "Suppressed");
    const suppressedSection = container.querySelector(
      'section[aria-label="Suppressed"]',
    ) as HTMLElement;
    expect(
      within(suppressedSection).getAllByText("Empty-after-suppress item").length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(suppressedSection).getAllByText("Prior match").length).toBeGreaterThanOrEqual(1);
  });

  it("item 10: ResponsiveList mounts table + cards slots when sections have rows", () => {
    const selection: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [selectedArticle({ title: "Pick A", link: "https://example.com/a" })],
        failures: [
          failure({
            articleTitle: "Drop A",
            articleLink: "https://example.com/drop-a",
            reason: "not-selected",
          }),
        ],
      },
    };
    const suppress = summaryOf([
      suppressItem({ title: "Supp A", link: "https://example.com/supp-a" }),
    ]);

    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={suppress}
        runLookup={runLookup}
      />,
    );

    expandInspectSection(container, "Selected");
    expandInspectSection(container, "Selection drops");
    expandInspectSection(container, "Suppressed");

    const { tables, cards } = getSlots(container);
    // Selected + Selection drops + Suppressed each contribute one table + one cards slot
    expect(tables.length).toBe(3);
    expect(cards.length).toBe(3);
  });

  it("item 11: success-path audit body does not render draft markdown / Feature 07 chrome", () => {
    const selection: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [selectedArticle()],
        failures: [failure({ reason: "embedding-failed", error: "boom" })],
      },
    };
    const suppress = summaryOf([suppressItem()]);

    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={suppress}
        runLookup={runLookup}
      />,
    );

    expect(container).toHaveTextContent("Selected");
    expect(container).toHaveTextContent("Selection drops");
    expect(container).toHaveTextContent("Suppressed");
    expect(container).not.toHaveTextContent("Draft");
    expect(container).not.toHaveTextContent("## ");
    expect(container).not.toHaveTextContent("draft-beside");
    expect(container).not.toHaveTextContent("IssueReader");
    expect(container.querySelector('[data-testid="draft-inspect"]')).toBeNull();
    expect(container.querySelector('[data-slot="draft-markdown"]')).toBeNull();
  });

  it("shared error Alert appears once above Selected + Selection drops", () => {
    const selection: PhaseLoadResult<SelectionCheckpoint> = { status: "error" };
    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={{ count: 0, items: [] }}
        runLookup={{}}
      />,
    );

    // Alert is above collapsibles — visible without expand
    const alerts = within(container as HTMLElement).getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(PHASE_ERROR_COPY);
    expect(container).toHaveTextContent("Selected");
    expect(container).toHaveTextContent("Selection drops");

    expandInspectSection(container, "Suppressed");
    expect(container).toHaveTextContent(SUPPRESS_EMPTY_COPY);
  });

  it("selection sections default collapsed; expand reveals body", () => {
    const selection: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [
          selectedArticle({ title: "Collapsed Selected", link: "https://example.com/cs" }),
        ],
        failures: [
          failure({
            articleTitle: "Collapsed Drop",
            articleLink: "https://example.com/cd",
            reason: "below-threshold",
          }),
        ],
      },
    };
    const suppress = summaryOf([
      suppressItem({ title: "Collapsed Suppress", link: "https://example.com/csup" }),
    ]);

    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={suppress}
        runLookup={runLookup}
      />,
    );

    expect(container.querySelector('[data-slot="domain-list-table"]')).toBeNull();
    expect(within(container).queryByText("Collapsed Selected")).not.toBeInTheDocument();
    expect(within(container).queryByText("Collapsed Drop")).not.toBeInTheDocument();
    expect(within(container).queryByText("Collapsed Suppress")).not.toBeInTheDocument();

    expandInspectSection(container, "Selected");
    expandInspectSection(container, "Selection drops");
    expandInspectSection(container, "Suppressed");

    expect(within(container).getAllByText("Collapsed Selected").length).toBeGreaterThanOrEqual(1);
    expect(within(container).getAllByText("Collapsed Drop").length).toBeGreaterThanOrEqual(1);
    expect(within(container).getAllByText("Collapsed Suppress").length).toBeGreaterThanOrEqual(1);
  });

  it("S1: valid HTTP(S) selection-drop and suppression links keep Open + new-tab attrs", () => {
    const dropUrl = "https://example.test/drop";
    const suppressUrl = "http://example.test/suppress";
    const selection: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [],
        failures: [
          failure({
            articleTitle: "Safe drop",
            articleLink: dropUrl,
            reason: "below-threshold",
          }),
        ],
      },
    };
    const suppress = summaryOf([
      suppressItem({ title: "Safe suppress", link: suppressUrl }),
    ]);

    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={suppress}
        runLookup={runLookup}
      />,
    );

    expandInspectSection(container, "Selection drops");
    expandInspectSection(container, "Suppressed");

    const { tables, cards } = getSlots(container);
    // Selection drops + Suppressed (Selected empty → no list)
    expect(tables.length).toBe(2);
    expect(cards.length).toBe(2);

    for (const slot of [...tables, ...cards]) {
      const openLinks = within(slot).getAllByRole("link", { name: "Open" });
      expect(openLinks).toHaveLength(1);
      const link = openLinks[0]!;
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const href = link.getAttribute("href");
      expect(href === dropUrl || href === suppressUrl).toBe(true);
      expect(link).toHaveAttribute("title", href);
    }
  });

  it("S1: unsafe selection-drop and suppression links render unavailable text, not anchors", () => {
    const unsafeDrop = "javascript:alert(1)";
    const unsafeSuppress = "data:text/html,hi";
    const selection: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [],
        failures: [
          failure({
            articleTitle: "Unsafe drop",
            articleLink: unsafeDrop,
            reason: "not-selected",
          }),
          failure({
            articleTitle: "Relative drop",
            articleLink: "/relative/drop",
            reason: "embedding-failed",
          }),
          failure({
            articleTitle: "Blank drop",
            articleLink: "",
            reason: "below-threshold",
          }),
          failure({
            articleTitle: "Mailto drop",
            articleLink: "mailto:ops@example.test",
            reason: "below-threshold",
          }),
        ],
      },
    };
    const suppress = summaryOf([
      suppressItem({ title: "Unsafe suppress", link: unsafeSuppress }),
      suppressItem({ title: "Malformed suppress", link: "not a url" }),
    ]);

    const { container } = render(
      <InspectSelectionAuditSections
        selection={selection}
        suppressSummary={suppress}
        runLookup={runLookup}
      />,
    );

    expandInspectSection(container, "Selection drops");
    expandInspectSection(container, "Suppressed");

    const { tables, cards } = getSlots(container);
    expect(tables.length).toBe(2);
    expect(cards.length).toBe(2);

    for (const slot of [...tables, ...cards]) {
      expect(within(slot).queryByRole("link")).toBeNull();
      expect(within(slot).queryByText("Open")).toBeNull();
      expect(within(slot).getAllByText("Unavailable").length).toBeGreaterThanOrEqual(1);
    }

    expect(container.querySelector(`a[href="${CSS.escape(unsafeDrop)}"]`)).toBeNull();
    expect(
      container.querySelector(`a[href="${CSS.escape(unsafeSuppress)}"]`),
    ).toBeNull();
  });

  it("S2: legacy selection-failure detail redacts API keys and Bearer tokens in table and cards", () => {
    const apiKey = "sk-or-v1-abcdef1234567890abcdef1234567890abcdef1234567890";
    const bearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacysecret";
    const rawError = `Embedding failed with key ${apiKey}; Authorization: Bearer ${bearer}`;
    const result: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [],
        failures: [
          failure({
            articleTitle: "Legacy secret drop",
            articleLink: "https://example.test/legacy-drop",
            reason: "embedding-failed",
            error: rawError,
          }),
        ],
      },
    };

    const { container } = render(<InspectSelectionDropsSection result={result} />);
    expandInspectSection(container, "Selection drops");
    const { tables, cards } = getSlots(container);
    expect(tables).toHaveLength(1);
    expect(cards).toHaveLength(1);

    for (const slot of [...tables, ...cards]) {
      expect(slot).toHaveTextContent("Legacy secret drop");
      expect(slot).toHaveTextContent(formatSelectionFailureReason("embedding-failed"));
      expect(slot).toHaveTextContent("Embedding failed");
      expect(slot).toHaveTextContent("[redacted]");
      expect(slot).not.toHaveTextContent(apiKey);
      expect(slot).not.toHaveTextContent("sk-or-v1");
      expect(slot).not.toHaveTextContent(bearer);
      expect(slot.textContent ?? "").not.toMatch(/Bearer\s+\S/i);
    }
  });

  it("S2: absent or empty failure detail still shows em dash", () => {
    const result: PhaseLoadResult<SelectionCheckpoint> = {
      status: "loaded",
      data: {
        selectedArticles: [],
        failures: [
          failure({
            articleTitle: "No detail drop",
            articleLink: "https://example.test/no-detail",
            reason: "below-threshold",
          }),
          failure({
            articleTitle: "Empty detail drop",
            articleLink: "https://example.test/empty-detail",
            reason: "not-selected",
            error: "",
          }),
        ],
      },
    };

    const { container } = render(<InspectSelectionDropsSection result={result} />);
    expandInspectSection(container, "Selection drops");
    const dropsSection = container.querySelector(
      'section[aria-label="Selection drops"]',
    ) as HTMLElement;
    expect(within(dropsSection).getAllByText("No detail drop").length).toBeGreaterThanOrEqual(1);
    expect(within(dropsSection).getAllByText("Empty detail drop").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(dropsSection).toHaveTextContent("\u2014");
  });
});
