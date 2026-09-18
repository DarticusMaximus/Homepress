import { randomBytes } from "node:crypto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Client } from "node-appwrite";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
}));

vi.mock("node-appwrite", async (importActual) => {
  const actual = await importActual<typeof import("node-appwrite")>();
  return {
    ...actual,
    Databases: class MockDatabasesConstructor {
      constructor() {
        return mockHolder.databases as unknown as MockDatabasesConstructor;
      }
    },
  };
});

import {
  DATABASE_ID,
  APP_SETTINGS_COLLECTION_ID,
  APP_SETTINGS_DOCUMENT_ID,
  DEFAULT_RUN_RETENTION_DAYS,
  MIN_RUN_RETENTION_DAYS,
  MAX_RUN_RETENTION_DAYS,
} from "../../schema/declarations";
import {
  clearOpenRouterApiKeyOverride,
  clearSmtpBundleOverride,
  getOrCreateAppSettings,
  getSettingsSecretsHealth,
  updateConnectionSettings,
  updateGlobalModelDefaults,
  updatePipelineKnobsSettings,
  updateRunRetentionDays,
} from "../repository";
import { resolveOperatorSettings } from "../resolve-operator-settings";
import { encryptSecretValue, SETTINGS_SECRET_KEY_ENV } from "../secrets";
import { SettingsRepositoryError } from "../types";
import type { UpdateConnectionInput, UpdatePipelineKnobsInput } from "../operator-settings";
import { MockRunsDatabases, appwriteException, fakeClient } from "../../runs/__tests__/mock-client";

const VALID_MODELS = {
  taggerModel: "openai/gpt-4o-mini",
  scorerModel: "anthropic/claude-3.5-sonnet",
  drafterModel: "google/gemini-2.0-flash",
  titleDekModel: "nvidia/nemotron-3-nano-30b-a3b",
  embedderModel: "openai/text-embedding-3-small",
} as const;

const CLEARED_CONNECTION: UpdateConnectionInput = {
  openRouterApiKey: "",
  smtpHost: "",
  smtpPort: null,
  smtpUsername: "",
  smtpPassword: "",
  smtpFrom: "",
  smtpSecure: "",
  appPublicUrl: "",
};

const CLEARED_KNOBS: UpdatePipelineKnobsInput = {
  scoreThreshold: null,
  crossRunSimilarityThreshold: null,
  rssFeedMaxItems: null,
  drafterReasoningEffort: "",
  drafterMaxCompletionTokens: null,
};

const CONNECTION_DATA_KEYS = [
  "openRouterApiKey",
  "smtpHost",
  "smtpPort",
  "smtpUsername",
  "smtpPassword",
  "smtpFrom",
  "smtpSecure",
  "appPublicUrl",
  "updatedAt",
] as const;

const PIPELINE_KNOB_DATA_KEYS = [
  "scoreThreshold",
  "crossRunSimilarityThreshold",
  "rssFeedMaxItems",
  "drafterReasoningEffort",
  "drafterMaxCompletionTokens",
  "updatedAt",
] as const;

const MODEL_DATA_KEYS = [
  "taggerModel",
  "scorerModel",
  "drafterModel",
  "titleDekModel",
  "embedderModel",
  "updatedAt",
] as const;

const COMPLETE_SMTP = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "smtp-user",
  smtpPassword: "smtp-secret-password",
  smtpFrom: "noreply@example.com",
  smtpSecure: "true",
} as const;

function validCipherKey(): string {
  return randomBytes(32).toString("hex");
}

function expectPublicAppSettings(settings: object): void {
  expect(settings).not.toHaveProperty("openRouterApiKey");
  expect(settings).not.toHaveProperty("smtpPassword");
  expect(settings).toEqual(
    expect.objectContaining({
      hasOpenRouterApiKey: expect.any(Boolean),
      hasSmtpPassword: expect.any(Boolean),
    }),
  );
}

function expectDataKeys(data: Record<string, unknown>, keys: readonly string[]): void {
  expect(Object.keys(data).sort()).toEqual([...keys].sort());
}

function expectSettingsError(
  promise: Promise<unknown>,
  code: SettingsRepositoryError["code"],
): Promise<SettingsRepositoryError> {
  return promise.then(
    () => {
      throw new Error(`Expected SettingsRepositoryError with code ${code}`);
    },
    (err) => {
      expect(err).toBeInstanceOf(SettingsRepositoryError);
      const repoErr = err as SettingsRepositoryError;
      expect(repoErr.code).toBe(code);
      return repoErr;
    },
  );
}

