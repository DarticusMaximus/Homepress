/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type {
  CheckpointScoredArticle,
  CheckpointTaggedArticle,
  PhaseFailureSummaryJson,
  ScoreCheckpoint,
  TagCheckpoint,
} from "@newsletter/shared";
import {
  InspectScoredSection,
  InspectTaggedSection,
  PHASE_EMPTY_COPY,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";
import {
  formatPhaseArticleFailureReason,
  formatPhaseFailureSummaryLine,
  InspectPhaseFailureBlock,
} from "@/components/runs/inspect-phase-failure";
import { expandInspectSection } from "./inspect-expand-section";

afterEach(() => {
  cleanup();
});

const PUBLISHED = new Date("2026-03-15T14:30:00.000Z");

function taggedArticle(
  overrides: Partial<CheckpointTaggedArticle> = {},
): CheckpointTaggedArticle {
  return {
    title: "Tagged Title",
    link: "https://example.com/tagged",
    published: PUBLISHED,
    content: "SECRET_FULL_CONTENT_SHOULD_NOT_RENDER",
    source: "Example Source",
    tags: ["ai"],
    ...overrides,
  };
}

function scoredArticle(
  overrides: Partial<CheckpointScoredArticle> = {},
): CheckpointScoredArticle {
  return {
    ...taggedArticle(),
    score: 0.5,
    ...overrides,
  };
}

function tagPhaseFailure(
  overrides: Partial<PhaseFailureSummaryJson> = {},
): PhaseFailureSummaryJson {
  return {
    halted: true,
    haltReason: "Tag phase halted: 5 consecutive article failures",
    consecutiveErrors: 5,
    totalArticles: 12,
    failureCount: 5,
    failures: [
      {
        articleTitle: "Failed Tag Story",
        articleLink: "https://example.com/fail-tag",
        error: "provider timeout",
        attempts: 3,
      },
    ],
    ...overrides,
  };
}

function scorePhaseFailure(
  overrides: Partial<PhaseFailureSummaryJson> = {},
): PhaseFailureSummaryJson {
  return {
    halted: true,
    haltReason: "Score phase halted: 5 consecutive article failures",
    consecutiveErrors: 5,
    totalArticles: 8,
    failureCount: 4,
    failures: [
      {
        articleTitle: "Failed Score Story",
        articleLink: "https://example.com/fail-score",
        error: "JSON parse failed",
        attempts: 2,
        reason: "parse",
      },
    ],
    ...overrides,
  };
}

function getSlots(container: HTMLElement): {
  tables: HTMLElement[];
  cards: HTMLElement[];
} {
  return {
    tables: Array.from(container.querySelectorAll('[data-slot="domain-list-table"]')),
    cards: Array.from(container.querySelectorAll('[data-slot="domain-list-cards"]')),
  };
}

describe("Inspect phaseFailure UI (Feature 03 Task 5)", () => {
  it("with phaseFailure: summary + failure rows visible on Tagged", () => {
    const phaseFailure = tagPhaseFailure();
    const result: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: {
        taggedArticles: [
          taggedArticle({ title: "Success Tag", link: "https://example.com/ok-tag" }),
        ],
        phaseFailure,
      },
    };

    const { container } = render(<InspectTaggedSection result={result} />);
    expandInspectSection(container, "Tagged");

    const section = container.querySelector(
      'section[aria-label="Tagged"]',
    ) as HTMLElement;
    expect(section.querySelector('[data-slot="phase-failure-block"]')).not.toBeNull();
    expect(section).toHaveTextContent(formatPhaseFailureSummaryLine(phaseFailure));
    expect(section).toHaveTextContent("Failed Tag Story");
    expect(section).toHaveTextContent("provider timeout");
    expect(section).toHaveTextContent("3");
    expect(within(section).getAllByText("Success Tag").length).toBeGreaterThanOrEqual(1);

    const failureBlock = section.querySelector(
      '[data-slot="phase-failure-block"]',
    ) as HTMLElement;
    const { tables, cards } = getSlots(failureBlock);
    expect(tables).toHaveLength(1);
    expect(cards).toHaveLength(1);
    expect(within(tables[0]).getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
    expect(within(tables[0]).getByRole("columnheader", { name: "Error" })).toBeInTheDocument();
    expect(within(tables[0]).getByRole("columnheader", { name: "Attempts" })).toBeInTheDocument();
    expect(within(tables[0]).getByRole("columnheader", { name: "Link" })).toBeInTheDocument();
    expect(within(tables[0]).queryByRole("columnheader", { name: "Reason" })).toBeNull();
  });

  it("with phaseFailure + empty success list: failure UI still visible (not empty-copy alone)", () => {
    const phaseFailure = tagPhaseFailure({
      failureCount: 5,
      totalArticles: 5,
    });
    const result: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: {
        taggedArticles: [],
        phaseFailure,
      },
    };

    const { container } = render(<InspectTaggedSection result={result} />);
    expect(container).toHaveTextContent("Tagged (0)");
    expandInspectSection(container, "Tagged");

    const section = container.querySelector(
      'section[aria-label="Tagged"]',
    ) as HTMLElement;
    const failureBlock = section.querySelector('[data-slot="phase-failure-block"]');
    expect(failureBlock).not.toBeNull();
    expect(section).toHaveTextContent(formatPhaseFailureSummaryLine(phaseFailure));
    expect(section).toHaveTextContent("Failed Tag Story");
    expect(section).toHaveTextContent("provider timeout");

    // Empty copy may still appear in addition — but must not be the only body content.
    expect(section).toHaveTextContent(PHASE_EMPTY_COPY);
    expect(failureBlock).not.toBeNull();

    const { tables, cards } = getSlots(failureBlock as HTMLElement);
    expect(tables).toHaveLength(1);
    expect(cards).toHaveLength(1);
  });

  it("with phaseFailure on Scored: shows Reason column for score failures", () => {
    const phaseFailure = scorePhaseFailure();
    const result: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [],
        phaseFailure,
      },
    };

    const { container } = render(<InspectScoredSection result={result} />);
    expandInspectSection(container, "Scored");

    const section = container.querySelector(
      'section[aria-label="Scored"]',
    ) as HTMLElement;
    expect(section.querySelector('[data-slot="phase-failure-block"]')).not.toBeNull();
    expect(section).toHaveTextContent(formatPhaseFailureSummaryLine(phaseFailure));
    expect(section).toHaveTextContent("Failed Score Story");
    expect(section).toHaveTextContent("JSON parse failed");
    expect(section).toHaveTextContent(formatPhaseArticleFailureReason("parse"));
    expect(section).toHaveTextContent(PHASE_EMPTY_COPY);

    const failureBlock = section.querySelector(
      '[data-slot="phase-failure-block"]',
    ) as HTMLElement;
    const { tables } = getSlots(failureBlock);
    expect(within(tables[0]).getByRole("columnheader", { name: "Reason" })).toBeInTheDocument();
  });

  it("without phaseFailure: no failure block; empty list uses locked empty copy only", () => {
    const tagged: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: { taggedArticles: [] },
    };
    const scored: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [
          scoredArticle({ title: "Scored Ok", link: "https://example.com/scored-ok" }),
        ],
      },
    };

    const { container: taggedEl } = render(<InspectTaggedSection result={tagged} />);
    expandInspectSection(taggedEl, "Tagged");
    expect(taggedEl.querySelector('[data-slot="phase-failure-block"]')).toBeNull();
    expect(taggedEl).toHaveTextContent(PHASE_EMPTY_COPY);
    expect(taggedEl).not.toHaveTextContent("Halt reason:");
    expect(taggedEl).not.toHaveTextContent("Consecutive errors:");

    const { container: scoredEl } = render(<InspectScoredSection result={scored} />);
    expandInspectSection(scoredEl, "Scored");
    expect(scoredEl.querySelector('[data-slot="phase-failure-block"]')).toBeNull();
    expect(scoredEl).not.toHaveTextContent("Halt reason:");
    expect(within(scoredEl).getAllByText("Scored Ok").length).toBeGreaterThanOrEqual(1);
  });

  it("responsive list still used for phaseFailure rows", () => {
    const result: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: {
        taggedArticles: [],
        phaseFailure: tagPhaseFailure({
          failures: [
            {
              articleTitle: "A",
              articleLink: "https://example.com/a",
              error: "err-a",
              attempts: 1,
            },
            {
              articleTitle: "B",
              articleLink: "https://example.com/b",
              error: "err-b",
              attempts: 2,
            },
          ],
        }),
      },
    };

    const { container } = render(<InspectTaggedSection result={result} />);
    expandInspectSection(container, "Tagged");

    const failureBlock = container.querySelector(
      '[data-slot="phase-failure-block"]',
    ) as HTMLElement;
    const { tables, cards } = getSlots(failureBlock);
    expect(tables).toHaveLength(1);
    expect(cards).toHaveLength(1);
    expect(within(tables[0]).getByText("A")).toBeInTheDocument();
    expect(within(tables[0]).getByText("B")).toBeInTheDocument();
    expect(within(cards[0]).getByText("A")).toBeInTheDocument();
    expect(within(cards[0]).getByText("B")).toBeInTheDocument();
  });

  it("S1: re-redacts secretful haltReason and per-row error on display", () => {
    const skSecret = "sk-ant-api03-TESTSECRET";
    const bearerSecret = "TESTTOKEN";
    const errorSecret = "sk-test-DISPLAYSECRET1234567890abcdef";
    const phaseFailure = tagPhaseFailure({
      haltReason: `Tagging halted (last error: ${skSecret}; Bearer ${bearerSecret})`,
      consecutiveErrors: 5,
      failureCount: 1,
      failures: [
        {
          articleTitle: "Secret failure row",
          articleLink: "https://example.com/secret-fail",
          error: `provider rejected key ${errorSecret}`,
          attempts: 3,
        },
      ],
    });

    const { container } = render(<InspectPhaseFailureBlock phaseFailure={phaseFailure} />);
    const block = container.querySelector(
      '[data-slot="phase-failure-block"]',
    ) as HTMLElement;
    expect(block).not.toBeNull();

    expect(within(block).queryByText(skSecret, { exact: false })).toBeNull();
    expect(within(block).queryByText(bearerSecret, { exact: false })).toBeNull();
    expect(within(block).queryByText(errorSecret, { exact: false })).toBeNull();
    expect(block.textContent ?? "").not.toContain(skSecret);
    expect(block.textContent ?? "").not.toContain("sk-ant-api03");
    expect(block.textContent ?? "").not.toContain(errorSecret);
    expect(block.textContent ?? "").not.toMatch(/Bearer\s+\S/i);

    expect(block).toHaveTextContent("Halt reason:");
    expect(block).toHaveTextContent("Consecutive errors: 5");
    expect(block).toHaveTextContent("Failures: 1");
    expect(block).toHaveTextContent("Secret failure row");
    expect(block).toHaveTextContent("[redacted]");

    const { tables, cards } = getSlots(block);
    expect(tables).toHaveLength(1);
    expect(cards).toHaveLength(1);
    for (const slot of [...tables, ...cards]) {
      expect(slot).not.toHaveTextContent(errorSecret);
      expect(slot).toHaveTextContent("[redacted]");
    }
  });
});
