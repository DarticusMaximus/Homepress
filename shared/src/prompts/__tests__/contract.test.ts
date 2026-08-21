import { describe, it, expect } from "vitest";

import { validatePromptTemplate, renderPromptTemplate } from "../contract";
import {
  PROMPT_ROLES,
  PROMPT_REQUIRED_PLACEHOLDERS,
  PROMPT_ALLOWED_PLACEHOLDERS,
  type PromptRole,
} from "../types";
import {
  SHIPPED_TAGGER_PROMPT,
  SHIPPED_SCORER_PROMPT,
  SHIPPED_DRAFTER_PROMPT,
  SHIPPED_TITLE_PROMPT,
  SHIPPED_DEK_PROMPT,
  SHIPPED_PROMPT_DEFAULTS,
  getShippedPromptDefault,
} from "../defaults";

/** Pinned Stage 10 Feature 03 shipped drafter body — byte-identical equality only. */
export const PINNED_SHIPPED_DRAFTER_PROMPT = `**Goal** Write a factual markdown newsletter draft for "{newsletter_name}".

**Audience** {audience}
(If audience is empty, write for a general tech-curious reader.)

**Role** Clear technology writer. Prioritize: {topics}.

**Rules**
- Start with a single newsletter title as the first line: \`# <Title>\` (this is the issue title — make it specific to this issue’s contents, not just the newsletter name).
- Then write {count} items from the articles below (fewer only if the set is smaller).
- One featured item first (deeper), then shorter summaries for the rest.
- Plain, easy-to-understand English. Fact-based. Neutral tone.
- Include the source link under each item.
- Use Markdown (\`##\` for item headings after the title).
- No preamble before the \`#\` title. No closing sign-off.

**Articles (JSON)**

---

{articles_json}

---

Write the newsletter using the provided articles.`;

/** Pinned Stage 15 Feature 02 shipped title body — byte-identical equality only. */
export const PINNED_SHIPPED_TITLE_PROMPT = `Read the newsletter draft below for "{newsletter_name}".

Audience (context only — do not write clickbait, shock, or bait aimed at them): {audience}

Write an honest issue title of at most 8 words (about 60 characters). Name this digest as a whole, not the lead story.

Return only the title string. No commentary, no formatting, no quotes, no markdown, nothing else.

Draft:
{draft}`;

/** Pinned Stage 15 Feature 02 shipped dek body — byte-identical equality only. */
export const PINNED_SHIPPED_DEK_PROMPT = `Read the newsletter draft below for "{newsletter_name}".

Audience (context only — do not write clickbait, shock, or bait aimed at them): {audience}

Write an honest one- or two-sentence summary of at most 25 words (about 160 characters). Name this digest as a whole, not the lead story.

Return only the summary string. No commentary, no formatting, no quotes, no markdown, nothing else.

Draft:
{draft}`;

function minimalFixture(role: PromptRole): string {
  return PROMPT_REQUIRED_PLACEHOLDERS[role].map((name) => `{${name}}`).join(" ");
}

const SHIPPED_BY_ROLE: Record<PromptRole, string> = {
  tagger: SHIPPED_TAGGER_PROMPT,
  scorer: SHIPPED_SCORER_PROMPT,
  drafter: SHIPPED_DRAFTER_PROMPT,
  title: SHIPPED_TITLE_PROMPT,
  dek: SHIPPED_DEK_PROMPT,
};