function mockSettingsDocument(
  overrides: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    $id: APP_SETTINGS_DOCUMENT_ID,
    $collectionId: APP_SETTINGS_COLLECTION_ID,
    $databaseId: DATABASE_ID,
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    runRetentionDays: DEFAULT_RUN_RETENTION_DAYS,
    updatedAt: now,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOrCreateAppSettings", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns the existing settings document when present", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 60,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.runRetentionDays).toBe(60);
    expect(settings.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("creates the default document on 404 and returns default retention", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const settings = await getOrCreateAppSettings(client);

    expect(docs.createDocumentCalls).toHaveLength(1);
    const call = docs.createDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(APP_SETTINGS_COLLECTION_ID);
    expect(call.documentId).toBe(APP_SETTINGS_DOCUMENT_ID);
    expect(call.data.runRetentionDays).toBe(DEFAULT_RUN_RETENTION_DAYS);
    expect(call.data.updatedAt).toEqual(expect.any(String));

    expect(settings.runRetentionDays).toBe(DEFAULT_RUN_RETENTION_DAYS);
  });

  it("clamps NaN stored value to the default on read", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: NaN }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.runRetentionDays).toBe(DEFAULT_RUN_RETENTION_DAYS);
  });

  it("clamps below-MIN stored value to the default on read", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({ runRetentionDays: MIN_RUN_RETENTION_DAYS - 1 }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.runRetentionDays).toBe(DEFAULT_RUN_RETENTION_DAYS);
  });

  it("clamps above-MAX stored value to the default on read", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({ runRetentionDays: MAX_RUN_RETENTION_DAYS + 1 }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.runRetentionDays).toBe(DEFAULT_RUN_RETENTION_DAYS);
  });

  it("clamps non-number stored value to the default on read", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: "thirty" }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.runRetentionDays).toBe(DEFAULT_RUN_RETENTION_DAYS);
  });

  it("accepts MIN stored value without clamping", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({ runRetentionDays: MIN_RUN_RETENTION_DAYS }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.runRetentionDays).toBe(MIN_RUN_RETENTION_DAYS);
  });

  it("accepts MAX stored value without clamping", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({ runRetentionDays: MAX_RUN_RETENTION_DAYS }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.runRetentionDays).toBe(MAX_RUN_RETENTION_DAYS);
  });

  it("wraps a non-404 getDocument error as appwrite error", async () => {
    docs.getDocumentError = appwriteException("boom", 500);

    await expectSettingsError(getOrCreateAppSettings(client), "appwrite");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("wraps a createDocument failure (on 404 path) as appwrite error", async () => {
    docs.getDocumentError = appwriteException("not found", 404);
    docs.createDocumentError = appwriteException("create failed", 500);

    await expectSettingsError(getOrCreateAppSettings(client), "appwrite");
  });
});

