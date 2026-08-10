import type { PromptRole } from "./types";

export const SHIPPED_TAGGER_PROMPT = `Role: Helpful assistant for SEO tag generation
Goal: Label content using general, broad tags
Rules:
- Avoid names of people or devices
- Use general tags to label topics
- Provide up to 10 tags, comma-separated
- Avoid similar tags (e.g., don't use both "AI" and "Machine Learning")

Title: {title}
Article: {truncated_content}

Output: CSV tags only`;

export const SHIPPED_SCORER_PROMPT = `Positive Topics: {topics}

Negative Topics: {disliked_topics}

Newsletter focus: {topics}

---
Article Tags: {tags}
Article Title: {title}

Analyze alignment with preferences. Score 0-10 (10 = best alignment).
Return ONLY the number.`;

export const SHIPPED_DRAFTER_PROMPT = `**Goal** Write a factual markdown newsletter draft for "{newsletter_name}".

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

export const SHIPPED_PROMPT_DEFAULTS: Record<PromptRole, string> = {
  tagger: SHIPPED_TAGGER_PROMPT,
  scorer: SHIPPED_SCORER_PROMPT,
  drafter: SHIPPED_DRAFTER_PROMPT,
};

export function getShippedPromptDefault(role: PromptRole): string {
  return SHIPPED_PROMPT_DEFAULTS[role];
}
