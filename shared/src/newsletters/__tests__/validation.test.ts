import { describe, it, expect } from "vitest";

import {
  DEFAULT_LOOKBACK,
  LOOKBACK_MAX,
  LOOKBACK_MIN,
  type NewsletterDateRange,
} from "../../schema/declarations";
import { NewsletterRepositoryError } from "../types";
import {
  parseChipJsonField,
  resolveCreateFields,
  resolveUpdateFields,
  validateAudience,
  validateChipList,
  validateDateRange,
  validateLookback,
  validateNewsItems,
  validateNewsletterName,
} from "../validation";

function expectValidationError(fn: () => unknown): NewsletterRepositoryError {
  try {
    fn();
    throw new Error("Expected NewsletterRepositoryError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(NewsletterRepositoryError);
    const repoErr = err as NewsletterRepositoryError;
    expect(repoErr.code).toBe("validation");
    return repoErr;
  }
}

describe("validateNewsletterName", () => {
  it("accepts a non-empty name within the 255-char limit", () => {
    const name = "a".repeat(255);
    expect(validateNewsletterName(name)).toBe(name);
  });

  it("trims leading and trailing whitespace", () => {
    expect(validateNewsletterName("  Weekly Digest  ")).toBe("Weekly Digest");
  });

  it("rejects empty string", () => {
    expectValidationError(() => validateNewsletterName(""));
  });

  it("rejects whitespace-only name", () => {
    expectValidationError(() => validateNewsletterName("   \t  "));
  });

  it("rejects names longer than 255 characters after trim", () => {
    expectValidationError(() => validateNewsletterName("a".repeat(256)));
  });

  it.each([
    ["forward slash", "bad/name"],
    ["backslash", "bad\\name"],
    ["traversal ..", "bad..name"],
    ["traversal path", "a/../b"],
    ["null byte", "bad\0name"],
  ])("rejects name containing %s", (_label, name) => {
    expectValidationError(() => validateNewsletterName(name));
  });

  it("allows a normal dotted name without traversal", () => {
    expect(validateNewsletterName("Issue 12.5")).toBe("Issue 12.5");
  });
});

describe("validateAudience", () => {
  it("accepts an audience within the 2000-char limit", () => {
    const audience = "x".repeat(2000);
    expect(validateAudience(audience)).toBe(audience);
  });

  it("trims leading and trailing whitespace", () => {
    expect(validateAudience("  operators in fintech  ")).toBe("operators in fintech");
  });

  it("returns empty string for undefined, empty, or whitespace-only audience", () => {
    expect(validateAudience(undefined)).toBe("");
    expect(validateAudience("")).toBe("");
    expect(validateAudience("   ")).toBe("");
  });

  it("rejects audience longer than 2000 characters after trim", () => {
    expectValidationError(() => validateAudience("x".repeat(2001)));
  });
});

describe("validateChipList", () => {
  it("accepts a valid list and trims each element", () => {
    expect(validateChipList(["  AI  ", "ML"], "topics")).toEqual(["AI", "ML"]);
  });

  it("preserves insertion order", () => {
    expect(validateChipList(["ML", "AI", "Cloud"], "topics")).toEqual(["ML", "AI", "Cloud"]);
  });

  it("allows an empty array", () => {
    expect(validateChipList([], "topics")).toEqual([]);
  });

  it("rejects an empty/whitespace-only chip after trim", () => {
    expectValidationError(() => validateChipList(["AI", "   "], "topics"));
    expectValidationError(() => validateChipList([""], "disliked topics"));
  });

  it("rejects a chip longer than 128 characters after trim", () => {
    expectValidationError(() => validateChipList(["a".repeat(129)], "topics"));
    expect(validateChipList(["a".repeat(128)], "topics")).toEqual(["a".repeat(128)]);
  });

  it("dedupes case-sensitive within a list preserving first-occurrence order", () => {
    expect(validateChipList(["AI", "AI", "ai", "ML", "AI"], "topics")).toEqual(["AI", "ai", "ML"]);
  });

  it("rejects more than 50 chips", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `t${i}`);
    expect(validateChipList(fifty, "topics")).toHaveLength(50);
    expectValidationError(() => validateChipList([...fifty, "extra"], "topics"));
  });

  it("uses the field name in the validation error", () => {
    const err = expectValidationError(() => validateChipList([""], "disliked topics"));
    expect(err.message.toLowerCase()).toContain("disliked");
  });
});

