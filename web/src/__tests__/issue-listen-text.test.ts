import { describe, it, expect } from "vitest";
import {
  toSpeakableText,
  packUtterances,
  ISSUE_LISTEN_WORD_BUDGET,
} from "@/lib/issue-listen-text";

describe("toSpeakableText", () => {
  it("keeps heading and emphasis text without markdown markers", () => {
    const result = toSpeakableText("# Hello **world**");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("#");
    expect(result).not.toContain("*");
  });

  it("preserves content underscores such as max_tokens", () => {
    const result = toSpeakableText("use max_tokens here");
    expect(result).toContain("max_tokens");
  });

  it("keeps a lone multiplication asterisk", () => {
    const result = toSpeakableText("2 * 3 is six.");
    expect(result).toContain("*");
  });

  it("speaks link labels and omits URLs", () => {
    const result = toSpeakableText("[OpenAI](https://openai.com/about)");
    expect(result).toContain("OpenAI");
    expect(result).not.toContain("openai.com");
    expect(result).not.toContain("https");
  });

  it("drops bare URLs while keeping surrounding prose", () => {
    const result = toSpeakableText("See https://example.com/path for more.");
    expect(result).not.toContain("https");
    expect(result).not.toContain("example.com");
    expect(result).toContain("See");
    expect(result).toContain("for more");
  });

  it("drops images entirely and keeps following text", () => {
    const result = toSpeakableText("![Chart](https://cdn.example/a.png)\n\nAfter");
    expect(result).not.toContain("https");
    expect(result).not.toContain("cdn.example");
    expect(result).toContain("After");
  });
});

describe("packUtterances", () => {
  it("exports the default word budget of 200", () => {
    expect(ISSUE_LISTEN_WORD_BUDGET).toBe(200);
  });

  it("packs two short sentences into one chunk under budget", () => {
    const text = "Alpha one. Bravo two.";
    const chunks = packUtterances(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Alpha one.");
    expect(chunks[0]).toContain("Bravo two.");
  });

  it("splits at the word budget without cutting mid-sentence", () => {
    // 180-word opener + a known 50-word sentence = 230 words > budget.
    // Naive word slicing at 200 would leave the known sentence mid-cut so a
    // later chunk would start with a lowercase continuation token (fillN).
    const firstSentence =
      Array.from({ length: 180 }, (_, i) => `lead${i}`).join(" ") + ".";
    const knownSentence =
      "KNOWN " +
      Array.from({ length: 48 }, (_, i) => `fill${i}`).join(" ") +
      " END.";
    const text = `${firstSentence} ${knownSentence}`;

    const chunks = packUtterances(text, ISSUE_LISTEN_WORD_BUDGET);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const startIdx = chunks.findIndex((c) => c.includes("KNOWN"));
    const endIdx = chunks.findIndex((c) => c.includes("END."));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBe(startIdx);
    expect(chunks[startIdx]!.trim()).toBe(knownSentence.trim());

    for (const chunk of chunks) {
      const firstWord = chunk.trim().split(/\s+/)[0]!;
      // Mid-sentence cut of the known sentence would start a chunk with fillN.
      expect(firstWord).not.toMatch(/^fill\d+$/);
    }
  });

  it("keeps an oversized single sentence as one chunk", () => {
    const words = Array.from({ length: 250 }, (_, i) => `word${i}`);
    const sentence = words.join(" ") + ".";
    const chunks = packUtterances(sentence);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.trim()).toBe(sentence.trim());
  });

  it("returns an empty array for empty text", () => {
    expect(packUtterances("")).toEqual([]);
  });
});
