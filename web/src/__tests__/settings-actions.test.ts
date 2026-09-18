import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SettingsRepositoryError,
  type AppSettings,
  type PublicAppSettings,
} from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  getOrCreateAppSettings: vi.fn(),
  updateConnectionSettings: vi.fn(),
  updatePipelineKnobsSettings: vi.fn(),
  clearOpenRouterApiKeyOverride: vi.fn(),
  clearSmtpBundleOverride: vi.fn(),
  getServerAppwrite: vi.fn(),
  revalidatePath: vi.fn(),
  requireOperator: vi.fn(),
  user: { $id: "user-1", email: "op@example.com", labels: ["operator"] },
  client: { $id: "mock-client" },
}));

vi.mock("@/lib/auth/require-operator", () => ({
  requireOperator: mocks.requireOperator,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getOrCreateAppSettings: mocks.getOrCreateAppSettings,
    updateConnectionSettings: mocks.updateConnectionSettings,
    updatePipelineKnobsSettings: mocks.updatePipelineKnobsSettings,
    clearOpenRouterApiKeyOverride: mocks.clearOpenRouterApiKeyOverride,
    clearSmtpBundleOverride: mocks.clearSmtpBundleOverride,
    getServerAppwrite: mocks.getServerAppwrite,
  };
});

import {
  clearOpenRouterOverrideAction,
  clearSmtpOverrideAction,
  saveConnectionsSettingsAction,
  savePipelineKnobsSettingsAction,
} from "@/app/(protected)/admin/settings/actions";

const STORED_SECRET_KEY = "sk-or-stored-secret-value";
const STORED_SMTP_PASSWORD = "stored-smtp-password-value";

const BASE_SETTINGS: AppSettings = {
  runRetentionDays: 30,
  updatedAt: "2026-08-11T12:00:00.000Z",
  taggerModel: "",
  scorerModel: "",
  drafterModel: "",
  embedderModel: "",
  titleDekModel: "",
  openRouterApiKey: STORED_SECRET_KEY,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "ops@example.com",
  smtpPassword: STORED_SMTP_PASSWORD,
  smtpFrom: "news@example.com",
  smtpSecure: "true",
  appPublicUrl: "https://app.example.com",
  scoreThreshold: 5,
  crossRunSimilarityThreshold: 0.85,
  rssFeedMaxItems: 20,
  drafterReasoningEffort: "medium",
  drafterMaxCompletionTokens: 4096,
};

function toPublic(settings: AppSettings): PublicAppSettings {
  const { openRouterApiKey, smtpPassword, ...rest } = settings;
  return {
    ...rest,
    hasOpenRouterApiKey: openRouterApiKey.trim() !== "",
    hasSmtpPassword: smtpPassword.trim() !== "",
  };
}

function assertNoStoredSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(STORED_SECRET_KEY);
  expect(serialized).not.toContain(STORED_SMTP_PASSWORD);
}

const CONNECTIONS_KEEP_INPUT = {
  openRouterApiKey: "",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "ops@example.com",
  smtpPassword: "",
  smtpFrom: "news@example.com",
  smtpSecure: "true",
  appPublicUrl: "https://app.example.com",
};

beforeEach(() => {
  mocks.getOrCreateAppSettings.mockReset();
  mocks.updateConnectionSettings.mockReset();
  mocks.updatePipelineKnobsSettings.mockReset();
  mocks.clearOpenRouterApiKeyOverride.mockReset();
  mocks.clearSmtpBundleOverride.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.requireOperator.mockReset();
  mocks.requireOperator.mockResolvedValue(mocks.user);
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.getOrCreateAppSettings.mockResolvedValue({ ...BASE_SETTINGS });
  mocks.updateConnectionSettings.mockResolvedValue(toPublic(BASE_SETTINGS));
  mocks.updatePipelineKnobsSettings.mockResolvedValue(toPublic(BASE_SETTINGS));
  mocks.clearOpenRouterApiKeyOverride.mockResolvedValue(toPublic({ ...BASE_SETTINGS, openRouterApiKey: "" }));
  mocks.clearSmtpBundleOverride.mockResolvedValue(
    toPublic({
      ...BASE_SETTINGS,
      smtpHost: "",
      smtpPort: null,
      smtpUsername: "",
      smtpPassword: "",
      smtpFrom: "",
      smtpSecure: "",
    }),
  );
});

