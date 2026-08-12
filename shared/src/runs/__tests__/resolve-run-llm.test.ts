import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Client } from "node-appwrite";
import type { Newsletter } from "../../newsletters/types";
import type { PromptTemplate } from "../../prompts/types";
import { PromptRepositoryError } from "../../prompts/types";
import type { AppSettings } from "../../settings/types";
import { SettingsRepositoryError } from "../../settings/types";
import { DEFAULT_MODELS, ENV_MODEL_KEYS } from "../../pipeline/config";

const mocks = vi.hoisted(() => ({
  listPromptTemplates: vi.fn(),
  getOrCreateAppSettings: vi.fn(),
}));

vi.mock("../../prompts/repository", () => ({
  listPromptTemplates: mocks.listPromptTemplates,
}));

vi.mock("../../settings/repository", () => ({
  getOrCreateAppSettings: mocks.getOrCreateAppSettings,
}));

import { loadRunLlmResolution } from "../resolve-run-llm";

const client = {} as Client;

const ENV_KEYS = Object.values(ENV_MODEL_KEYS);
const savedEnv: Record<string, string | undefined> = {};

type NewsletterWithDrafterPrompt = Newsletter & { drafterPrompt: string };

function makeNewsletter(
  overrides: Partial<NewsletterWithDrafterPrompt> = {},
): NewsletterWithDrafterPrompt {
  return {
    $id: "nl-1",
    name: "Test Newsletter",
    topics: ["AI"],
    dislikedTopics: [],
    audience: "Engineers",
    newsItems: 10,
    dateRange: "last_3_days",
    lookback: 3,
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    drafterPrompt: "",
    scheduleEnabled: false,
    scheduleCron: "",
    scheduleTimezone: "UTC",
    scheduleLastFiredAt: null,
    recipientEmails: [],
    autoEmail: false,
    autoRss: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeTemplates(
  bodies: Partial<Record<"tagger" | "scorer" | "drafter", string>> = {},
): PromptTemplate[] {
  return [
    {
      role: "tagger",
      body: bodies.tagger ?? "TAGGER body {title} {truncated_content}",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      role: "scorer",
      body: bodies.scorer ?? "SCORER body {topics} {title}",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      role: "drafter",
      body: bodies.drafter ?? "DRAFTER body {newsletter_name} {articles_json}",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    runRetentionDays: 30,
    updatedAt: "2024-01-01T00:00:00.000Z",
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    openRouterApiKey: "",
    smtpHost: "",
    smtpPort: null,
    smtpUsername: "",
    smtpPassword: "",
    smtpFrom: "",
    smtpSecure: "",
    appPublicUrl: "",
    scoreThreshold: null,
    crossRunSimilarityThreshold: null,
    rssFeedMaxItems: null,
    drafterReasoningEffort: "",
    drafterMaxCompletionTokens: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.listPromptTemplates.mockReset();
  mocks.getOrCreateAppSettings.mockReset();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("loadRunLlmResolution", () => {
  it("returns prompt bodies and models from newsletter → global → env cascade", async () => {
    mocks.listPromptTemplates.mockResolvedValue(
      makeTemplates({
        tagger: "loaded-tagger-prompt",
        scorer: "loaded-scorer-prompt",
        drafter: "loaded-drafter-prompt",
      }),
    );
    mocks.getOrCreateAppSettings.mockResolvedValue(
      makeSettings({
        scorerModel: "global/scorer",
        drafterModel: "global/drafter",
        embedderModel: "",
      }),
    );
    process.env[ENV_MODEL_KEYS.drafter] = "env/drafter";
    process.env[ENV_MODEL_KEYS.embedder] = "env/embedder";

    const newsletter = makeNewsletter({
      taggerModel: "nl/tagger",
      scorerModel: "",
      drafterModel: "  ",
      embedderModel: "",
      drafterPrompt: "",
    });

    const result = await loadRunLlmResolution(client, newsletter);

    expect(mocks.listPromptTemplates).toHaveBeenCalledTimes(1);
    expect(mocks.listPromptTemplates).toHaveBeenCalledWith(client);
    expect(mocks.getOrCreateAppSettings).toHaveBeenCalledTimes(1);
    expect(mocks.getOrCreateAppSettings).toHaveBeenCalledWith(client);

    expect(result.prompts).toEqual({
      tagger: "loaded-tagger-prompt",
      scorer: "loaded-scorer-prompt",
      drafter: "loaded-drafter-prompt",
    });
    expect(result.models).toEqual({
      tagger: "nl/tagger",
      scorer: "global/scorer",
      drafter: "global/drafter",
      embedder: "env/embedder",
    });
  });

  it("falls through to DEFAULT_MODELS when newsletter, global, and env are empty", async () => {
    mocks.listPromptTemplates.mockResolvedValue(makeTemplates());
    mocks.getOrCreateAppSettings.mockResolvedValue(makeSettings());

    const result = await loadRunLlmResolution(client, makeNewsletter());

    expect(result.models).toEqual({ ...DEFAULT_MODELS });
  });

  it("propagates PromptRepositoryError from listPromptTemplates", async () => {
    mocks.listPromptTemplates.mockRejectedValue(
      new PromptRepositoryError(
        "appwrite",
        "Something went wrong while talking to the database. Please try again.",
      ),
    );

    await expect(loadRunLlmResolution(client, makeNewsletter())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof PromptRepositoryError &&
        err.code === "appwrite" &&
        err.message.includes("database"),
    );
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
  });

  it("propagates SettingsRepositoryError from getOrCreateAppSettings", async () => {
    mocks.listPromptTemplates.mockResolvedValue(makeTemplates());
    mocks.getOrCreateAppSettings.mockRejectedValue(
      new SettingsRepositoryError(
        "appwrite",
        "Something went wrong while talking to the database. Please try again.",
      ),
    );

    await expect(loadRunLlmResolution(client, makeNewsletter())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof SettingsRepositoryError &&
        err.code === "appwrite" &&
        err.message.includes("database"),
    );
  });

  // Feature 03 Task 1 — items 10–11: newsletter drafterPrompt override vs global
  it("uses newsletter drafterPrompt when non-empty after trim", async () => {
    const overrideBody =
      "OVERRIDE {newsletter_name} {topics} {articles_json} {count} {audience}";
    mocks.listPromptTemplates.mockResolvedValue(
      makeTemplates({ drafter: "GLOBAL drafter body {newsletter_name}" }),
    );
    mocks.getOrCreateAppSettings.mockResolvedValue(makeSettings());

    const result = await loadRunLlmResolution(
      client,
      makeNewsletter({ drafterPrompt: `  ${overrideBody}  ` }),
    );

    expect(result.prompts.drafter).toBe(overrideBody);
    expect(result.prompts.drafter).not.toContain("GLOBAL");
  });

  it("falls back to global drafter template when newsletter drafterPrompt is empty", async () => {
    mocks.listPromptTemplates.mockResolvedValue(
      makeTemplates({ drafter: "GLOBAL drafter body {newsletter_name}" }),
    );
    mocks.getOrCreateAppSettings.mockResolvedValue(makeSettings());

    const empty = await loadRunLlmResolution(
      client,
      makeNewsletter({ drafterPrompt: "" }),
    );
    expect(empty.prompts.drafter).toBe("GLOBAL drafter body {newsletter_name}");

    const whitespace = await loadRunLlmResolution(
      client,
      makeNewsletter({ drafterPrompt: "   \n\t  " }),
    );
    expect(whitespace.prompts.drafter).toBe("GLOBAL drafter body {newsletter_name}");
  });

  it("resolves models independently of drafterPrompt override", async () => {
    mocks.listPromptTemplates.mockResolvedValue(
      makeTemplates({ drafter: "GLOBAL drafter" }),
    );
    mocks.getOrCreateAppSettings.mockResolvedValue(
      makeSettings({ drafterModel: "global/drafter" }),
    );

    const result = await loadRunLlmResolution(
      client,
      makeNewsletter({
        drafterPrompt: "OVERRIDE {newsletter_name} {topics} {articles_json} {count}",
        drafterModel: "nl/drafter",
        taggerModel: "nl/tagger",
      }),
    );

    expect(result.prompts.drafter).toBe(
      "OVERRIDE {newsletter_name} {topics} {articles_json} {count}",
    );
    expect(result.models.drafter).toBe("nl/drafter");
    expect(result.models.tagger).toBe("nl/tagger");
  });

});
