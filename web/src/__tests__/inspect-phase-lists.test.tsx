/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type {
  CheckpointArticle,
  CheckpointScoredArticle,
  CheckpointTaggedArticle,
  FetchCheckpoint,
  ScrapeCheckpoint,
  ScoreCheckpoint,
  TagCheckpoint,
} from "@newsletter/shared";
import {
  InspectFetchedSection,
  InspectScrapedSection,
  InspectTaggedSection,
  InspectScoredSection,
  PHASE_EMPTY_COPY,
  PHASE_ERROR_COPY,
  PHASE_MISSING_COPY,
  formatScrapeSummaryLine,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";
import { expandInspectSection } from "./inspect-expand-section";

afterEach(() => {
  cleanup();
});

const PUBLISHED = new Date("2026-03-15T14:30:00.000Z");

function basicArticle(overrides: Partial<CheckpointArticle> = {}): CheckpointArticle {
  return {
    title: "Basic Title",
    link: "https://example.com/a",
    published: PUBLISHED,
    content: "SECRET_FULL_CONTENT_SHOULD_NOT_RENDER",
    source: "Example Source",
    ...overrides,
  };
}

function taggedArticle(
  overrides: Partial<CheckpointTaggedArticle> = {},
): CheckpointTaggedArticle {
  return {
    ...basicArticle(),
    tags: ["ai", "news"],
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

function getSlots(container: HTMLElement): {
  tables: HTMLElement[];
  cards: HTMLElement[];
} {
  return {
    tables: Array.from(container.querySelectorAll('[data-slot="domain-list-table"]')),
    cards: Array.from(container.querySelectorAll('[data-slot="domain-list-cards"]')),
  };
}

function titlesInOrder(slot: HTMLElement): string[] {
  return within(slot)
    .getAllByRole("row")
    .slice(1) // skip header
    .map((row) => {
      const cell = within(row).getAllByRole("cell")[0];
      return cell.textContent?.trim() ?? "";
    });
}

function cardTitlesInOrder(slot: HTMLElement): string[] {
  return Array.from(slot.querySelectorAll('[data-slot="card-title"]')).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("Inspect phase sections (Feature 05 Task 2)", () => {
  it("item 2: missing status shows locked checkpoint copy", () => {
    const result: PhaseLoadResult<FetchCheckpoint> = { status: "missing" };
    const { container } = render(<InspectFetchedSection result={result} />);

    expect(container).toHaveTextContent("Fetched");
    expect(container).not.toHaveTextContent("Fetched (");
    expandInspectSection(container, "Fetched");
    expect(container).toHaveTextContent(PHASE_MISSING_COPY);
    expect(container.querySelector('[data-slot="domain-list-table"]')).toBeNull();
  });

  it("item 3: empty arrays use per-phase property and locked empty copy", () => {
    const fetchResult: PhaseLoadResult<FetchCheckpoint> = {
      status: "loaded",
      data: { articles: [] },
    };
    const scrapeResult: PhaseLoadResult<ScrapeCheckpoint> = {
      status: "loaded",
      data: {
        articles: [],
        summary: { extracted: 0, fallback: 0, total: 0 },
      },
    };
    const taggedResult: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: { taggedArticles: [] },
    };
    const scoredResult: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: { scoredArticles: [] },
    };

    const { container: fetchEl } = render(<InspectFetchedSection result={fetchResult} />);
    expect(fetchEl).toHaveTextContent("Fetched (0)");
    expandInspectSection(fetchEl, "Fetched");
    expect(fetchEl).toHaveTextContent(PHASE_EMPTY_COPY);

    const { container: scrapeEl } = render(<InspectScrapedSection result={scrapeResult} />);
    expect(scrapeEl).toHaveTextContent("Scraped (0)");
    expandInspectSection(scrapeEl, "Scraped");
    expect(scrapeEl).toHaveTextContent(PHASE_EMPTY_COPY);
    // Summary still shown when loaded (even if empty articles)
    expect(scrapeEl).toHaveTextContent("Extracted 0 · Fallback 0 · Total 0");
    expect(scrapeEl).toHaveTextContent(
      formatScrapeSummaryLine({ extracted: 0, fallback: 0, total: 0 }),
    );

    const { container: taggedEl } = render(<InspectTaggedSection result={taggedResult} />);
    expect(taggedEl).toHaveTextContent("Tagged (0)");
    expandInspectSection(taggedEl, "Tagged");
    expect(taggedEl).toHaveTextContent(PHASE_EMPTY_COPY);

    const { container: scoredEl } = render(<InspectScoredSection result={scoredResult} />);
    expect(scoredEl).toHaveTextContent("Scored (0)");
    expandInspectSection(scoredEl, "Scored");
    expect(scoredEl).toHaveTextContent(PHASE_EMPTY_COPY);
  });

  it("item 4: scrape summary shows Extracted / Fallback / Total", () => {
    const summary = { extracted: 7, fallback: 3, total: 10 };
    const result: PhaseLoadResult<ScrapeCheckpoint> = {
      status: "loaded",
      data: {
        articles: [basicArticle({ title: "Scraped One", link: "https://example.com/s1" })],
        summary,
      },
    };

    const { container } = render(<InspectScrapedSection result={result} />);
    expandInspectSection(container, "Scraped");
    expect(container).toHaveTextContent("Extracted 7 · Fallback 3 · Total 10");
    expect(container).toHaveTextContent(formatScrapeSummaryLine(summary));
  });

  it("item 5: scored articles render score-descending in table and cards", () => {
    const result: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [
          scoredArticle({
            title: "Low",
            link: "https://example.com/low",
            score: 0.2,
          }),
          scoredArticle({
            title: "High",
            link: "https://example.com/high",
            score: 0.9,
          }),
          scoredArticle({
            title: "Mid",
            link: "https://example.com/mid",
            score: 0.5,
          }),
        ],
      },
    };

    const { container } = render(<InspectScoredSection result={result} />);
    expandInspectSection(container, "Scored");
    const { tables, cards } = getSlots(container);
    expect(tables).toHaveLength(1);
    expect(cards).toHaveLength(1);

    expect(titlesInOrder(tables[0])).toEqual(["High", "Mid", "Low"]);
    expect(cardTitlesInOrder(cards[0])).toEqual(["High", "Mid", "Low"]);

    // Scores visible in both presentations
    expect(within(tables[0]).getByText("0.9")).toBeInTheDocument();
    expect(within(cards[0]).getByText("0.9")).toBeInTheDocument();
  });

  it("item 6: tagged/scored expose title, source, tags (+ score); no content column", () => {
    const tagged: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: {
        taggedArticles: [
          taggedArticle({
            title: "Tagged Story",
            source: "Tag Source",
            tags: ["alpha", "beta"],
            content: "SECRET_FULL_CONTENT_SHOULD_NOT_RENDER",
            link: "https://example.com/tagged",
          }),
        ],
      },
    };
    const scored: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [
          scoredArticle({
            title: "Scored Story",
            source: "Score Source",
            tags: ["gamma"],
            score: 0.75,
            content: "SECRET_FULL_CONTENT_SHOULD_NOT_RENDER",
            link: "https://example.com/scored",
          }),
        ],
      },
    };

    const { container: taggedEl } = render(<InspectTaggedSection result={tagged} />);
    expandInspectSection(taggedEl, "Tagged");
    const taggedSlots = getSlots(taggedEl);
    for (const slot of [...taggedSlots.tables, ...taggedSlots.cards]) {
      expect(within(slot).getByText("Tagged Story")).toBeInTheDocument();
      expect(within(slot).getByText("Tag Source")).toBeInTheDocument();
      expect(within(slot).getByText("alpha, beta")).toBeInTheDocument();
    }
    expect(taggedEl).toHaveTextContent("Tags");
    expect(taggedEl).not.toHaveTextContent("SECRET_FULL_CONTENT_SHOULD_NOT_RENDER");
    // No Content column header
    expect(within(taggedSlots.tables[0]).queryByRole("columnheader", { name: "Content" })).toBeNull();

    const { container: scoredEl } = render(<InspectScoredSection result={scored} />);
    expandInspectSection(scoredEl, "Scored");
    const scoredSlots = getSlots(scoredEl);
    for (const slot of [...scoredSlots.tables, ...scoredSlots.cards]) {
      expect(within(slot).getByText("Scored Story")).toBeInTheDocument();
      expect(within(slot).getByText("Score Source")).toBeInTheDocument();
      expect(within(slot).getByText("gamma")).toBeInTheDocument();
      expect(within(slot).getByText("0.75")).toBeInTheDocument();
    }
    expect(scoredEl).toHaveTextContent("Score");
    expect(scoredEl).not.toHaveTextContent("SECRET_FULL_CONTENT_SHOULD_NOT_RENDER");
    expect(within(scoredSlots.tables[0]).queryByRole("columnheader", { name: "Content" })).toBeNull();
  });

  it("item 7: error Alert uses locked copy; sibling loaded section still visible", () => {
    const errorResult: PhaseLoadResult<FetchCheckpoint> = { status: "error" };
    const loadedResult: PhaseLoadResult<ScrapeCheckpoint> = {
      status: "loaded",
      data: {
        articles: [
          basicArticle({
            title: "Sibling Visible",
            link: "https://example.com/sibling",
            content: "SECRET_FULL_CONTENT_SHOULD_NOT_RENDER",
          }),
        ],
        summary: { extracted: 1, fallback: 0, total: 1 },
      },
    };

    const { container } = render(
      <>
        <InspectFetchedSection result={errorResult} />
        <InspectScrapedSection result={loadedResult} />
      </>,
    );

    // Heading without count for error section (always on trigger)
    const fetchedHeading = within(container).getByRole("heading", { name: "Fetched" });
    expect(fetchedHeading).toBeInTheDocument();
    expect(container).toHaveTextContent("Scraped (1)");

    expandInspectSection(container, "Fetched");
    expect(container).toHaveTextContent(PHASE_ERROR_COPY);
    expect(PHASE_ERROR_COPY).toContain("\u2019");
    expect(container.querySelector('[data-slot="alert"]')).toBeTruthy();

    expandInspectSection(container, "Scraped");
    const scrapedSection = container.querySelector(
      'section[aria-label="Scraped"]',
    ) as HTMLElement;
    expect(within(scrapedSection).getAllByText("Sibling Visible").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("item 9: each article list mounts table and cards slots", () => {
    const fetchResult: PhaseLoadResult<FetchCheckpoint> = {
      status: "loaded",
      data: {
        articles: [basicArticle({ title: "F1", link: "https://example.com/f1" })],
      },
    };
    const scrapeResult: PhaseLoadResult<ScrapeCheckpoint> = {
      status: "loaded",
      data: {
        articles: [basicArticle({ title: "S1", link: "https://example.com/s1" })],
        summary: { extracted: 1, fallback: 0, total: 1 },
      },
    };
    const taggedResult: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: {
        taggedArticles: [
          taggedArticle({ title: "T1", link: "https://example.com/t1" }),
        ],
      },
    };
    const scoredResult: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [
          scoredArticle({ title: "Sc1", link: "https://example.com/sc1", score: 0.8 }),
        ],
      },
    };

    const { container } = render(
      <>
        <InspectFetchedSection result={fetchResult} />
        <InspectScrapedSection result={scrapeResult} />
        <InspectTaggedSection result={taggedResult} />
        <InspectScoredSection result={scoredResult} />
      </>,
    );

    expandInspectSection(container, "Fetched");
    expandInspectSection(container, "Scraped");
    expandInspectSection(container, "Tagged");
    expandInspectSection(container, "Scored");

    const { tables, cards } = getSlots(container);
    expect(tables).toHaveLength(4);
    expect(cards).toHaveLength(4);

    // External links present with locked attributes
    const links = container.querySelectorAll('a[target="_blank"][rel="noopener noreferrer"]');
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  it("S1: valid HTTP(S) article links keep Open + new-tab attrs across phase lists", () => {
    const httpsUrl = "https://example.test/path";
    const httpUrl = "http://example.test/plain";
    const fetchResult: PhaseLoadResult<FetchCheckpoint> = {
      status: "loaded",
      data: {
        articles: [basicArticle({ title: "Fetch HTTPS", link: httpsUrl })],
      },
    };
    const scrapeResult: PhaseLoadResult<ScrapeCheckpoint> = {
      status: "loaded",
      data: {
        articles: [basicArticle({ title: "Scrape HTTP", link: httpUrl })],
        summary: { extracted: 1, fallback: 0, total: 1 },
      },
    };
    const taggedResult: PhaseLoadResult<TagCheckpoint> = {
      status: "loaded",
      data: {
        taggedArticles: [
          taggedArticle({ title: "Tagged HTTPS", link: httpsUrl }),
        ],
      },
    };
    const scoredResult: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [
          scoredArticle({ title: "Scored HTTPS", link: httpsUrl, score: 0.8 }),
        ],
      },
    };

    const { container } = render(
      <>
        <InspectFetchedSection result={fetchResult} />
        <InspectScrapedSection result={scrapeResult} />
        <InspectTaggedSection result={taggedResult} />
        <InspectScoredSection result={scoredResult} />
      </>,
    );

    expandInspectSection(container, "Fetched");
    expandInspectSection(container, "Scraped");
    expandInspectSection(container, "Tagged");
    expandInspectSection(container, "Scored");

    const { tables, cards } = getSlots(container);
    expect(tables).toHaveLength(4);
    expect(cards).toHaveLength(4);

    for (const slot of [...tables, ...cards]) {
      const openLinks = within(slot).getAllByRole("link", { name: "Open" });
      expect(openLinks.length).toBeGreaterThanOrEqual(1);
      for (const link of openLinks) {
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        const href = link.getAttribute("href");
        expect(href === httpsUrl || href === httpUrl).toBe(true);
        expect(link).toHaveAttribute("title", href);
      }
    }
  });

  it("S1: unsafe article link values render plain unavailable text, not anchors", () => {
    const unsafeLinks = [
      "javascript:alert(1)",
      "data:text/html,hi",
      "mailto:ops@example.test",
      "/relative/path",
      "",
      "not a url",
    ] as const;

    const { container } = render(
      <>
        {unsafeLinks.map((link, index) => (
          <InspectFetchedSection
            key={`unsafe-${index}`}
            result={{
              status: "loaded",
              data: {
                articles: [
                  basicArticle({
                    title: `Unsafe ${index}`,
                    link,
                  }),
                ],
              },
            }}
          />
        ))}
      </>,
    );

    // Multiple Fetched sections share aria-label — expand each by its trigger.
    const fetchedSections = Array.from(
      container.querySelectorAll('section[aria-label="Fetched"]'),
    ) as HTMLElement[];
    expect(fetchedSections).toHaveLength(unsafeLinks.length);
    for (const section of fetchedSections) {
      const trigger = within(section).getByRole("button", { name: /^Fetched/ });
      fireEvent.click(trigger);
    }

    const { tables, cards } = getSlots(container);
    expect(tables).toHaveLength(unsafeLinks.length);
    expect(cards).toHaveLength(unsafeLinks.length);

    for (const slot of [...tables, ...cards]) {
      expect(within(slot).queryByRole("link")).toBeNull();
      expect(within(slot).queryByText("Open")).toBeNull();
      expect(within(slot).getAllByText("Unavailable").length).toBeGreaterThanOrEqual(1);
    }

    for (const unsafe of unsafeLinks) {
      if (unsafe.length === 0) continue;
      expect(
        container.querySelector(`a[href="${CSS.escape(unsafe)}"]`),
      ).toBeNull();
    }
  });
});