describe("saveConnectionsSettingsAction — sentinel (empty → keep stored)", () => {
  it("passes empty masked secrets through untouched and never reads current settings", async () => {
    const result = await saveConnectionsSettingsAction(CONNECTIONS_KEEP_INPUT);

    expect(result.ok).toBe(true);
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.updateConnectionSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateConnectionSettings).toHaveBeenCalledWith(mocks.client, CONNECTIONS_KEEP_INPUT);

    const payload = mocks.updateConnectionSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.openRouterApiKey).toBe("");
    expect(payload.smtpPassword).toBe("");
    expect(payload.openRouterApiKey).not.toBe(STORED_SECRET_KEY);
    expect(payload.smtpPassword).not.toBe(STORED_SMTP_PASSWORD);
    expect(payload).not.toHaveProperty("scoreThreshold");
    expect(payload).not.toHaveProperty("crossRunSimilarityThreshold");
    expect(payload).not.toHaveProperty("rssFeedMaxItems");
    expect(payload).not.toHaveProperty("drafterReasoningEffort");
    expect(payload).not.toHaveProperty("drafterMaxCompletionTokens");
    assertNoStoredSecrets(payload);
    assertNoStoredSecrets(result);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });
});

describe("clear overrides — dedicated writers (not empty→keep)", () => {
  it("clearOpenRouterOverrideAction calls clearOpenRouterApiKeyOverride and does not read settings", async () => {
    const result = await clearOpenRouterOverrideAction();

    expect(result.ok).toBe(true);
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.updateConnectionSettings).not.toHaveBeenCalled();
    expect(mocks.clearOpenRouterApiKeyOverride).toHaveBeenCalledTimes(1);
    expect(mocks.clearOpenRouterApiKeyOverride).toHaveBeenCalledWith(mocks.client);
    assertNoStoredSecrets(result);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("clearSmtpOverrideAction calls clearSmtpBundleOverride and does not read settings", async () => {
    const result = await clearSmtpOverrideAction();

    expect(result.ok).toBe(true);
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.updateConnectionSettings).not.toHaveBeenCalled();
    expect(mocks.clearSmtpBundleOverride).toHaveBeenCalledTimes(1);
    expect(mocks.clearSmtpBundleOverride).toHaveBeenCalledWith(mocks.client);
    assertNoStoredSecrets(result);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("empty secret fields on Connections save must not be the Clear path", async () => {
    await saveConnectionsSettingsAction(CONNECTIONS_KEEP_INPUT);

    expect(mocks.clearOpenRouterApiKeyOverride).not.toHaveBeenCalled();
    expect(mocks.clearSmtpBundleOverride).not.toHaveBeenCalled();
    const keepPayload = mocks.updateConnectionSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(keepPayload.openRouterApiKey).toBe("");
    expect(keepPayload.smtpPassword).toBe("");

    mocks.updateConnectionSettings.mockClear();
    await clearOpenRouterOverrideAction();
    expect(mocks.clearOpenRouterApiKeyOverride).toHaveBeenCalledTimes(1);
    expect(mocks.updateConnectionSettings).not.toHaveBeenCalled();
  });
});

describe("section isolation", () => {
  it("Connections save never reads current settings and never sends knob fields", async () => {
    await saveConnectionsSettingsAction({
      openRouterApiKey: "sk-or-new-key",
      smtpHost: "smtp.new.example",
      smtpPort: 465,
      smtpUsername: "new@example.com",
      smtpPassword: "new-pass",
      smtpFrom: "from@example.com",
      smtpSecure: "true",
      appPublicUrl: "https://new.example.com",
    });

    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.updatePipelineKnobsSettings).not.toHaveBeenCalled();
    expect(mocks.updateConnectionSettings).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        openRouterApiKey: "sk-or-new-key",
        smtpHost: "smtp.new.example",
        smtpPort: 465,
        smtpUsername: "new@example.com",
        smtpPassword: "new-pass",
        smtpFrom: "from@example.com",
        smtpSecure: "true",
        appPublicUrl: "https://new.example.com",
      }),
    );
    const payload = mocks.updateConnectionSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("scoreThreshold");
    expect(payload).not.toHaveProperty("crossRunSimilarityThreshold");
    expect(payload).not.toHaveProperty("rssFeedMaxItems");
    expect(payload).not.toHaveProperty("drafterReasoningEffort");
    expect(payload).not.toHaveProperty("drafterMaxCompletionTokens");
    assertNoStoredSecrets(payload);
  });

  it("Knobs save calls updatePipelineKnobsSettings without reading or sending connection secrets", async () => {
    const knobs = {
      scoreThreshold: 3,
      crossRunSimilarityThreshold: 0.5,
      rssFeedMaxItems: 12,
      drafterReasoningEffort: "low",
      drafterMaxCompletionTokens: 1024,
    };

    const result = await savePipelineKnobsSettingsAction(knobs);

    expect(result.ok).toBe(true);
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.updateConnectionSettings).not.toHaveBeenCalled();
    expect(mocks.updatePipelineKnobsSettings).toHaveBeenCalledWith(mocks.client, knobs);
    const payload = mocks.updatePipelineKnobsSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("openRouterApiKey");
    expect(payload).not.toHaveProperty("smtpPassword");
    expect(payload).not.toHaveProperty("smtpHost");
    expect(payload).not.toHaveProperty("appPublicUrl");
    assertNoStoredSecrets(payload);
    assertNoStoredSecrets(result);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });
});

