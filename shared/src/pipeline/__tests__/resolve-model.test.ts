import { describe, it, expect } from "vitest";

import { DEFAULT_MODELS, type ModelComponent } from "../config";
import { resolveAllModelIds, resolveModelId } from "../resolve-model";

const ROLES: readonly ModelComponent[] = ["tagger", "scorer", "drafter", "embedder"];

describe("resolveModelId", () => {
  it("returns DEFAULT_MODELS[role] when all sources are empty", () => {
    for (const role of ROLES) {
      expect(resolveModelId(role, {})).toBe(DEFAULT_MODELS[role]);
      expect(
        resolveModelId(role, {
          newsletterOverride: null,
          globalDefault: undefined,
          envValue: "",
        }),
      ).toBe(DEFAULT_MODELS[role]);
      expect(
        resolveModelId(role, {
          newsletterOverride: "   ",
          globalDefault: "\t",
          envValue: null,
        }),
      ).toBe(DEFAULT_MODELS[role]);
    }
  });

  it("uses env when global and newsletter are empty", () => {
    expect(
      resolveModelId("tagger", {
        envValue: "env/tagger-model",
        globalDefault: "",
        newsletterOverride: null,
      }),
    ).toBe("env/tagger-model");
  });

  it("prefers global over env", () => {
    expect(
      resolveModelId("scorer", {
        globalDefault: "global/scorer-model",
        envValue: "env/scorer-model",
      }),
    ).toBe("global/scorer-model");
  });

  it("prefers newsletter over global and env", () => {
    expect(
      resolveModelId("drafter", {
        newsletterOverride: "newsletter/drafter-model",
        globalDefault: "global/drafter-model",
        envValue: "env/drafter-model",
      }),
    ).toBe("newsletter/drafter-model");
  });

  it("falls through whitespace-only newsletter to global", () => {
    expect(
      resolveModelId("embedder", {
        newsletterOverride: "   ",
        globalDefault: "global/embedder-model",
        envValue: "env/embedder-model",
      }),
    ).toBe("global/embedder-model");
  });

  it("trims newsletter override before returning", () => {
    expect(
      resolveModelId("tagger", {
        newsletterOverride: "  provider/model  ",
        globalDefault: "global/tagger-model",
        envValue: "env/tagger-model",
      }),
    ).toBe("provider/model");
  });
});

describe("resolveAllModelIds", () => {
  it("resolves each role independently with the same precedence", () => {
    const resolved = resolveAllModelIds({
      newsletterOverrides: {
        tagger: "nl/tagger",
        scorer: "  ",
      },
      globalDefaults: {
        scorer: "global/scorer",
        drafter: "global/drafter",
      },
      envValues: {
        drafter: "env/drafter",
        embedder: "env/embedder",
      },
    });

    expect(resolved).toEqual({
      tagger: "nl/tagger",
      scorer: "global/scorer",
      drafter: "global/drafter",
      embedder: "env/embedder",
    });
  });

  it("returns DEFAULT_MODELS for every role when sources are empty", () => {
    expect(resolveAllModelIds({})).toEqual({ ...DEFAULT_MODELS });
  });
});