describe("updateRunRetentionDays", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("rejects 0 with a validation error", async () => {
    await expectSettingsError(updateRunRetentionDays(client, 0), "validation");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a negative value with a validation error", async () => {
    await expectSettingsError(updateRunRetentionDays(client, -5), "validation");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects 366 with a validation error", async () => {
    await expectSettingsError(
      updateRunRetentionDays(client, MAX_RUN_RETENTION_DAYS + 1),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a non-integer with a validation error", async () => {
    await expectSettingsError(updateRunRetentionDays(client, 7.5), "validation");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects NaN with a validation error", async () => {
    await expectSettingsError(updateRunRetentionDays(client, NaN), "validation");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a non-number with a validation error", async () => {
    await expectSettingsError(
      updateRunRetentionDays(client, "30" as unknown as number),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("accepts MIN (1) and persists via updateDocument", async () => {
    const settings = await updateRunRetentionDays(client, MIN_RUN_RETENTION_DAYS);

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(APP_SETTINGS_COLLECTION_ID);
    expect(call.documentId).toBe(APP_SETTINGS_DOCUMENT_ID);
    expect(call.data.runRetentionDays).toBe(MIN_RUN_RETENTION_DAYS);
    expect(call.data.updatedAt).toEqual(expect.any(String));
    expectDataKeys(call.data, ["runRetentionDays", "updatedAt"]);

    expect(settings.runRetentionDays).toBe(MIN_RUN_RETENTION_DAYS);
    expectPublicAppSettings(settings);
  });

  it("accepts MAX (365) and persists via updateDocument", async () => {
    const settings = await updateRunRetentionDays(client, MAX_RUN_RETENTION_DAYS);

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.runRetentionDays).toBe(MAX_RUN_RETENTION_DAYS);
    expect(settings.runRetentionDays).toBe(MAX_RUN_RETENTION_DAYS);
    expectPublicAppSettings(settings);
  });

  it("does not get-or-create; partial-updates only retention + updatedAt", async () => {
    const settings = await updateRunRetentionDays(client, 45);

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expectDataKeys(docs.updateDocumentCalls[0]!.data, ["runRetentionDays", "updatedAt"]);
    expect(docs.updateDocumentCalls[0]!.data.runRetentionDays).toBe(45);
    expect(settings.runRetentionDays).toBe(45);
    expectPublicAppSettings(settings);
  });

  it("wraps an updateDocument failure as appwrite error", async () => {
    docs.updateDocumentError = appwriteException("update failed", 500);

    await expectSettingsError(updateRunRetentionDays(client, 45), "appwrite");
    expect(docs.getDocumentCalls).toHaveLength(0);
  });
});

describe("global model defaults", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("getOrCreate maps missing model attributes to empty strings", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.taggerModel).toBe("");
    expect(settings.scorerModel).toBe("");
    expect(settings.drafterModel).toBe("");
    expect(settings.titleDekModel).toBe("");
    expect(settings.embedderModel).toBe("");
  });

  it("updateGlobalModelDefaults persists five valid IDs without reading or echoing retention", async () => {
    const settings = await updateGlobalModelDefaults(client, { ...VALID_MODELS });

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(APP_SETTINGS_COLLECTION_ID);
    expect(call.documentId).toBe(APP_SETTINGS_DOCUMENT_ID);
    expect(call.data.taggerModel).toBe(VALID_MODELS.taggerModel);
    expect(call.data.scorerModel).toBe(VALID_MODELS.scorerModel);
    expect(call.data.drafterModel).toBe(VALID_MODELS.drafterModel);
    expect(call.data.titleDekModel).toBe(VALID_MODELS.titleDekModel);
    expect(call.data.embedderModel).toBe(VALID_MODELS.embedderModel);
    expect(call.data.updatedAt).toEqual(expect.any(String));
    expectDataKeys(call.data, MODEL_DATA_KEYS);

    expect(settings.taggerModel).toBe(VALID_MODELS.taggerModel);
    expect(settings.scorerModel).toBe(VALID_MODELS.scorerModel);
    expect(settings.drafterModel).toBe(VALID_MODELS.drafterModel);
    expect(settings.titleDekModel).toBe(VALID_MODELS.titleDekModel);
    expect(settings.embedderModel).toBe(VALID_MODELS.embedderModel);
    expectPublicAppSettings(settings);
  });

  it("accepts empty strings for all five models (clear globals)", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        ...VALID_MODELS,
      }) as never;

    const settings = await updateGlobalModelDefaults(client, {
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      titleDekModel: "",
      embedderModel: "",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.taggerModel).toBe("");
    expect(data.scorerModel).toBe("");
    expect(data.drafterModel).toBe("");
    expect(data.titleDekModel).toBe("");
    expect(data.embedderModel).toBe("");

    expect(settings.taggerModel).toBe("");
    expect(settings.scorerModel).toBe("");
    expect(settings.drafterModel).toBe("");
    expect(settings.titleDekModel).toBe("");
    expect(settings.embedderModel).toBe("");
  });

  it("stores whitespace-only model IDs as empty strings", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    const settings = await updateGlobalModelDefaults(client, {
      taggerModel: "   ",
      scorerModel: "\t",
      drafterModel: " \n ",
      titleDekModel: "  ",
      embedderModel: "  \t  ",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.taggerModel).toBe("");
    expect(data.scorerModel).toBe("");
    expect(data.drafterModel).toBe("");
    expect(data.titleDekModel).toBe("");
    expect(data.embedderModel).toBe("");

    expect(settings.taggerModel).toBe("");
    expect(settings.scorerModel).toBe("");
    expect(settings.drafterModel).toBe("");
    expect(settings.titleDekModel).toBe("");
    expect(settings.embedderModel).toBe("");
  });

  it("rejects a value without a slash with validation error and no write", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    const err = await expectSettingsError(
      updateGlobalModelDefaults(client, {
        ...VALID_MODELS,
        taggerModel: "gpt-4o-mini",
      }),
      "validation",
    );
    expect(err.message).toMatch(/tagger/i);
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a value longer than 256 characters with validation error and no write", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;
    const tooLong = `provider/${"a".repeat(250)}`;

    const err = await expectSettingsError(
      updateGlobalModelDefaults(client, {
        ...VALID_MODELS,
        scorerModel: tooLong,
      }),
      "validation",
    );
    expect(err.message).toMatch(/scorer/i);
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects internal whitespace or control characters with validation error and no write", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    await expectSettingsError(
      updateGlobalModelDefaults(client, {
        ...VALID_MODELS,
        drafterModel: "foo/bar baz",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);

    await expectSettingsError(
      updateGlobalModelDefaults(client, {
        ...VALID_MODELS,
        embedderModel: "foo/bar\tbaz",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);

    await expectSettingsError(
      updateGlobalModelDefaults(client, {
        ...VALID_MODELS,
        taggerModel: "foo/bar\u0000baz",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("persists titleDekModel and rejects invalid titleDekModel without writing", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    const settings = await updateGlobalModelDefaults(client, {
      ...VALID_MODELS,
      titleDekModel: "  vendor/title-dek  ",
    });
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.titleDekModel).toBe("vendor/title-dek");
    expect(settings.titleDekModel).toBe("vendor/title-dek");

    docs.updateDocumentCalls.length = 0;
    const err = await expectSettingsError(
      updateGlobalModelDefaults(client, {
        ...VALID_MODELS,
        titleDekModel: "not-a-valid-id",
      }),
      "validation",
    );
    expect(err.message).toMatch(/titleDek/i);
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects mixed valid/invalid payload all-or-nothing without writing", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        taggerModel: "kept/tagger",
        scorerModel: "kept/scorer",
        drafterModel: "kept/drafter",
        titleDekModel: "kept/title-dek",
        embedderModel: "kept/embedder",
      }) as never;

    await expectSettingsError(
      updateGlobalModelDefaults(client, {
        taggerModel: "openai/gpt-4o-mini",
        scorerModel: "not-a-valid-id",
        drafterModel: "google/gemini-2.0-flash",
        titleDekModel: "nvidia/nemotron-3-nano-30b-a3b",
        embedderModel: "openai/text-embedding-3-small",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("accepts valid OpenRouter ids with a :free suffix", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;
    const freeId = "meta-llama/llama-3.2-3b-instruct:free";

    const settings = await updateGlobalModelDefaults(client, {
      taggerModel: freeId,
      scorerModel: freeId,
      drafterModel: freeId,
      titleDekModel: freeId,
      embedderModel: freeId,
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.taggerModel).toBe(freeId);
    expect(data.scorerModel).toBe(freeId);
    expect(data.drafterModel).toBe(freeId);
    expect(data.titleDekModel).toBe(freeId);
    expect(data.embedderModel).toBe(freeId);

    expect(settings.taggerModel).toBe(freeId);
    expect(settings.scorerModel).toBe(freeId);
    expect(settings.drafterModel).toBe(freeId);
    expect(settings.titleDekModel).toBe(freeId);
    expect(settings.embedderModel).toBe(freeId);
  });

  it("create path for virgin settings does not invent model IDs from env", async () => {
    const prev = {
      TAGGER_MODEL: process.env.TAGGER_MODEL,
      SCORER_MODEL: process.env.SCORER_MODEL,
      DRAFTER_MODEL: process.env.DRAFTER_MODEL,
      EMBEDDER_MODEL: process.env.EMBEDDER_MODEL,
    };
    process.env.TAGGER_MODEL = "env/tagger-should-not-seed";
    process.env.SCORER_MODEL = "env/scorer-should-not-seed";
    process.env.DRAFTER_MODEL = "env/drafter-should-not-seed";
    process.env.EMBEDDER_MODEL = "env/embedder-should-not-seed";

    try {
      docs.getDocumentError = appwriteException("not found", 404);

      const settings = await getOrCreateAppSettings(client);

      expect(docs.createDocumentCalls).toHaveLength(1);
      const data = docs.createDocumentCalls[0]!.data;
      if ("taggerModel" in data) expect(data.taggerModel).toBe("");
      if ("scorerModel" in data) expect(data.scorerModel).toBe("");
      if ("drafterModel" in data) expect(data.drafterModel).toBe("");
      if ("embedderModel" in data) expect(data.embedderModel).toBe("");
      expect(data.taggerModel).not.toBe("env/tagger-should-not-seed");
      expect(data.scorerModel).not.toBe("env/scorer-should-not-seed");
      expect(data.drafterModel).not.toBe("env/drafter-should-not-seed");
      expect(data.embedderModel).not.toBe("env/embedder-should-not-seed");

      expect(settings.taggerModel).toBe("");
      expect(settings.scorerModel).toBe("");
      expect(settings.drafterModel).toBe("");
      expect(settings.embedderModel).toBe("");
    } finally {
      if (prev.TAGGER_MODEL === undefined) delete process.env.TAGGER_MODEL;
      else process.env.TAGGER_MODEL = prev.TAGGER_MODEL;
      if (prev.SCORER_MODEL === undefined) delete process.env.SCORER_MODEL;
      else process.env.SCORER_MODEL = prev.SCORER_MODEL;
      if (prev.DRAFTER_MODEL === undefined) delete process.env.DRAFTER_MODEL;
      else process.env.DRAFTER_MODEL = prev.DRAFTER_MODEL;
      if (prev.EMBEDDER_MODEL === undefined) delete process.env.EMBEDDER_MODEL;
      else process.env.EMBEDDER_MODEL = prev.EMBEDDER_MODEL;
    }
  });
});

// Stage 12 operator override read mapping (decrypt-on-read lives here too).
describe("operator settings overrides", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("getOrCreate maps missing Stage 12 attributes to empty strings / null", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.openRouterApiKey).toBe("");
    expect(settings.smtpHost).toBe("");
    expect(settings.smtpPort).toBeNull();
    expect(settings.smtpUsername).toBe("");
    expect(settings.smtpPassword).toBe("");
    expect(settings.smtpFrom).toBe("");
    expect(settings.smtpSecure).toBe("");
    expect(settings.appPublicUrl).toBe("");
    expect(settings.scoreThreshold).toBeNull();
    expect(settings.crossRunSimilarityThreshold).toBeNull();
    expect(settings.rssFeedMaxItems).toBeNull();
    expect(settings.drafterReasoningEffort).toBe("");
    expect(settings.drafterMaxCompletionTokens).toBeNull();
  });

  it("corrupt Stage 12 values on read map to unset overrides without crashing", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        openRouterApiKey: 12345,
        smtpHost: { nested: true },
        smtpPort: "not-a-number",
        smtpUsername: ["array"],
        smtpPassword: true,
        smtpFrom: 42,
        smtpSecure: false,
        appPublicUrl: ["https://bad.example"],
        scoreThreshold: "seven",
        crossRunSimilarityThreshold: NaN,
        rssFeedMaxItems: 3.5,
        drafterReasoningEffort: 9,
        drafterMaxCompletionTokens: "lots",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.openRouterApiKey).toBe("");
    expect(settings.smtpHost).toBe("");
    expect(settings.smtpPort).toBeNull();
    expect(settings.smtpUsername).toBe("");
    expect(settings.smtpPassword).toBe("");
    expect(settings.smtpFrom).toBe("");
    expect(settings.smtpSecure).toBe("");
    expect(settings.appPublicUrl).toBe("");
    expect(settings.scoreThreshold).toBeNull();
    expect(settings.crossRunSimilarityThreshold).toBeNull();
    expect(settings.rssFeedMaxItems).toBeNull();
    expect(settings.drafterReasoningEffort).toBe("");
    expect(settings.drafterMaxCompletionTokens).toBeNull();
  });

  it("incomplete SMTP quartet on read clears all six SMTP attrs (C1/N1)", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
        // password missing → whole SMTP override absent on read mapping
        smtpPassword: null,
        smtpFrom: "orphan@example.com",
        smtpSecure: "true",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.smtpHost).toBe("");
    expect(settings.smtpPort).toBeNull();
    expect(settings.smtpUsername).toBe("");
    expect(settings.smtpPassword).toBe("");
    expect(settings.smtpFrom).toBe("");
    expect(settings.smtpSecure).toBe("");

    // Paired resolve: incomplete stored mapping must not surface as GUI SMTP.
    const resolved = await resolveOperatorSettings(client, {
      settings,
      env: {
        SMTP_HOST: "smtp.env.example",
        SMTP_PORT: "587",
        SMTP_USERNAME: "env-user",
        SMTP_PASSWORD: "env-pass",
      },
    });
    expect(resolved.smtp.source).toBe("env");
    expect(resolved.smtp.source).not.toBe("gui");
  });

  it("complete SMTP quartet on read round-trips including optional from/secure", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        ...COMPLETE_SMTP,
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.smtpHost).toBe(COMPLETE_SMTP.smtpHost);
    expect(settings.smtpPort).toBe(COMPLETE_SMTP.smtpPort);
    expect(settings.smtpUsername).toBe(COMPLETE_SMTP.smtpUsername);
    expect(settings.smtpPassword).toBe(COMPLETE_SMTP.smtpPassword);
    expect(settings.smtpFrom).toBe(COMPLETE_SMTP.smtpFrom);
    expect(settings.smtpSecure).toBe(COMPLETE_SMTP.smtpSecure);
  });

  it("whitespace-only / invalid-enum / bad URL Stage 12 strings map to unset on read (C2)", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        openRouterApiKey: "   ",
        smtpHost: "  smtp.example.com  ",
        smtpPort: 587,
        smtpUsername: "user",
        smtpPassword: "pass",
        smtpFrom: "  ",
        smtpSecure: "\ttrue\t",
        appPublicUrl: "   ",
        drafterReasoningEffort: "ultra",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.openRouterApiKey).toBe("");
    expect(settings.smtpHost).toBe("smtp.example.com");
    expect(settings.smtpPort).toBe(587);
    expect(settings.smtpUsername).toBe("user");
    expect(settings.smtpPassword).toBe("pass");
    expect(settings.smtpFrom).toBe("");
    expect(settings.smtpSecure).toBe("true");
    expect(settings.appPublicUrl).toBe("");
    expect(settings.drafterReasoningEffort).toBe("");
  });

  it("invalid appPublicUrl on read maps to unset; valid URL strips trailing slash", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        appPublicUrl: "ftp://press.example.com",
      }) as never;

    const bad = await getOrCreateAppSettings(client);
    expect(bad.appPublicUrl).toBe("");

    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        appPublicUrl: "https://press.example.com/",
      }) as never;

    const good = await getOrCreateAppSettings(client);
    expect(good.appPublicUrl).toBe("https://press.example.com");
  });

  it("out-of-range Stage 12 numbers map to null on read (C2)", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        scoreThreshold: 11,
        crossRunSimilarityThreshold: -0.1,
        rssFeedMaxItems: 0,
        drafterMaxCompletionTokens: 512,
        // Complete SMTP quartet except invalid port → whole bundle cleared
        smtpHost: "smtp.example.com",
        smtpPort: 0,
        smtpUsername: "user",
        smtpPassword: "pass",
        smtpFrom: "from@example.com",
        smtpSecure: "true",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.scoreThreshold).toBeNull();
    expect(settings.crossRunSimilarityThreshold).toBeNull();
    expect(settings.rssFeedMaxItems).toBeNull();
    expect(settings.drafterMaxCompletionTokens).toBeNull();
    expect(settings.smtpHost).toBe("");
    expect(settings.smtpPort).toBeNull();
    expect(settings.smtpUsername).toBe("");
    expect(settings.smtpPassword).toBe("");
    expect(settings.smtpFrom).toBe("");
    expect(settings.smtpSecure).toBe("");
  });

  it("in-range Stage 12 numbers and valid reasoning effort map through on read", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        scoreThreshold: 0,
        crossRunSimilarityThreshold: 1,
        rssFeedMaxItems: 50,
        drafterMaxCompletionTokens: 1024,
        drafterReasoningEffort: "low",
        appPublicUrl: "http://192.168.1.10:3000",
      }) as never;

    const settings = await getOrCreateAppSettings(client);

    expect(settings.scoreThreshold).toBe(0);
    expect(settings.crossRunSimilarityThreshold).toBe(1);
    expect(settings.rssFeedMaxItems).toBe(50);
    expect(settings.drafterMaxCompletionTokens).toBe(1024);
    expect(settings.drafterReasoningEffort).toBe("low");
    expect(settings.appPublicUrl).toBe("http://192.168.1.10:3000");
  });

  it("decrypts marked secret values with the key set", async () => {
    const key = validCipherKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const apiKey = "sk-or-encrypted-read";
    const smtpPassword = "smtp-encrypted-read";
    const storedKey = encryptSecretValue(apiKey);
    const storedPassword = encryptSecretValue(smtpPassword);

    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: storedKey,
        ...COMPLETE_SMTP,
        smtpPassword: storedPassword,
      }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.openRouterApiKey).toBe(apiKey);
    expect(settings.smtpPassword).toBe(smtpPassword);
    expect(settings.smtpHost).toBe(COMPLETE_SMTP.smtpHost);
  });

  it("passes legacy plaintext secrets through on read", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: "sk-or-legacy-plain",
        ...COMPLETE_SMTP,
      }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.openRouterApiKey).toBe("sk-or-legacy-plain");
    expect(settings.smtpPassword).toBe(COMPLETE_SMTP.smtpPassword);
  });

  it("yields empty string for unreadable marked secrets", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: "enc1:not-valid-ciphertext",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
        smtpPassword: "enc1:also-not-valid",
        smtpFrom: "from@example.com",
        smtpSecure: "true",
      }) as never;

    const settings = await getOrCreateAppSettings(client);
    expect(settings.openRouterApiKey).toBe("");
    expect(settings.smtpPassword).toBe("");
    // C3: unreadable password does not blank stored non-secret SMTP attrs.
    expect(settings.smtpHost).toBe("smtp.example.com");
    expect(settings.smtpPort).toBe(587);
    expect(settings.smtpUsername).toBe("user");
    expect(settings.smtpFrom).toBe("from@example.com");
    expect(settings.smtpSecure).toBe("true");
    consoleError.mockRestore();
  });
});