describe("numeric zero round-trip", () => {
  it("saving scoreThreshold: 0 and crossRunSimilarityThreshold: 0 persists 0 (not clear)", async () => {
    await savePipelineKnobsSettingsAction({
      scoreThreshold: 0,
      crossRunSimilarityThreshold: 0,
      rssFeedMaxItems: null,
      drafterReasoningEffort: "",
      drafterMaxCompletionTokens: null,
    });

    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.updatePipelineKnobsSettings).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        scoreThreshold: 0,
        crossRunSimilarityThreshold: 0,
        rssFeedMaxItems: null,
        drafterReasoningEffort: "",
        drafterMaxCompletionTokens: null,
      }),
    );
    const payload = mocks.updatePipelineKnobsSettings.mock.calls[0]![1] as {
      scoreThreshold: number | null;
      crossRunSimilarityThreshold: number | null;
    };
    expect(payload.scoreThreshold).toBe(0);
    expect(payload.crossRunSimilarityThreshold).toBe(0);
    expect(payload.scoreThreshold).not.toBeNull();
    expect(payload.crossRunSimilarityThreshold).not.toBeNull();
  });
});

describe("validation mapping", () => {
  it("SettingsRepositoryError validation → ok:false with message; no revalidate", async () => {
    mocks.updateConnectionSettings.mockRejectedValue(
      new SettingsRepositoryError(
        "validation",
        "SMTP settings must be a complete host/port/username/password set, or all cleared",
      ),
    );

    const result = await saveConnectionsSettingsAction({
      openRouterApiKey: "",
      smtpHost: "smtp.example.com",
      smtpPort: null,
      smtpUsername: "",
      smtpPassword: "",
      smtpFrom: "",
      smtpSecure: "",
      appPublicUrl: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "SMTP settings must be a complete host/port/username/password set, or all cleared",
    });
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    assertNoStoredSecrets(result);
  });

  it("unknown failures return generic operator-safe error without secret values", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updatePipelineKnobsSettings.mockRejectedValue(
      new SettingsRepositoryError(
        "appwrite",
        "Something went wrong while talking to the database. Please try again.",
      ),
    );

    const result = await savePipelineKnobsSettingsAction({
      scoreThreshold: 1,
      crossRunSimilarityThreshold: 0.1,
      rssFeedMaxItems: 5,
      drafterReasoningEffort: "medium",
      drafterMaxCompletionTokens: 2048,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(STORED_SECRET_KEY);
      expect(result.error).not.toContain(STORED_SMTP_PASSWORD);
      expect(result.error.length).toBeGreaterThan(0);
    }
    expect(mocks.getOrCreateAppSettings).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("failure logs exclude OpenRouter key and short SMTP password (no raw err dump)", async () => {
    const FAKE_KEY = "sk-or-TESTSECRET";
    const SHORT_SMTP_PASSWORD = "hunter2";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateConnectionSettings.mockRejectedValue(
      new SettingsRepositoryError(
        "appwrite",
        `Appwrite update failed key=${FAKE_KEY} password=${SHORT_SMTP_PASSWORD}`,
      ),
    );

    const result = await saveConnectionsSettingsAction(CONNECTIONS_KEEP_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(FAKE_KEY);
      expect(result.error).not.toContain(SHORT_SMTP_PASSWORD);
    }
    assertNoStoredSecrets(result);

    const logged = consoleError.mock.calls
      .flat()
      .map((arg) => {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join("\n");

    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain(SHORT_SMTP_PASSWORD);
    expect(consoleError.mock.calls.some((call) => call.some((a) => a instanceof Error))).toBe(
      false,
    );
    consoleError.mockRestore();
  });
});