describe("Inspect layout — phase collapse (Feature 04 Task 1)", () => {
  it("Fetched with articles starts collapsed — trigger shows count; list not visible", () => {
    const result: PhaseLoadResult<FetchCheckpoint> = {
      status: "loaded",
      data: {
        articles: [
          basicArticle({
            title: "Collapsed Article",
            link: "https://example.com/collapsed",
          }),
        ],
      },
    };

    const { container } = render(<InspectFetchedSection result={result} />);
    const section = container.querySelector(
      'section[aria-label="Fetched"]',
    ) as HTMLElement;
    expect(section).not.toBeNull();

    const trigger = within(section).getByRole("button", {
      name: /Fetched \(1\)/,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Fetched (1)");

    expect(within(section).queryByText("Collapsed Article")).not.toBeInTheDocument();
    expect(section.querySelector('[data-slot="domain-list-table"]')).toBeNull();
    expect(section.querySelector('[data-slot="domain-list-cards"]')).toBeNull();
  });

  it("expanding Fetched reveals the article list", () => {
    const result: PhaseLoadResult<FetchCheckpoint> = {
      status: "loaded",
      data: {
        articles: [
          basicArticle({
            title: "Expanded Article",
            link: "https://example.com/expanded",
          }),
        ],
      },
    };

    const { container } = render(<InspectFetchedSection result={result} />);
    expandInspectSection(container, "Fetched");

    const section = container.querySelector(
      'section[aria-label="Fetched"]',
    ) as HTMLElement;
    // Table + cards dual render — scope to avoid getByText ambiguity
    expect(within(section).getAllByText("Expanded Article").length).toBeGreaterThanOrEqual(1);
    expect(section.querySelector('[data-slot="domain-list-table"]')).not.toBeNull();
    expect(section.querySelector('[data-slot="domain-list-cards"]')).not.toBeNull();
  });

  it("independent open — Fetched and Scored can both stay expanded", () => {
    const fetchResult: PhaseLoadResult<FetchCheckpoint> = {
      status: "loaded",
      data: {
        articles: [
          basicArticle({
            title: "Fetched Independent",
            link: "https://example.com/fetch-ind",
          }),
        ],
      },
    };
    const scoredResult: PhaseLoadResult<ScoreCheckpoint> = {
      status: "loaded",
      data: {
        scoredArticles: [
          scoredArticle({
            title: "Scored Independent",
            link: "https://example.com/score-ind",
            score: 0.6,
          }),
        ],
      },
    };

    const { container } = render(
      <>
        <InspectFetchedSection result={fetchResult} />
        <InspectScoredSection result={scoredResult} />
      </>,
    );

    expandInspectSection(container, "Fetched");
    expandInspectSection(container, "Scored");

    const fetchedSection = container.querySelector(
      'section[aria-label="Fetched"]',
    ) as HTMLElement;
    const scoredSection = container.querySelector(
      'section[aria-label="Scored"]',
    ) as HTMLElement;

    expect(
      within(fetchedSection).getAllByText("Fetched Independent").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      within(scoredSection).getAllByText("Scored Independent").length,
    ).toBeGreaterThanOrEqual(1);
  });
});