describe("updateConnectionSettings", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
    docs.getDocumentImpl = () => mockSettingsDocument({}) as never;
  });

  it("keeps stored secrets when form secrets are empty and never writes plaintext under key on", async () => {
    const key = validCipherKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const storedKey = encryptSecretValue("sk-or-kept-secret");
    const storedPassword = encryptSecretValue("kept-smtp-password");
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: storedKey,
        ...COMPLETE_SMTP,
        smtpPassword: storedPassword,
      }) as never;

    const settings = await updateConnectionSettings(client, {
      ...CLEARED_CONNECTION,
      ...COMPLETE_SMTP,
      smtpPassword: "",
      openRouterApiKey: "",
      appPublicUrl: "https://press.example.com",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.openRouterApiKey).toBe(storedKey);
    expect(data.smtpPassword).toBe(storedPassword);
    expect(JSON.stringify(data)).not.toContain("sk-or-kept-secret");
    expect(JSON.stringify(data)).not.toContain("kept-smtp-password");
    expectDataKeys(data, CONNECTION_DATA_KEYS);
    expectPublicAppSettings(settings);
    expect(settings.hasOpenRouterApiKey).toBe(true);
    expect(settings.hasSmtpPassword).toBe(true);
  });

  it("encrypts new secret values under key on as enc1: ciphertext", async () => {
    const key = validCipherKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const apiKey = "sk-or-brand-new";
    const smtpPassword = "brand-new-smtp-password";

    const settings = await updateConnectionSettings(client, {
      ...CLEARED_CONNECTION,
      ...COMPLETE_SMTP,
      smtpPassword,
      openRouterApiKey: apiKey,
      appPublicUrl: "https://press.example.com",
    });

    const data = docs.updateDocumentCalls[0]!.data;
    expect(String(data.openRouterApiKey)).toMatch(/^enc1:/);
    expect(String(data.smtpPassword)).toMatch(/^enc1:/);
    expect(JSON.stringify(data)).not.toContain(apiKey);
    expect(JSON.stringify(data)).not.toContain(smtpPassword);
    expectDataKeys(data, CONNECTION_DATA_KEYS);
    expectPublicAppSettings(settings);
  });

  it("rejects SMTP effective-bundle when host is cleared and password is kept", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        ...COMPLETE_SMTP,
      }) as never;

    await expectSettingsError(
      updateConnectionSettings(client, {
        ...CLEARED_CONNECTION,
        smtpHost: "",
        smtpPort: COMPLETE_SMTP.smtpPort,
        smtpUsername: COMPLETE_SMTP.smtpUsername,
        smtpPassword: "",
        smtpFrom: COMPLETE_SMTP.smtpFrom,
        smtpSecure: COMPLETE_SMTP.smtpSecure,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("lazy-migrates kept legacy plaintext to ciphertext when key is on", async () => {
    const key = validCipherKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const legacyKey = "sk-or-legacy-to-migrate";
    const legacyPassword = "legacy-smtp-to-migrate";
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: legacyKey,
        ...COMPLETE_SMTP,
        smtpPassword: legacyPassword,
      }) as never;

    await updateConnectionSettings(client, {
      ...CLEARED_CONNECTION,
      ...COMPLETE_SMTP,
      smtpPassword: "",
      openRouterApiKey: "",
    });

    const data = docs.updateDocumentCalls[0]!.data;
    expect(String(data.openRouterApiKey)).toMatch(/^enc1:/);
    expect(String(data.smtpPassword)).toMatch(/^enc1:/);
    expect(JSON.stringify(data)).not.toContain(legacyKey);
    expect(JSON.stringify(data)).not.toContain(legacyPassword);
  });

  it("refuses keep of a >350-byte legacy-plaintext secret under key on with clear-and-re-enter message", async () => {
    const key = validCipherKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const oversized = "x".repeat(351);
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: oversized,
      }) as never;

    const err = await expectSettingsError(
      updateConnectionSettings(client, { ...CLEARED_CONNECTION }),
      "validation",
    );
    expect(err.message).toMatch(/clear and re-enter/i);
    expect(err.message).not.toMatch(/appwrite/i);
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("invalid key + stored non-empty secret + keep → validation refusal", async () => {
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "not-a-valid-key");
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: "sk-or-stored",
      }) as never;

    const err = await expectSettingsError(
      updateConnectionSettings(client, {
        ...CLEARED_CONNECTION,
        appPublicUrl: "https://press.example.com",
      }),
      "validation",
    );
    expect(err.message).toMatch(/SETTINGS_SECRET_KEY is set but malformed/);
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("invalid key + no stored secret + non-secret-only save → succeeds", async () => {
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "not-a-valid-key");
    docs.getDocumentImpl = () => mockSettingsDocument({}) as never;

    const settings = await updateConnectionSettings(client, {
      ...CLEARED_CONNECTION,
      appPublicUrl: "https://press.example.com",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.appPublicUrl).toBe("https://press.example.com");
    expect(data.openRouterApiKey).toBe("");
    expect(data.smtpPassword).toBe("");
    expectPublicAppSettings(settings);
  });

  it("partial-update data keys are exactly the connection attributes + updatedAt", async () => {
    const settings = await updateConnectionSettings(client, {
      ...CLEARED_CONNECTION,
      appPublicUrl: "https://press.example.com/",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expectDataKeys(data, CONNECTION_DATA_KEYS);
    expect(data.appPublicUrl).toBe("https://press.example.com");
    expect(data).not.toHaveProperty("scoreThreshold");
    expect(data).not.toHaveProperty("runRetentionDays");
    expect(data).not.toHaveProperty("taggerModel");
    expectPublicAppSettings(settings);
  });

  it("rejects incomplete SMTP quartet with validation and no write", async () => {
    await expectSettingsError(
      updateConnectionSettings(client, {
        ...CLEARED_CONNECTION,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects non-absolute or non-http(s) appPublicUrl with validation and no write", async () => {
    await expectSettingsError(
      updateConnectionSettings(client, {
        ...CLEARED_CONNECTION,
        appPublicUrl: "not-a-url",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);

    await expectSettingsError(
      updateConnectionSettings(client, {
        ...CLEARED_CONNECTION,
        appPublicUrl: "ftp://press.example.com",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("validation errors never include raw SMTP password or OpenRouter key", async () => {
    const secretPassword = "smtp-super-secret-xyz";
    const secretKey = "sk-or-super-secret-xyz";

    const err = await expectSettingsError(
      updateConnectionSettings(client, {
        ...CLEARED_CONNECTION,
        openRouterApiKey: secretKey,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
        smtpPassword: secretPassword,
        appPublicUrl: "not-a-url",
      }),
      "validation",
    );
    expect(err.message).not.toContain(secretPassword);
    expect(err.message).not.toContain(secretKey);
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("stores plaintext secrets when cipher is off", async () => {
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "");
    const settings = await updateConnectionSettings(client, {
      ...CLEARED_CONNECTION,
      openRouterApiKey: "sk-or-plain",
      ...COMPLETE_SMTP,
    });

    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.openRouterApiKey).toBe("sk-or-plain");
    expect(data.smtpPassword).toBe(COMPLETE_SMTP.smtpPassword);
    expect(String(data.openRouterApiKey)).not.toMatch(/^enc1:/);
    expectPublicAppSettings(settings);
  });
});

describe("updatePipelineKnobsSettings", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("touches only knob attributes + updatedAt and returns PublicAppSettings", async () => {
    const settings = await updatePipelineKnobsSettings(client, {
      scoreThreshold: 7.5,
      crossRunSimilarityThreshold: 0.9,
      rssFeedMaxItems: 12,
      drafterReasoningEffort: "medium",
      drafterMaxCompletionTokens: 16000,
    });

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expectDataKeys(data, PIPELINE_KNOB_DATA_KEYS);
    expect(data.scoreThreshold).toBe(7.5);
    expect(data.crossRunSimilarityThreshold).toBe(0.9);
    expect(data.rssFeedMaxItems).toBe(12);
    expect(data.drafterReasoningEffort).toBe("medium");
    expect(data.drafterMaxCompletionTokens).toBe(16000);
    expect(data).not.toHaveProperty("openRouterApiKey");
    expect(data).not.toHaveProperty("smtpHost");
    expect(data).not.toHaveProperty("runRetentionDays");
    expectPublicAppSettings(settings);
    expect(settings.scoreThreshold).toBe(7.5);
  });

  it("rejects out-of-range scoreThreshold with validation and no write", async () => {
    await expectSettingsError(
      updatePipelineKnobsSettings(client, { ...CLEARED_KNOBS, scoreThreshold: 11 }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
    expect(docs.getDocumentCalls).toHaveLength(0);
  });

  it("rejects out-of-range crossRunSimilarityThreshold with validation and no write", async () => {
    await expectSettingsError(
      updatePipelineKnobsSettings(client, {
        ...CLEARED_KNOBS,
        crossRunSimilarityThreshold: 1.5,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects out-of-range rssFeedMaxItems with validation and no write", async () => {
    await expectSettingsError(
      updatePipelineKnobsSettings(client, { ...CLEARED_KNOBS, rssFeedMaxItems: 0 }),
      "validation",
    );
    await expectSettingsError(
      updatePipelineKnobsSettings(client, { ...CLEARED_KNOBS, rssFeedMaxItems: 51 }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects invalid drafterReasoningEffort enum with validation and no write", async () => {
    await expectSettingsError(
      updatePipelineKnobsSettings(client, {
        ...CLEARED_KNOBS,
        drafterReasoningEffort: "ultra",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects out-of-range drafterMaxCompletionTokens with validation and no write", async () => {
    await expectSettingsError(
      updatePipelineKnobsSettings(client, {
        ...CLEARED_KNOBS,
        drafterMaxCompletionTokens: 512,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });
});

describe("clear override functions", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("clearOpenRouterApiKeyOverride writes empty openRouterApiKey + updatedAt", async () => {
    const settings = await clearOpenRouterApiKeyOverride(client);

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.openRouterApiKey).toBe("");
    expectDataKeys(data, ["openRouterApiKey", "updatedAt"]);
    expectPublicAppSettings(settings);
    expect(settings.hasOpenRouterApiKey).toBe(false);
  });

  it("clearSmtpBundleOverride writes empty strings / null for all six SMTP attrs", async () => {
    const settings = await clearSmtpBundleOverride(client);

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.smtpHost).toBe("");
    expect(data.smtpPort).toBeNull();
    expect(data.smtpUsername).toBe("");
    expect(data.smtpPassword).toBe("");
    expect(data.smtpFrom).toBe("");
    expect(data.smtpSecure).toBe("");
    expectDataKeys(data, [
      "smtpHost",
      "smtpPort",
      "smtpUsername",
      "smtpPassword",
      "smtpFrom",
      "smtpSecure",
      "updatedAt",
    ]);
    expectPublicAppSettings(settings);
    expect(settings.hasSmtpPassword).toBe(false);
  });

  it("invalid key + fully-clearing save succeeds", async () => {
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "not-a-valid-key");
    await clearOpenRouterApiKeyOverride(client);
    await clearSmtpBundleOverride(client);
    expect(docs.updateDocumentCalls).toHaveLength(2);
    expect(docs.updateDocumentCalls[0]!.data.openRouterApiKey).toBe("");
    expect(docs.updateDocumentCalls[1]!.data.smtpPassword).toBe("");
  });
});

describe("getSettingsSecretsHealth", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "");
  });

  it("counts stored plaintext secrets as stored and not unreadable when cipher is off", async () => {
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "");
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: "sk-or-plain",
        smtpPassword: "smtp-plain",
      }) as never;

    const health = await getSettingsSecretsHealth(client);
    expect(health.cipher).toBe("off");
    expect(health.storedSecretCount).toBe(2);
    expect(health.unreadableSecretCount).toBe(0);
    expect(docs.getDocumentCalls).toHaveLength(1);
  });

  it("counts marked ciphertext as unreadable when cipher is invalid", async () => {
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, "not-a-valid-key");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: "enc1:dGVzdA==",
        smtpPassword: "",
      }) as never;

    const health = await getSettingsSecretsHealth(client);
    expect(health.cipher).toBe("invalid");
    expect(health.storedSecretCount).toBe(1);
    expect(health.unreadableSecretCount).toBe(1);
    consoleError.mockRestore();
  });

  it("counts readable ciphertext as stored and not unreadable when cipher is on", async () => {
    const key = validCipherKey();
    vi.stubEnv(SETTINGS_SECRET_KEY_ENV, key);
    const storedKey = encryptSecretValue("sk-or-readable");
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        openRouterApiKey: storedKey,
        smtpPassword: "",
      }) as never;

    const health = await getSettingsSecretsHealth(client);
    expect(health.cipher).toBe("on");
    expect(health.storedSecretCount).toBe(1);
    expect(health.unreadableSecretCount).toBe(0);
  });

  it("returns zeros when the document is missing", async () => {
    docs.getDocumentError = appwriteException("not found", 404);
    const health = await getSettingsSecretsHealth(client);
    expect(health.storedSecretCount).toBe(0);
    expect(health.unreadableSecretCount).toBe(0);
    expect(health.cipher).toBe("off");
  });
});
