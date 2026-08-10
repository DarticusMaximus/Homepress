import { vi, describe, it, expect, beforeEach } from "vitest";
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
  getOrCreateAppSettings,
  updateGlobalModelDefaults,
  updateRunRetentionDays,
} from "../repository";
import { SettingsRepositoryError } from "../types";
import { MockRunsDatabases, appwriteException, fakeClient } from "../../runs/__tests__/mock-client";

const VALID_MODELS = {
  taggerModel: "openai/gpt-4o-mini",
  scorerModel: "anthropic/claude-3.5-sonnet",
  drafterModel: "google/gemini-2.0-flash",
  embedderModel: "openai/text-embedding-3-small",
} as const;

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
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    const settings = await updateRunRetentionDays(client, MIN_RUN_RETENTION_DAYS);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(APP_SETTINGS_COLLECTION_ID);
    expect(call.documentId).toBe(APP_SETTINGS_DOCUMENT_ID);
    expect(call.data.runRetentionDays).toBe(MIN_RUN_RETENTION_DAYS);
    expect(call.data.updatedAt).toEqual(expect.any(String));

    expect(settings.runRetentionDays).toBe(MIN_RUN_RETENTION_DAYS);
  });

  it("accepts MAX (365) and persists via updateDocument", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    const settings = await updateRunRetentionDays(client, MAX_RUN_RETENTION_DAYS);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.runRetentionDays).toBe(MAX_RUN_RETENTION_DAYS);
    expect(settings.runRetentionDays).toBe(MAX_RUN_RETENTION_DAYS);
  });

  it("upserts: creates default on 404 then updates with the new value", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const settings = await updateRunRetentionDays(client, 45);

    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.runRetentionDays).toBe(45);
    expect(settings.runRetentionDays).toBe(45);
  });

  it("wraps an updateDocument failure as appwrite error", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;
    docs.updateDocumentError = appwriteException("update failed", 500);

    await expectSettingsError(updateRunRetentionDays(client, 45), "appwrite");
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
    expect(settings.embedderModel).toBe("");
  });

  it("updateGlobalModelDefaults persists four valid IDs and leaves runRetentionDays unchanged", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 60,
        taggerModel: "",
        scorerModel: "",
        drafterModel: "",
        embedderModel: "",
      }) as never;

    const settings = await updateGlobalModelDefaults(client, { ...VALID_MODELS });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(APP_SETTINGS_COLLECTION_ID);
    expect(call.documentId).toBe(APP_SETTINGS_DOCUMENT_ID);
    expect(call.data.taggerModel).toBe(VALID_MODELS.taggerModel);
    expect(call.data.scorerModel).toBe(VALID_MODELS.scorerModel);
    expect(call.data.drafterModel).toBe(VALID_MODELS.drafterModel);
    expect(call.data.embedderModel).toBe(VALID_MODELS.embedderModel);
    expect(call.data.updatedAt).toEqual(expect.any(String));
    if ("runRetentionDays" in call.data) {
      expect(call.data.runRetentionDays).toBe(60);
    }

    expect(settings.taggerModel).toBe(VALID_MODELS.taggerModel);
    expect(settings.scorerModel).toBe(VALID_MODELS.scorerModel);
    expect(settings.drafterModel).toBe(VALID_MODELS.drafterModel);
    expect(settings.embedderModel).toBe(VALID_MODELS.embedderModel);
    expect(settings.runRetentionDays).toBe(60);
  });

  it("accepts empty strings for all four models (clear globals)", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        ...VALID_MODELS,
      }) as never;

    const settings = await updateGlobalModelDefaults(client, {
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.taggerModel).toBe("");
    expect(data.scorerModel).toBe("");
    expect(data.drafterModel).toBe("");
    expect(data.embedderModel).toBe("");

    expect(settings.taggerModel).toBe("");
    expect(settings.scorerModel).toBe("");
    expect(settings.drafterModel).toBe("");
    expect(settings.embedderModel).toBe("");
  });

  it("stores whitespace-only model IDs as empty strings", async () => {
    docs.getDocumentImpl = () => mockSettingsDocument({ runRetentionDays: 30 }) as never;

    const settings = await updateGlobalModelDefaults(client, {
      taggerModel: "   ",
      scorerModel: "\t",
      drafterModel: " \n ",
      embedderModel: "  \t  ",
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.taggerModel).toBe("");
    expect(data.scorerModel).toBe("");
    expect(data.drafterModel).toBe("");
    expect(data.embedderModel).toBe("");

    expect(settings.taggerModel).toBe("");
    expect(settings.scorerModel).toBe("");
    expect(settings.drafterModel).toBe("");
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

  it("rejects mixed valid/invalid payload all-or-nothing without writing", async () => {
    docs.getDocumentImpl = () =>
      mockSettingsDocument({
        runRetentionDays: 30,
        taggerModel: "kept/tagger",
        scorerModel: "kept/scorer",
        drafterModel: "kept/drafter",
        embedderModel: "kept/embedder",
      }) as never;

    await expectSettingsError(
      updateGlobalModelDefaults(client, {
        taggerModel: "openai/gpt-4o-mini",
        scorerModel: "not-a-valid-id",
        drafterModel: "google/gemini-2.0-flash",
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
      embedderModel: freeId,
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const data = docs.updateDocumentCalls[0]!.data;
    expect(data.taggerModel).toBe(freeId);
    expect(data.scorerModel).toBe(freeId);
    expect(data.drafterModel).toBe(freeId);
    expect(data.embedderModel).toBe(freeId);

    expect(settings.taggerModel).toBe(freeId);
    expect(settings.scorerModel).toBe(freeId);
    expect(settings.drafterModel).toBe(freeId);
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
