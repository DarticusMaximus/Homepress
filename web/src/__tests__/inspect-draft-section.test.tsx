/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type {
  CheckpointSelectedArticle,
  DraftCheckpointPayload,
  SelectionCheckpoint,
} from "@newsletter/shared";
import {
  DRAFT_EMPTY_AFTER_RETRY,
  DRAFT_EMPTY_GENERIC,
  DRAFT_EMPTY_NO_ARTICLES,
  InspectDraftSection,
} from "@/components/runs/inspect-draft-section";
import {
  PHASE_ERROR_COPY,
  PHASE_MISSING_COPY,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";

afterEach(() => {
  cleanup();
});

const PUBLISHED = new Date("2026-03-15T14:30:00.000Z");

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

function draftPayload(
  overrides: Partial<DraftCheckpointPayload> = {},
): DraftCheckpointPayload {
  return {
    markdown: "# Weekly Roundup\n\nHello from the draft.",
    empty: false,
    reason: null,
    articleCount: 3,
    attempts: 1,
    ...overrides,
  };
}

function selectionLoaded(
  articles: CheckpointSelectedArticle[],
): PhaseLoadResult<SelectionCheckpoint> {
  return {
    status: "loaded",
    data: { selectedArticles: articles, failures: [] },
  };
}

function draftLoaded(
  payload: DraftCheckpointPayload,
): PhaseLoadResult<DraftCheckpointPayload> {
  return { status: "loaded", data: payload };
}

describe("InspectDraftSection (Feature 07 Task 2)", () => {
  it("item 2: happy path — selected titles + rendered markdown", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([
          selectedArticle({ title: "Alpha pick", score: 0.9 }),
          selectedArticle({
            title: "Beta pick",
            score: 0.7,
            link: "https://example.com/beta",
          }),
        ])}
        draft={draftLoaded(draftPayload())}
      />,
    );

    expect(container).toHaveTextContent("Draft");
    expect(container).toHaveTextContent("Alpha pick");
    expect(container).toHaveTextContent("Beta pick");
    expect(container).toHaveTextContent("Weekly Roundup");
    expect(container).toHaveTextContent("Hello from the draft.");
    expect(container).not.toHaveTextContent("SECRET_FULL_CONTENT_SHOULD_NOT_RENDER");

    const heading = within(container).getByRole("heading", {
      level: 1,
      name: "Weekly Roundup",
    });
    expect(heading).toBeInTheDocument();
  });

  it("item 3: stack layout mounts both pane data-slots", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle()])}
        draft={draftLoaded(draftPayload())}
      />,
    );

    expect(
      container.querySelector('[data-slot="inspect-draft-selected"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="inspect-draft-output"]'),
    ).not.toBeNull();
  });

  it("Feature 04: selected inputs precede draft output; no lg:grid-cols-2 stack", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle({ title: "Stack selected" })])}
        draft={draftLoaded(
          draftPayload({ markdown: "# Stack draft\n\nOutput body." }),
        )}
      />,
    );

    const selectedPane = container.querySelector(
      '[data-slot="inspect-draft-selected"]',
    );
    const outputPane = container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );
    expect(selectedPane).not.toBeNull();
    expect(outputPane).not.toBeNull();

    const order = selectedPane!.compareDocumentPosition(outputPane!);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const panesParent = selectedPane!.parentElement;
    expect(panesParent).not.toBeNull();
    expect(panesParent!.className).not.toMatch(/lg:grid-cols-2/);
  });

  it("item 4: draft missing + selection present → selected rows above; output missing copy", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([
          selectedArticle({ title: "Still selected" }),
        ])}
        draft={{ status: "missing" }}
      />,
    );

    const selectedPane = container.querySelector(
      '[data-slot="inspect-draft-selected"]',
    );
    const outputPane = container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );
    expect(selectedPane).not.toBeNull();
    expect(outputPane).not.toBeNull();

    expect(selectedPane).toHaveTextContent("Still selected");
    expect(selectedPane).toHaveTextContent("Selected inputs (1)");
    expect(outputPane).toHaveTextContent(PHASE_MISSING_COPY);
    expect(container).toHaveTextContent("Draft");
    expect(container).not.toHaveTextContent("Articles fed:");
  });

  it("item 5: selection missing + draft present → selected missing above; output markdown", () => {
    const { container } = render(
      <InspectDraftSection
        selection={{ status: "missing" }}
        draft={draftLoaded(
          draftPayload({ markdown: "## Only draft side\n\nBody text." }),
        )}
      />,
    );

    const selectedPane = container.querySelector(
      '[data-slot="inspect-draft-selected"]',
    );
    const outputPane = container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );

    expect(selectedPane).toHaveTextContent(PHASE_MISSING_COPY);
    expect(selectedPane).toHaveTextContent("Selected inputs");
    expect(selectedPane).not.toHaveTextContent("Selected inputs (");
    expect(outputPane).toHaveTextContent("Only draft side");
    expect(outputPane).toHaveTextContent("Body text.");
  });

  it("item 6: empty draft reasons show locked strings (not markdown body)", () => {
    const noArticles = render(
      <InspectDraftSection
        selection={selectionLoaded([])}
        draft={draftLoaded(
          draftPayload({
            empty: true,
            reason: "no-articles",
            markdown: "# Should not render as heading",
            articleCount: 0,
            attempts: 0,
          }),
        )}
      />,
    );
    const noArticlesOutput = noArticles.container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );
    expect(noArticlesOutput).toHaveTextContent(DRAFT_EMPTY_NO_ARTICLES);
    expect(noArticlesOutput).not.toHaveTextContent("Should not render as heading");
    noArticles.unmount();

    const afterRetry = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle()])}
        draft={draftLoaded(
          draftPayload({
            empty: true,
            reason: "empty-after-retry",
            markdown: "raw leftover",
            attempts: 2,
          }),
        )}
      />,
    );
    const afterRetryOutput = afterRetry.container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );
    expect(afterRetryOutput).toHaveTextContent(DRAFT_EMPTY_AFTER_RETRY);
    expect(afterRetryOutput).not.toHaveTextContent("raw leftover");
    afterRetry.unmount();

    const generic = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle()])}
        draft={draftLoaded(
          draftPayload({
            empty: true,
            reason: null,
            markdown: "ignored",
          }),
        )}
      />,
    );
    const genericOutput = generic.container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );
    expect(genericOutput).toHaveTextContent(DRAFT_EMPTY_GENERIC);
    expect(genericOutput).not.toHaveTextContent("ignored");
  });

  it("item 7: draft load error → Couldn’t load; selection still renders", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([
          selectedArticle({ title: "Survives draft error" }),
        ])}
        draft={{ status: "error" }}
      />,
    );

    const selectedPane = container.querySelector(
      '[data-slot="inspect-draft-selected"]',
    );
    const outputPane = container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );

    expect(selectedPane).toHaveTextContent("Survives draft error");
    expect(outputPane).toHaveTextContent(PHASE_ERROR_COPY);
    expect(outputPane?.querySelector('[role="alert"]')).not.toBeNull();
    expect(container).not.toHaveTextContent("Articles fed:");
    // Never surface an error .message
    expect(container).not.toHaveTextContent("appwrite");
  });

  it("item 8: meta line shows Articles fed / Attempts from fixture", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle()])}
        draft={draftLoaded(
          draftPayload({ articleCount: 7, attempts: 2 }),
        )}
      />,
    );

    expect(container).toHaveTextContent("Articles fed: 7 · Attempts: 2");
  });

  it("item 9: Selected inputs with rows mounts domain-list-table and domain-list-cards", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle({ title: "Listed" })])}
        draft={draftLoaded(draftPayload())}
      />,
    );

    const selectedPane = container.querySelector(
      '[data-slot="inspect-draft-selected"]',
    );
    expect(selectedPane).not.toBeNull();
    expect(
      selectedPane!.querySelector('[data-slot="domain-list-table"]'),
    ).not.toBeNull();
    expect(
      selectedPane!.querySelector('[data-slot="domain-list-cards"]'),
    ).not.toBeNull();
    expect(selectedPane).toHaveTextContent("Listed");
    expect(selectedPane).toHaveTextContent("Title");
    expect(selectedPane).toHaveTextContent("Score");
    expect(selectedPane).toHaveTextContent("Source");
    expect(selectedPane).toHaveTextContent("Tags");
    expect(selectedPane).toHaveTextContent("Published");
    expect(selectedPane).toHaveTextContent("Link");
  });

  it("item 10: no edit creep — no contenteditable / save / edit controls", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle()])}
        draft={draftLoaded(draftPayload())}
      />,
    );

    expect(container.querySelector("[contenteditable]")).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(
      within(container).queryByRole("button", { name: /save|edit/i }),
    ).toBeNull();
    expect(container).not.toHaveTextContent(/save draft/i);
    expect(container).not.toHaveTextContent(/edit draft/i);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("selection error shows locked alert; draft pane still renders independently", () => {
    const { container } = render(
      <InspectDraftSection
        selection={{ status: "error" }}
        draft={draftLoaded(draftPayload({ markdown: "# Independent draft" }))}
      />,
    );

    const selectedPane = container.querySelector(
      '[data-slot="inspect-draft-selected"]',
    );
    const outputPane = container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );

    expect(selectedPane).toHaveTextContent(PHASE_ERROR_COPY);
    expect(outputPane).toHaveTextContent("Independent draft");
  });

  it("loaded empty:false with blank markdown still mounts IssueMarkdown", () => {
    const { container } = render(
      <InspectDraftSection
        selection={selectionLoaded([selectedArticle()])}
        draft={draftLoaded(draftPayload({ markdown: "", empty: false }))}
      />,
    );

    const outputPane = container.querySelector(
      '[data-slot="inspect-draft-output"]',
    );
    expect(outputPane?.querySelector(".prose")).not.toBeNull();
    expect(outputPane).not.toHaveTextContent(DRAFT_EMPTY_GENERIC);
  });
});
