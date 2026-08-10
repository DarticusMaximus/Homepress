import { describe, it, expect } from "vitest";
import {
  MODEL_COMPONENTS,
  normalizeModelIdInput,
  validateGlobalModelDefaults,
  mapModelFieldFromDocument,
} from "../model-defaults";
import { SettingsRepositoryError } from "../types";

describe("MODEL_COMPONENTS", () => {
  it("lists the four roles in stable order", () => {
    expect(MODEL_COMPONENTS).toEqual(["tagger", "scorer", "drafter", "embedder"]);
  });
});

describe("normalizeModelIdInput", () => {
  it("trims whitespace and maps empty to empty", () => {
    expect(normalizeModelIdInput("  openai/gpt-4o-mini  ")).toBe("openai/gpt-4o-mini");
    expect(normalizeModelIdInput("   ")).toBe("");
    expect(normalizeModelIdInput("")).toBe("");
  });
});

describe("mapModelFieldFromDocument", () => {
  it("maps missing null undefined non-string to empty string", () => {
    expect(mapModelFieldFromDocument(undefined)).toBe("");
    expect(mapModelFieldFromDocument(null)).toBe("");
    expect(mapModelFieldFromDocument(42)).toBe("");
    expect(mapModelFieldFromDocument("openai/gpt-4o-mini")).toBe("openai/gpt-4o-mini");
  });
});

describe("validateGlobalModelDefaults", () => {
  const valid = {
    taggerModel: "openai/gpt-4o-mini",
    scorerModel: "anthropic/claude-3.5-sonnet",
    drafterModel: "google/gemini-2.0-flash",
    embedderModel: "openai/text-embedding-3-small",
  };

  it("accepts valid ids and trims", () => {
    expect(
      validateGlobalModelDefaults({
        ...valid,
        taggerModel: "  openai/gpt-4o-mini  ",
      }),
    ).toEqual({ ...valid, taggerModel: "openai/gpt-4o-mini" });
  });

  it("accepts empty and whitespace-only as empty", () => {
    expect(
      validateGlobalModelDefaults({
        taggerModel: "",
        scorerModel: "  ",
        drafterModel: "\t",
        embedderModel: " \n ",
      }),
    ).toEqual({
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
    });
  });

  it("accepts :free suffix", () => {
    const free = "meta-llama/llama-3.2-3b-instruct:free";
    expect(
      validateGlobalModelDefaults({
        taggerModel: free,
        scorerModel: free,
        drafterModel: free,
        embedderModel: free,
      }),
    ).toEqual({
      taggerModel: free,
      scorerModel: free,
      drafterModel: free,
      embedderModel: free,
    });
  });

  it("rejects missing slash naming the role", () => {
    try {
      validateGlobalModelDefaults({ ...valid, taggerModel: "gpt-4o-mini" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SettingsRepositoryError);
      expect((err as SettingsRepositoryError).code).toBe("validation");
      expect((err as SettingsRepositoryError).message).toMatch(/tagger/i);
    }
  });

  it("rejects length over 256 naming the role", () => {
    const tooLong = `provider/${"a".repeat(250)}`;
    try {
      validateGlobalModelDefaults({ ...valid, scorerModel: tooLong });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SettingsRepositoryError);
      expect((err as SettingsRepositoryError).message).toMatch(/scorer/i);
    }
  });

  it("rejects internal whitespace", () => {
    expect(() =>
      validateGlobalModelDefaults({ ...valid, drafterModel: "foo/bar baz" }),
    ).toThrow(SettingsRepositoryError);
  });

  it.each([
    ["NEL (U+0085)", "foo/bar\u0085baz"],
    ["PAD (U+0080)", "foo/bar\u0080baz"],
    ["ZWSP (U+200B)", "foo/bar\u200Bbaz"],
    ["ZWNJ (U+200C)", "foo/bar\u200Cbaz"],
    ["ZWJ (U+200D)", "foo/bar\u200Dbaz"],
  ])("rejects invisible character %s", (_label, bad) => {
    expect(() => validateGlobalModelDefaults({ ...valid, taggerModel: bad })).toThrow(
      SettingsRepositoryError,
    );
  });
});
