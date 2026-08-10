import { describe, it, expect } from "vitest";

import {
  createArticle,
  createNewsletterConfig,
  isTaggedArticle,
  isScoredArticle,
  ValidationError,
} from "../types";
import type {
  Article,
  TaggedArticle,
  ScoredArticle,
  SelectedArticle,
  NewsletterConfig,
  FetchResult,
  TagResult,
  ScoreResult,
  SelectionResult,
  DraftResult,
} from "../types";

// ---------------------------------------------------------------------------
// Compile-time: structural progression of the article types.
// A ScoredArticle must be assignable to a TaggedArticle, which must be
// assignable to an Article. The reverse must NOT hold.
// ---------------------------------------------------------------------------

describe("type-level: article progression assignability", () => {
  it("ScoredArticle -> TaggedArticle -> Article (forward assignability)", () => {
    // These assignments must type-check. We wrap in a no-op function so the
    // assertions are exercised at compile time but produce no runtime work.
    const acceptArticle = (_a: Article): void => {};
    const acceptTagged = (_t: TaggedArticle): void => {};

    const scored: ScoredArticle = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
      tags: ["a"],
      score: 8,
    };
    const tagged: TaggedArticle = { ...scored, score: undefined } as never;

    acceptArticle(scored); // ScoredArticle -> Article
    acceptArticle(tagged); // TaggedArticle -> Article
    acceptTagged(scored); // ScoredArticle -> TaggedArticle
    expect(true).toBe(true);
  });

  it("Article is NOT assignable to TaggedArticle / ScoredArticle (negative cases)", () => {
    // @ts-expect-error — Article lacks tags
    const _asTagged: TaggedArticle = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
    };
    // @ts-expect-error — Article lacks tags and score
    const _asScored: ScoredArticle = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
    };
    expect(_asTagged).toBeDefined();
    expect(_asScored).toBeDefined();
  });

  it("SelectedArticle is assignable to ScoredArticle", () => {
    const acceptScored = (_s: ScoredArticle): void => {};
    const selected: SelectedArticle = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
      tags: ["a"],
      score: 9,
    };
    acceptScored(selected);
    expect(true).toBe(true);
  });

  it("concrete phase-result interfaces carry their pinned fields", () => {
    // Compile-time presence check — these literals must satisfy their shapes.
    const _fetch: FetchResult = { articles: [], failedFeeds: [], totalFeeds: 0 };
    // TagResult was pinned by feature 04 to a concrete interface with the tag
    // phase's exact fields (taggedArticles, failures, halted, haltReason,
    // consecutiveErrors, totalArticles).
    const _tag: TagResult = {
      taggedArticles: [],
      failures: [],
      halted: false,
      haltReason: null,
      consecutiveErrors: 0,
      totalArticles: 0,
    };
    // ScoreResult was pinned by feature 05 to a concrete interface with the score
    // phase's exact fields (scoredArticles, failures, halted, haltReason,
    // consecutiveErrors, totalArticles).
    const _score: ScoreResult = {
      scoredArticles: [],
      failures: [],
      halted: false,
      haltReason: null,
      consecutiveErrors: 0,
      totalArticles: 0,
    };
    const _selection: SelectionResult = {
      selectedArticles: [],
      failures: [],
      totalArticles: 0,
      candidateCount: 0,
      targetCount: 0,
      lambda: 0,
      minScore: 0,
    };
    const _draft: DraftResult = {
      markdown: "",
      articleCount: 0,
      empty: true,
      reason: null,
      attempts: 0,
    };
    expect(_fetch).toBeDefined();
    expect(_tag).toBeDefined();
    expect(_score).toBeDefined();
    expect(_selection).toBeDefined();
    expect(_draft).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createArticle
// ---------------------------------------------------------------------------

describe("createArticle", () => {
  it("produces an Article with all required fields", () => {
    const published = new Date("2026-06-30T00:00:00Z");
    const article = createArticle({
      title: "Hello",
      link: "https://example.com/a",
      published,
      content: "body",
      source: "feed-1",
    });

    expect(article).toEqual({
      title: "Hello",
      link: "https://example.com/a",
      published,
      content: "body",
      source: "feed-1",
    });
    expect(article.published).toBeInstanceOf(Date);
  });

  it("rejects when title is missing", () => {
    expect(() =>
      createArticle({
        link: "https://example.com/a",
        published: new Date(0),
        content: "c",
        source: "s",
      } as unknown as ConstructorParameters<typeof Object>[0]),
    ).toThrow();
  });

  it("rejects when link is missing", () => {
    expect(() =>
      createArticle({
        title: "Hello",
        published: new Date(0),
        content: "c",
        source: "s",
      } as unknown as ConstructorParameters<typeof Object>[0]),
    ).toThrow();
  });

  it("rejects when title is an empty string", () => {
    expect(() =>
      createArticle({
        title: "",
        link: "https://example.com/a",
        published: new Date(0),
        content: "c",
        source: "s",
      }),
    ).toThrow();
  });

  it("rejects when link is an empty string", () => {
    expect(() =>
      createArticle({
        title: "Hello",
        link: "",
        published: new Date(0),
        content: "c",
        source: "s",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createNewsletterConfig
// ---------------------------------------------------------------------------

describe("createNewsletterConfig", () => {
  it("fills defaults on a minimal valid config", () => {
    const cfg = createNewsletterConfig({
      name: "Daily",
      topics: ["ai"],
      feeds: ["https://example.com/feed.xml"],
    });

    const expected: NewsletterConfig = {
      name: "Daily",
      topics: ["ai"],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      feeds: ["https://example.com/feed.xml"],
      dateRange: "yesterday",
      interPhaseDelaySeconds: 3,
    };
    expect(cfg).toEqual(expected);
  });

  it("preserves explicitly-provided values instead of overwriting with defaults", () => {
    const cfg = createNewsletterConfig({
      name: "Weekly",
      topics: ["ai", "ml"],
      dislikedTopics: ["spam"],
      audience: "engineers",
      newsItems: 5,
      feeds: ["https://example.com/feed.xml"],
      dateRange: "last_week",
      interPhaseDelaySeconds: 10,
    });

    expect(cfg).toEqual({
      name: "Weekly",
      topics: ["ai", "ml"],
      dislikedTopics: ["spam"],
      audience: "engineers",
      newsItems: 5,
      feeds: ["https://example.com/feed.xml"],
      dateRange: "last_week",
      interPhaseDelaySeconds: 10,
    });
  });

  it("throws when feeds is empty", () => {
    expect(() =>
      createNewsletterConfig({
        name: "Daily",
        topics: ["ai"],
        feeds: [],
      }),
    ).toThrow();
  });

  it("throws when feeds is missing", () => {
    expect(() =>
      createNewsletterConfig({
        name: "Daily",
        topics: ["ai"],
      } as unknown as ConstructorParameters<typeof Object>[0]),
    ).toThrow();
  });

  it("throws when topics is empty", () => {
    expect(() =>
      createNewsletterConfig({
        name: "Daily",
        topics: [],
        feeds: ["https://example.com/feed.xml"],
      }),
    ).toThrow();
  });

  it("throws when topics is missing", () => {
    expect(() =>
      createNewsletterConfig({
        name: "Daily",
        feeds: ["https://example.com/feed.xml"],
      } as unknown as ConstructorParameters<typeof Object>[0]),
    ).toThrow();
  });

  // S4-20260630: name sanitization — reject path separators / traversal / null.
  // Pinned behavior: REJECT with ValidationError (do not sanitize to basename).
  describe("name sanitization (S4)", () => {
    const baseInput = {
      topics: ["ai"],
      feeds: ["https://example.com/feed.xml"],
    };

    it("rejects a name containing '..' (traversal) with ValidationError", () => {
      let caught: unknown;
      try {
        createNewsletterConfig({ name: "../../evil", ...baseInput });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as Error).message).toContain("name");
    });

    it("rejects a name containing '/' with ValidationError", () => {
      expect(() => createNewsletterConfig({ name: "sub/dir", ...baseInput })).toThrow(
        ValidationError,
      );
    });

    it("rejects a name containing '\\' with ValidationError", () => {
      expect(() => createNewsletterConfig({ name: "sub\\dir", ...baseInput })).toThrow(
        ValidationError,
      );
    });

    it("rejects a name containing a null byte with ValidationError", () => {
      expect(() => createNewsletterConfig({ name: "evil\0.txt", ...baseInput })).toThrow(
        ValidationError,
      );
    });

    it("rejects an empty name with ValidationError", () => {
      expect(() => createNewsletterConfig({ name: "", ...baseInput })).toThrow(ValidationError);
    });

    it("accepts a safe name without special characters", () => {
      const cfg = createNewsletterConfig({ name: "Daily-AI_2026", ...baseInput });
      expect(cfg.name).toBe("Daily-AI_2026");
    });

    it("validation errors for empty topics/feeds are ValidationError instances", () => {
      expect(() => createNewsletterConfig({ name: "Daily", topics: [], feeds: ["x"] })).toThrow(
        ValidationError,
      );
      expect(() => createNewsletterConfig({ name: "Daily", topics: ["ai"], feeds: [] })).toThrow(
        ValidationError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("isTaggedArticle", () => {
  it("narrows an Article-shaped object that has tags: string[]", () => {
    const value: unknown = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
      tags: ["a", "b"],
    };
    expect(isTaggedArticle(value)).toBe(true);
    if (isTaggedArticle(value)) {
      // narrowing proof at compile time
      expect(value.tags).toEqual(["a", "b"]);
    }
  });

  it("rejects an object without tags", () => {
    const value: unknown = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
    };
    expect(isTaggedArticle(value)).toBe(false);
  });

  it("rejects when tags is not an array of strings", () => {
    expect(isTaggedArticle({ tags: "nope" })).toBe(false);
    expect(isTaggedArticle({ tags: [1, 2, 3] })).toBe(false);
  });
});

describe("isScoredArticle", () => {
  it("narrows a TaggedArticle-shaped object that has score: number", () => {
    const value: unknown = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
      tags: ["a"],
      score: 8.5,
    };
    expect(isScoredArticle(value)).toBe(true);
    if (isScoredArticle(value)) {
      expect(value.score).toBe(8.5);
    }
  });

  it("rejects an object without score", () => {
    const value: unknown = {
      title: "t",
      link: "l",
      published: new Date(0),
      content: "c",
      source: "s",
      tags: ["a"],
    };
    expect(isScoredArticle(value)).toBe(false);
  });

  it("rejects when score is not a number", () => {
    expect(isScoredArticle({ score: "8" })).toBe(false);
    expect(isScoredArticle({ score: NaN })).toBe(false);
  });
});
