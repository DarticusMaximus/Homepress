import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromptRepositoryError, SettingsRepositoryError } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  updatePromptTemplate: vi.fn(),
  resetPromptTemplate: vi.fn(),
  updateGlobalModelDefaults: vi.fn(),
  getServerAppwrite: vi.fn(),
  revalidatePath: vi.fn(),
  client: { $id: "mock-client" },
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    updatePromptTemplate: mocks.updatePromptTemplate,
    resetPromptTemplate: mocks.resetPromptTemplate,
    updateGlobalModelDefaults: mocks.updateGlobalModelDefaults,
    getServerAppwrite: mocks.getServerAppwrite,
  };
});

import {
  resetPromptTemplateAction,
  updateGlobalModelDefaultsAction,
  updatePromptTemplateAction,
} from "@/app/(protected)/admin/prompts/actions";

const TEMPLATE = {
  role: "tagger" as const,
  body: "Tagger body with {title} and {truncated_content}",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const MODELS = {
  taggerModel: "provider/tagger",
  scorerModel: "provider/scorer",
  drafterModel: "provider/drafter",
  embedderModel: "provider/embedder",
};

beforeEach(() => {
  mocks.updatePromptTemplate.mockReset();
  mocks.resetPromptTemplate.mockReset();
  mocks.updateGlobalModelDefaults.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
});

describe("updatePromptTemplateAction", () => {
  it("calls updatePromptTemplate with (client, role, body) and returns template + warnings", async () => {
    mocks.updatePromptTemplate.mockResolvedValue({
      template: TEMPLATE,
      warnings: ["unknown_token"],
    });

    const result = await updatePromptTemplateAction("tagger", TEMPLATE.body);

    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.updatePromptTemplate).toHaveBeenCalledWith(
      mocks.client,
      "tagger",
      TEMPLATE.body,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/prompts");
    expect(result).toEqual({
      ok: true,
      template: TEMPLATE,
      warnings: ["unknown_token"],
    });
  });

  it("returns validation PromptRepositoryError message as ok:false", async () => {
    mocks.updatePromptTemplate.mockRejectedValue(
      new PromptRepositoryError("validation", "Missing required placeholders: title"),
    );

    const result = await updatePromptTemplateAction("tagger", "no placeholders");

    expect(result).toEqual({
      ok: false,
      error: "Missing required placeholders: title",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns generic operator-safe error for unknown failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updatePromptTemplate.mockRejectedValue(
      new PromptRepositoryError("appwrite", "Something went wrong while talking to the database. Please try again."),
    );

    const result = await updatePromptTemplateAction("scorer", "body with {topics}");

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong while saving the prompt template.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("resetPromptTemplateAction", () => {
  it("calls resetPromptTemplate with (client, role) and returns template + warnings", async () => {
    mocks.resetPromptTemplate.mockResolvedValue({
      template: TEMPLATE,
      warnings: [],
    });

    const result = await resetPromptTemplateAction("tagger");

    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.resetPromptTemplate).toHaveBeenCalledWith(mocks.client, "tagger");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/prompts");
    expect(result).toEqual({
      ok: true,
      template: TEMPLATE,
      warnings: [],
    });
  });

  it("returns validation PromptRepositoryError message as ok:false", async () => {
    mocks.resetPromptTemplate.mockRejectedValue(
      new PromptRepositoryError("validation", "Invalid prompt role: nope"),
    );

    const result = await resetPromptTemplateAction("tagger");

    expect(result).toEqual({
      ok: false,
      error: "Invalid prompt role: nope",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns generic operator-safe error for unknown failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resetPromptTemplate.mockRejectedValue(
      new PromptRepositoryError(
        "appwrite",
        "Something went wrong while talking to the database. Please try again.",
      ),
    );

    const result = await resetPromptTemplateAction("scorer");

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong while resetting the prompt template.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("updateGlobalModelDefaultsAction", () => {
  it("calls updateGlobalModelDefaults with the four-field payload and revalidates /admin/prompts", async () => {
    mocks.updateGlobalModelDefaults.mockResolvedValue({
      runRetentionDays: 30,
      updatedAt: "2026-07-14T12:00:00.000Z",
      ...MODELS,
    });

    const result = await updateGlobalModelDefaultsAction(MODELS);

    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.updateGlobalModelDefaults).toHaveBeenCalledWith(mocks.client, MODELS);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/prompts");
    expect(result).toEqual({
      ok: true,
      settings: {
        ...MODELS,
        updatedAt: "2026-07-14T12:00:00.000Z",
      },
    });
  });

  it("returns validation SettingsRepositoryError message as ok:false", async () => {
    mocks.updateGlobalModelDefaults.mockRejectedValue(
      new SettingsRepositoryError(
        "validation",
        "Invalid model ID for tagger. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
      ),
    );

    const result = await updateGlobalModelDefaultsAction({
      ...MODELS,
      taggerModel: "bad",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "Invalid model ID for tagger. Use an OpenRouter-style id like provider/model (max 256 characters, no whitespace).",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns generic operator-safe error for unknown failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateGlobalModelDefaults.mockRejectedValue(
      new SettingsRepositoryError(
        "appwrite",
        "Something went wrong while talking to the database. Please try again.",
      ),
    );

    const result = await updateGlobalModelDefaultsAction(MODELS);

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong while saving default models.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