describe("validateNewsItems", () => {
  it.each([1, 16, 50, 100])("accepts integer %i in 1..100", (value) => {
    expect(validateNewsItems(value)).toBe(value);
  });

  it.each([0, 101, -1])("rejects out-of-range integer %i", (value) => {
    expectValidationError(() => validateNewsItems(value));
  });

  it.each([1.5, 2.9, 99.5])("rejects non-integer %f", (value) => {
    expectValidationError(() => validateNewsItems(value));
  });

  it("rejects NaN", () => {
    expectValidationError(() => validateNewsItems(NaN));
  });
});

describe("lookback constants", () => {
  it("exports DEFAULT_LOOKBACK=3, LOOKBACK_MIN=0, LOOKBACK_MAX=10", () => {
    expect(DEFAULT_LOOKBACK).toBe(3);
    expect(LOOKBACK_MIN).toBe(0);
    expect(LOOKBACK_MAX).toBe(10);
  });
});

describe("validateLookback", () => {
  it.each([0, 1, 5, 10])("accepts integer %i in 0..10 inclusive", (value) => {
    expect(validateLookback(value)).toBe(value);
  });

  it.each([-1, 11])("rejects out-of-range integer %i", (value) => {
    const err = expectValidationError(() => validateLookback(value));
    expect(err.message).toBe("Lookback must be an integer between 0 and 10");
  });

  it.each([1.5, 2.9, 9.5])("rejects non-integer %f", (value) => {
    expectValidationError(() => validateLookback(value));
  });

  it("rejects NaN", () => {
    expectValidationError(() => validateLookback(NaN));
  });

  it("rejects non-finite values (Infinity / -Infinity)", () => {
    expectValidationError(() => validateLookback(Infinity));
    expectValidationError(() => validateLookback(-Infinity));
  });
});

describe("validateDateRange", () => {
  it.each(["yesterday", "last_3_days", "last_week", "all"] as const)(
    "accepts known value %s",
    (value) => {
      expect(validateDateRange(value)).toBe(value);
    },
  );

  it.each(["tomorrow", "", "last_weeks", "YESTERDAY"])("rejects unknown value %j", (value) => {
    expectValidationError(() => validateDateRange(value as NewsletterDateRange));
  });
});

describe("parseChipJsonField", () => {
  it('accepts "[]" → empty array', () => {
    expect(parseChipJsonField("topics", "[]")).toEqual([]);
  });

  it('accepts ["AI"]', () => {
    expect(parseChipJsonField("topics", '["AI"]')).toEqual(["AI"]);
  });

  it("accepts a multi-element string array (untrimmed — chip validation trims later)", () => {
    expect(parseChipJsonField("topics", '["  AI  ", "ML"]')).toEqual(["  AI  ", "ML"]);
  });

  it.each([
    ["invalid JSON", "{"],
    ["invalid JSON trailing", '["AI"'],
    ["non-array object", "{}"],
    ["non-array string", '"x"'],
    ["non-array number", "42"],
    ["non-array null", "null"],
  ])("rejects %s with validation code", (_label, raw) => {
    expectValidationError(() => parseChipJsonField("topics", raw));
  });

  it.each([
    ["number element", "[1]"],
    ["null element", "[null]"],
    ["boolean element", "[true]"],
    ["object element", '[{"a":1}]'],
    ["mixed with non-string", '["AI", 2]'],
  ])("rejects array with %s with validation code", (_label, raw) => {
    expectValidationError(() => parseChipJsonField("topics", raw));
  });

  it("includes the field name in the error message", () => {
    const err = expectValidationError(() => parseChipJsonField("disliked topics", "{"));
    expect(err.message.toLowerCase()).toContain("disliked");
    expect(err.message.toLowerCase()).toContain("payload");
  });

  describe("missing field handling", () => {
    it("create mode (default): missing/blank raw → empty array", () => {
      expect(parseChipJsonField("topics", null)).toEqual([]);
      expect(parseChipJsonField("topics", undefined)).toEqual([]);
      expect(parseChipJsonField("topics", "")).toEqual([]);
    });

    it("update mode (required): missing/blank raw → validation error", () => {
      expectValidationError(() => parseChipJsonField("topics", null, { required: true }));
      expectValidationError(() =>
        parseChipJsonField("disliked topics", undefined, { required: true }),
      );
      expectValidationError(() => parseChipJsonField("topics", "", { required: true }));
    });
  });
});