describe("validatePromptTemplate", () => {
  it("passes each role's shipped default with empty warnings", () => {
    for (const role of PROMPT_ROLES) {
      const result = validatePromptTemplate(role, SHIPPED_BY_ROLE[role]);
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it("passes each role's minimal fixture with empty warnings", () => {
    for (const role of PROMPT_ROLES) {
      const result = validatePromptTemplate(role, minimalFixture(role));
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it("fails when a required placeholder is removed and lists that name", () => {
    for (const role of PROMPT_ROLES) {
      const required = PROMPT_REQUIRED_PLACEHOLDERS[role];
      const removed = required[0];
      const body = required
        .filter((name) => name !== removed)
        .map((name) => `{${name}}`)
        .join(" ");
      const result = validatePromptTemplate(role, body);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain(removed);
    }
  });

  it("passes with unknown {foo} and includes foo in warnings", () => {
    for (const role of PROMPT_ROLES) {
      const body = `${minimalFixture(role)} {foo}`;
      const result = validatePromptTemplate(role, body);
      expect(result.ok).toBe(true);
      expect(result.warnings).toContain("foo");
    }
  });

  it("rejects empty body", () => {
    for (const role of PROMPT_ROLES) {
      const result = validatePromptTemplate(role, "");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects whitespace-only body", () => {
    for (const role of PROMPT_ROLES) {
      const result = validatePromptTemplate(role, "   \n\t  ");
      expect(result.ok).toBe(false);
    }
  });

  // Feature 03 Task 1 — items 1–2
  it("drafter still requires the four original placeholders and passes without {audience}", () => {
    expect(PROMPT_REQUIRED_PLACEHOLDERS.drafter).toEqual([
      "newsletter_name",
      "topics",
      "articles_json",
      "count",
    ]);
    const withoutAudience = "{newsletter_name} {topics} {articles_json} {count}";
    const result = validatePromptTemplate("drafter", withoutAudience);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("drafter template with {audience} validates and does not warn (audience allowed)", () => {
    expect(PROMPT_ALLOWED_PLACEHOLDERS.drafter).toContain("audience");
    const withAudience =
      "{newsletter_name} {topics} {articles_json} {count} {audience}";
    const result = validatePromptTemplate("drafter", withAudience);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).not.toContain("audience");
    expect(result.warnings).toEqual([]);
  });

  // Stage 15 Feature 02 Task 1 — test 1
  it("PROMPT_ROLES is tagger, scorer, drafter, title, dek", () => {
    expect(PROMPT_ROLES).toEqual(["tagger", "scorer", "drafter", "title", "dek"]);
  });

  it("title and dek required/allowed maps match the pin (no articles_json)", () => {
    expect(PROMPT_REQUIRED_PLACEHOLDERS.title).toEqual(["draft", "newsletter_name"]);
    expect(PROMPT_REQUIRED_PLACEHOLDERS.dek).toEqual(["draft", "newsletter_name"]);
    expect(PROMPT_ALLOWED_PLACEHOLDERS.title).toEqual([
      "draft",
      "newsletter_name",
      "audience",
    ]);
    expect(PROMPT_ALLOWED_PLACEHOLDERS.dek).toEqual([
      "draft",
      "newsletter_name",
      "audience",
    ]);
    expect(PROMPT_ALLOWED_PLACEHOLDERS.title).not.toContain("articles_json");
    expect(PROMPT_ALLOWED_PLACEHOLDERS.dek).not.toContain("articles_json");
  });

  it("shipped title and dek validate ok with empty warnings", () => {
    for (const role of ["title", "dek"] as const) {
      const result = validatePromptTemplate(role, SHIPPED_BY_ROLE[role]);
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it("title and dek reject a body missing {draft}", () => {
    const withoutDraft = "{newsletter_name} {audience}";
    for (const role of ["title", "dek"] as const) {
      const result = validatePromptTemplate(role, withoutDraft);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("draft");
    }
  });

  it("title and dek unknown {foo} warns but allows save", () => {
    for (const role of ["title", "dek"] as const) {
      const body = `${minimalFixture(role)} {foo}`;
      const result = validatePromptTemplate(role, body);
      expect(result.ok).toBe(true);
      expect(result.warnings).toContain("foo");
    }
  });
});

describe("SHIPPED_DRAFTER_PROMPT pin (Feature 03)", () => {
  // Feature 03 Task 1 — items 3–4
  it("equals the pinned template body byte-for-byte", () => {
    expect(SHIPPED_DRAFTER_PROMPT).toBe(PINNED_SHIPPED_DRAFTER_PROMPT);
  });

  it("getShippedPromptDefault('drafter') returns the pinned body", () => {
    expect(getShippedPromptDefault("drafter")).toBe(PINNED_SHIPPED_DRAFTER_PROMPT);
  });
});

describe("SHIPPED_TITLE_PROMPT and SHIPPED_DEK_PROMPT pin (Feature 02)", () => {
  it("equals the pinned template bodies byte-for-byte", () => {
    expect(SHIPPED_TITLE_PROMPT).toBe(PINNED_SHIPPED_TITLE_PROMPT);
    expect(SHIPPED_DEK_PROMPT).toBe(PINNED_SHIPPED_DEK_PROMPT);
  });

  it("getShippedPromptDefault and SHIPPED_PROMPT_DEFAULTS include both", () => {
    expect(getShippedPromptDefault("title")).toBe(PINNED_SHIPPED_TITLE_PROMPT);
    expect(getShippedPromptDefault("dek")).toBe(PINNED_SHIPPED_DEK_PROMPT);
    expect(SHIPPED_PROMPT_DEFAULTS.title).toBe(PINNED_SHIPPED_TITLE_PROMPT);
    expect(SHIPPED_PROMPT_DEFAULTS.dek).toBe(PINNED_SHIPPED_DEK_PROMPT);
  });
});

describe("renderPromptTemplate", () => {
  it("replaces all occurrences of a repeated placeholder", () => {
    const body = "Focus: {topics}. Also: {topics}.";
    const rendered = renderPromptTemplate(body, { topics: "AI" });
    expect(rendered).toBe("Focus: AI. Also: AI.");
  });

  it("leaves unknown tokens unchanged", () => {
    const body = "Hello {name}, see {foo}.";
    const rendered = renderPromptTemplate(body, { name: "world" });
    expect(rendered).toBe("Hello world, see {foo}.");
  });
});