describe("resolveCreateFields", () => {
  it("applies create defaults: omitted newsItems → 16, omitted dateRange → yesterday", () => {
    const resolved = resolveCreateFields({ name: "Daily Brief" });
    expect(resolved.newsItems).toBe(16);
    expect(resolved.dateRange).toBe("yesterday");
  });

  it("defaults omitted topics/dislikedTopics to empty arrays and audience to empty string", () => {
    const resolved = resolveCreateFields({ name: "Daily Brief" });
    expect(resolved.topics).toEqual([]);
    expect(resolved.dislikedTopics).toEqual([]);
    expect(resolved.audience).toBe("");
  });

  it("trims name/audience and validates provided chips", () => {
    const resolved = resolveCreateFields({
      name: "  Daily Brief  ",
      topics: ["  AI  ", "AI", "ML"],
      dislikedTopics: ["  "],
      audience: "  fintech ops  ",
      newsItems: 25,
      dateRange: "last_week",
    });
    expect(resolved.name).toBe("Daily Brief");
    expect(resolved.topics).toEqual(["AI", "ML"]);
    expect(resolved.dislikedTopics).toEqual([]);
    expect(resolved.audience).toBe("fintech ops");
    expect(resolved.newsItems).toBe(25);
    expect(resolved.dateRange).toBe("last_week");
  });

  it("rejects an invalid name through the create resolver", () => {
    expectValidationError(() => resolveCreateFields({ name: "  " }));
    expectValidationError(() => resolveCreateFields({ name: "bad/name" }));
  });

  it("rejects out-of-range newsItems through the create resolver", () => {
    expectValidationError(() => resolveCreateFields({ name: "x", newsItems: 101 }));
  });

  it("rejects unknown dateRange through the create resolver", () => {
    expectValidationError(() =>
      resolveCreateFields({ name: "x", dateRange: "tomorrow" as NewsletterDateRange }),
    );
  });

  it("resolves omitted lookback to DEFAULT_LOOKBACK (3)", () => {
    const resolved = resolveCreateFields({ name: "Daily Brief" });
    expect(resolved.lookback).toBe(3);
    expect(resolved.lookback).toBe(DEFAULT_LOOKBACK);
  });

  it("validates a provided lookback through the create resolver", () => {
    expect(resolveCreateFields({ name: "x", lookback: 0 }).lookback).toBe(0);
    expect(resolveCreateFields({ name: "x", lookback: 7 }).lookback).toBe(7);
  });

  it("rejects out-of-range lookback through the create resolver", () => {
    expectValidationError(() => resolveCreateFields({ name: "x", lookback: 11 }));
    expectValidationError(() => resolveCreateFields({ name: "x", lookback: -1 }));
  });

  it("defaults omitted model override fields to empty strings", () => {
    const resolved = resolveCreateFields({ name: "Daily Brief" });
    expect(resolved.taggerModel).toBe("");
    expect(resolved.scorerModel).toBe("");
    expect(resolved.drafterModel).toBe("");
    expect(resolved.embedderModel).toBe("");
    expect(resolved.titleDekModel).toBe("");
  });

  // Feature 03 Task 1 — item 14
  it("defaults omitted drafterPrompt to empty string on create", () => {
    const resolved = resolveCreateFields({ name: "Daily Brief" });
    expect(resolved.drafterPrompt).toBe("");
  });

  it("coerces whitespace-only model overrides to empty strings", () => {
    const resolved = resolveCreateFields({
      name: "Daily Brief",
      taggerModel: "  ",
      scorerModel: "\t",
      drafterModel: " \n ",
      embedderModel: "   ",
      titleDekModel: "  ",
    });
    expect(resolved.taggerModel).toBe("");
    expect(resolved.scorerModel).toBe("");
    expect(resolved.drafterModel).toBe("");
    expect(resolved.embedderModel).toBe("");
    expect(resolved.titleDekModel).toBe("");
  });

  it("accepts valid author/slug and author/slug:free model overrides", () => {
    const free = "meta-llama/llama-3.2-3b-instruct:free";
    const resolved = resolveCreateFields({
      name: "Daily Brief",
      taggerModel: "  openai/gpt-4o-mini  ",
      scorerModel: free,
      drafterModel: "google/gemini-2.0-flash",
      embedderModel: "openai/text-embedding-3-small",
      titleDekModel: "  nvidia/nemotron-3-nano-30b-a3b  ",
    });
    expect(resolved.taggerModel).toBe("openai/gpt-4o-mini");
    expect(resolved.scorerModel).toBe(free);
    expect(resolved.drafterModel).toBe("google/gemini-2.0-flash");
    expect(resolved.embedderModel).toBe("openai/text-embedding-3-small");
    expect(resolved.titleDekModel).toBe("nvidia/nemotron-3-nano-30b-a3b");
  });

  it.each([
    ["tagger", { taggerModel: "gpt-4o-mini" }, /tagger/i],
    ["scorer", { scorerModel: "provider/" + "a".repeat(250) }, /scorer/i],
    ["drafter", { drafterModel: "foo/bar baz" }, /drafter/i],
    ["embedder", { embedderModel: "foo/bar\0baz" }, /embedder/i],
    ["titleDek", { titleDekModel: "not-a-valid-id" }, /titleDek/i],
    ["NEL (U+0085)", { taggerModel: "foo/bar\u0085baz" }, /tagger/i],
    ["PAD (U+0080)", { taggerModel: "foo/bar\u0080baz" }, /tagger/i],
    ["ZWSP (U+200B)", { taggerModel: "foo/bar\u200Bbaz" }, /tagger/i],
    ["ZWNJ (U+200C)", { taggerModel: "foo/bar\u200Cbaz" }, /tagger/i],
    ["ZWJ (U+200D)", { taggerModel: "foo/bar\u200Dbaz" }, /tagger/i],
  ] as const)(
    "rejects invalid %s model override naming the role",
    (_role, override, rolePattern) => {
      const err = expectValidationError(() =>
        resolveCreateFields({ name: "Daily Brief", ...override }),
      );
      expect(err.message).toMatch(rolePattern);
    },
  );

  it("rejects the whole create resolve when one model field is invalid", () => {
    expectValidationError(() =>
      resolveCreateFields({
        name: "Daily Brief",
        topics: ["AI"],
        newsItems: 20,
        dateRange: "last_week",
        lookback: 2,
        taggerModel: "openai/gpt-4o-mini",
        scorerModel: "not-a-valid-id",
        drafterModel: "google/gemini-2.0-flash",
        embedderModel: "",
        titleDekModel: "",
      }),
    );
  });
});

describe("resolveUpdateFields", () => {
  const validUpdate = {
    name: "Weekly Digest",
    topics: ["AI"],
    dislikedTopics: ["Crypto"],
    audience: "operators",
    newsItems: 20,
    dateRange: "last_3_days" as NewsletterDateRange,
    lookback: 3,
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    titleDekModel: "",
    drafterPrompt: "",
  };

  it("validates and returns the full field set", () => {
    const resolved = resolveUpdateFields(validUpdate);
    expect(resolved).toMatchObject({
      name: "Weekly Digest",
      topics: ["AI"],
      dislikedTopics: ["Crypto"],
      audience: "operators",
      newsItems: 20,
      dateRange: "last_3_days",
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
      titleDekModel: "",
    });
  });

  it("writes empty arrays and empty audience as-is (no defaulting on update)", () => {
    const resolved = resolveUpdateFields({
      ...validUpdate,
      topics: [],
      dislikedTopics: [],
      audience: "",
    });
    expect(resolved.topics).toEqual([]);
    expect(resolved.dislikedTopics).toEqual([]);
    expect(resolved.audience).toBe("");
  });

  it("rejects invalid fields through the update resolver", () => {
    expectValidationError(() => resolveUpdateFields({ ...validUpdate, name: "bad\\name" }));
    expectValidationError(() => resolveUpdateFields({ ...validUpdate, newsItems: 0 }));
    expectValidationError(() =>
      resolveUpdateFields({ ...validUpdate, dateRange: "never" as NewsletterDateRange }),
    );
  });

  it("validates and returns the submitted lookback", () => {
    const resolved = resolveUpdateFields({ ...validUpdate, lookback: 4 });
    expect(resolved.lookback).toBe(4);
  });

  it("rejects out-of-range lookback through the update resolver", () => {
    expectValidationError(() => resolveUpdateFields({ ...validUpdate, lookback: 11 }));
  });

  it("accepts and trims non-empty model overrides on update", () => {
    const resolved = resolveUpdateFields({
      ...validUpdate,
      taggerModel: "  anthropic/claude-3.5-sonnet  ",
      scorerModel: "openai/gpt-4o-mini",
      drafterModel: "meta-llama/llama-3.2-3b-instruct:free",
      embedderModel: "",
      titleDekModel: "vendor/title-dek",
    });
    expect(resolved.taggerModel).toBe("anthropic/claude-3.5-sonnet");
    expect(resolved.scorerModel).toBe("openai/gpt-4o-mini");
    expect(resolved.drafterModel).toBe("meta-llama/llama-3.2-3b-instruct:free");
    expect(resolved.embedderModel).toBe("");
    expect(resolved.titleDekModel).toBe("vendor/title-dek");
  });

  it("rejects invalid model overrides on update naming the role", () => {
    const err = expectValidationError(() =>
      resolveUpdateFields({ ...validUpdate, taggerModel: "no-slash-id" }),
    );
    expect(err.message).toMatch(/tagger/i);
  });

  it.each([
    ["NEL (U+0085)", "foo/bar\u0085baz"],
    ["PAD (U+0080)", "foo/bar\u0080baz"],
    ["ZWSP (U+200B)", "foo/bar\u200Bbaz"],
    ["ZWNJ (U+200C)", "foo/bar\u200Cbaz"],
    ["ZWJ (U+200D)", "foo/bar\u200Dbaz"],
  ])("rejects invisible character %s model override naming the role", (_label, bad) => {
    const err = expectValidationError(() =>
      resolveUpdateFields({ ...validUpdate, taggerModel: bad }),
    );
    expect(err.message).toMatch(/tagger/i);
  });

  it("rejects the whole update resolve when one model field is invalid", () => {
    expectValidationError(() =>
      resolveUpdateFields({
        ...validUpdate,
        taggerModel: "openai/gpt-4o-mini",
        scorerModel: "foo bar/baz",
      }),
    );
  });

  it("rejects invalid titleDekModel on update naming the role", () => {
    const err = expectValidationError(() =>
      resolveUpdateFields({ ...validUpdate, titleDekModel: "no-slash-id" }),
    );
    expect(err.message).toMatch(/titleDek/i);
  });

  // Feature 03 Task 1 — items 12–13
  it("accepts a valid non-empty drafterPrompt override on update", () => {
    const body = 'Write for {newsletter_name}. Topics: {topics}. Count: {count}. Articles: {articles_json}.';
    const resolved = resolveUpdateFields({
      ...validUpdate,
      drafterPrompt: `  ${body}  `,
    });
    expect(resolved.drafterPrompt).toBe(body);
  });

  it("clears drafterPrompt to empty string when blank on update", () => {
    const resolved = resolveUpdateFields({
      ...validUpdate,
      drafterPrompt: "   ",
    });
    expect(resolved.drafterPrompt).toBe("");
  });

  it("rejects drafterPrompt missing required placeholders on update", () => {
    const err = expectValidationError(() =>
      resolveUpdateFields({
        ...validUpdate,
        drafterPrompt: 'Missing required placeholders only {topics} {count}',
      }),
    );
    expect(err.message).toMatch(/newsletter_name|placeholder|drafter/i);
  });

});
