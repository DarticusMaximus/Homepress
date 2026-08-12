import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsRepositoryError, type AppSettings } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  getOrCreateAppSettings: vi.fn(),
  updateOperatorSettings: vi.fn(),
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
    getOrCreateAppSettings: mocks.getOrCreateAppSettings,
    updateOperatorSettings: mocks.updateOperatorSettings,
    getServerAppwrite: mocks.getServerAppwrite,
  };
});

import {
  clearOpenRouterOverrideAction,
  clearSmtpOverrideAction,
  saveConnectionsSettingsAction,
  savePipelineKnobsSettingsAction,
} from "@/app/(protected)/settings/actions";
import { toSettingsPanelData } from "@/lib/settings-panel";

const STORED_SECRET_KEY = "sk-or-stored-secret-value";
const STORED_SMTP_PASSWORD = "stored-smtp-password-value";

const BASE_SETTINGS: AppSettings = {
  runRetentionDays: 30,
  updatedAt: "2026-08-11T12:00:00.000Z",
  taggerModel: "",
  scorerModel: "",
  drafterModel: "",
  embedderModel: "",
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

beforeEach(() => {
  mocks.getOrCreateAppSettings.mockReset();
  mocks.updateOperatorSettings.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.getOrCreateAppSettings.mockResolvedValue({ ...BASE_SETTINGS });
  mocks.updateOperatorSettings.mockResolvedValue({ ...BASE_SETTINGS });
});

describe("toSettingsPanelData — secret strip", () => {
  it("never includes openRouterApiKey or smtpPassword string values; booleans reflect GUI presence", () => {
    const resolved = {
      openRouterApiKey: { value: STORED_SECRET_KEY, source: "gui" as const },
      smtp: {
        value: {
          host: "smtp.example.com",
          port: 587,
          username: "ops@example.com",
          password: STORED_SMTP_PASSWORD,
          from: "news@example.com",
          secure: true,
        },
        source: "gui" as const,
      },
      appPublicUrl: { value: "https://app.example.com", source: "gui" as const },
      scoreThreshold: { value: 5, source: "gui" as const },
      crossRunSimilarityThreshold: { value: 0.85, source: "gui" as const },
      rssFeedMaxItems: { value: 20, source: "gui" as const },
      drafterReasoningEffort: { value: "medium" as const, source: "gui" as const },
      drafterMaxCompletionTokens: { value: 4096, source: "gui" as const },
    };

    const dto = toSettingsPanelData(BASE_SETTINGS, resolved);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain(STORED_SECRET_KEY);
    expect(serialized).not.toContain(STORED_SMTP_PASSWORD);
    expect(dto).not.toHaveProperty("openRouterApiKey");
    expect(dto).not.toHaveProperty("smtpPassword");
    expect(dto.openRouterApiKeySet).toBe(true);
    expect(dto.smtpPasswordSet).toBe(true);
    expect(dto.resolved.openRouterApiKey).toEqual({ source: "gui" });
    expect(dto.resolved.openRouterApiKey).not.toHaveProperty("value");
    expect(dto.resolved.smtp).not.toHaveProperty("password");
    expect(dto.resolved.smtp.source).toBe("gui");
  });

  it("marks secrets unset when GUI overrides are empty", () => {
    const unset: AppSettings = {
      ...BASE_SETTINGS,
      openRouterApiKey: "",
      smtpPassword: "",
      smtpHost: "",
      smtpPort: null,
      smtpUsername: "",
      smtpFrom: "",
      smtpSecure: "",
    };
    const resolved = {
      openRouterApiKey: { value: null, source: "none" as const },
      smtp: { value: null, source: "none" as const },
      appPublicUrl: { value: null, source: "none" as const },
      scoreThreshold: { value: 7, source: "default" as const },
      crossRunSimilarityThreshold: { value: 0.85, source: "default" as const },
      rssFeedMaxItems: { value: 10, source: "default" as const },
      drafterReasoningEffort: { value: "medium" as const, source: "default" as const },
      drafterMaxCompletionTokens: { value: 8192, source: "default" as const },
    };

    const dto = toSettingsPanelData(unset, resolved);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain(STORED_SECRET_KEY);
    expect(serialized).not.toContain(STORED_SMTP_PASSWORD);
    expect(dto).not.toHaveProperty("openRouterApiKey");
    expect(dto).not.toHaveProperty("smtpPassword");
    expect(dto.openRouterApiKeySet).toBe(false);
    expect(dto.smtpPasswordSet).toBe(false);
    expect(dto.resolved.openRouterApiKey).not.toHaveProperty("value");
    expect(dto.resolved.smtp).not.toHaveProperty("password");
  });
});

describe("saveConnectionsSettingsAction — secret merge (empty → keep)", () => {
  it("empty masked secrets call updateOperatorSettings with prior stored secrets", async () => {
    const result = await saveConnectionsSettingsAction({
      openRouterApiKey: "",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUsername: "ops@example.com",
      smtpPassword: "",
      smtpFrom: "news@example.com",
      smtpSecure: "true",
      appPublicUrl: "https://app.example.com",
    });

    expect(result.ok).toBe(true);
    expect(mocks.getOrCreateAppSettings).toHaveBeenCalledWith(mocks.client);
    expect(mocks.updateOperatorSettings).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        openRouterApiKey: STORED_SECRET_KEY,
        smtpPassword: STORED_SMTP_PASSWORD,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "ops@example.com",
        smtpFrom: "news@example.com",
        smtpSecure: "true",
        appPublicUrl: "https://app.example.com",
        // Section isolation: knobs preserved from current settings
        scoreThreshold: BASE_SETTINGS.scoreThreshold,
        crossRunSimilarityThreshold: BASE_SETTINGS.crossRunSimilarityThreshold,
        rssFeedMaxItems: BASE_SETTINGS.rssFeedMaxItems,
        drafterReasoningEffort: BASE_SETTINGS.drafterReasoningEffort,
        drafterMaxCompletionTokens: BASE_SETTINGS.drafterMaxCompletionTokens,
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    if (result.ok) {
      expect(JSON.stringify(result)).not.toContain(STORED_SECRET_KEY);
      expect(JSON.stringify(result)).not.toContain(STORED_SMTP_PASSWORD);
    }
  });
});

describe("clear overrides — immediate Clear (not empty→keep)", () => {
  it("clearOpenRouterOverrideAction writes empty string and does not keep-merge the prior key", async () => {
    const result = await clearOpenRouterOverrideAction();

    expect(result.ok).toBe(true);
    expect(mocks.updateOperatorSettings).toHaveBeenCalledTimes(1);
    const payload = mocks.updateOperatorSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.openRouterApiKey).toBe("");
    expect(payload.openRouterApiKey).not.toBe(STORED_SECRET_KEY);
    // Other Stage-12 fields preserved (including SMTP secrets)
    expect(payload.smtpPassword).toBe(STORED_SMTP_PASSWORD);
    expect(payload.scoreThreshold).toBe(BASE_SETTINGS.scoreThreshold);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("clearSmtpOverrideAction writes clear-all-six and does not keep-merge SMTP password", async () => {
    const result = await clearSmtpOverrideAction();

    expect(result.ok).toBe(true);
    expect(mocks.updateOperatorSettings).toHaveBeenCalledTimes(1);
    const payload = mocks.updateOperatorSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        smtpHost: "",
        smtpPort: null,
        smtpUsername: "",
        smtpPassword: "",
        smtpFrom: "",
        smtpSecure: "",
        openRouterApiKey: STORED_SECRET_KEY,
        scoreThreshold: BASE_SETTINGS.scoreThreshold,
      }),
    );
    expect(payload.smtpPassword).not.toBe(STORED_SMTP_PASSWORD);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("empty secret fields on Connections save must not be the Clear path (keep still applies)", async () => {
    await saveConnectionsSettingsAction({
      openRouterApiKey: "",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUsername: "ops@example.com",
      smtpPassword: "",
      smtpFrom: "news@example.com",
      smtpSecure: "true",
      appPublicUrl: "https://app.example.com",
    });

    const keepPayload = mocks.updateOperatorSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(keepPayload.openRouterApiKey).toBe(STORED_SECRET_KEY);
    expect(keepPayload.smtpPassword).toBe(STORED_SMTP_PASSWORD);

    mocks.updateOperatorSettings.mockClear();
    await clearOpenRouterOverrideAction();
    const clearPayload = mocks.updateOperatorSettings.mock.calls[0]![1] as Record<string, unknown>;
    expect(clearPayload.openRouterApiKey).toBe("");
    expect(clearPayload.openRouterApiKey).not.toBe(keepPayload.openRouterApiKey);
  });
});

describe("section isolation", () => {
  it("Connections save preserves knob overrides from current settings", async () => {
    mocks.getOrCreateAppSettings.mockResolvedValue({
      ...BASE_SETTINGS,
      scoreThreshold: 0,
      crossRunSimilarityThreshold: 0,
      rssFeedMaxItems: 7,
      drafterReasoningEffort: "high",
      drafterMaxCompletionTokens: 2048,
    });

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

    expect(mocks.updateOperatorSettings).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        openRouterApiKey: "sk-or-new-key",
        smtpHost: "smtp.new.example",
        scoreThreshold: 0,
        crossRunSimilarityThreshold: 0,
        rssFeedMaxItems: 7,
        drafterReasoningEffort: "high",
        drafterMaxCompletionTokens: 2048,
      }),
    );
  });

  it("Knobs save preserves connection overrides from current settings", async () => {
    await savePipelineKnobsSettingsAction({
      scoreThreshold: 3,
      crossRunSimilarityThreshold: 0.5,
      rssFeedMaxItems: 12,
      drafterReasoningEffort: "low",
      drafterMaxCompletionTokens: 1024,
    });

    expect(mocks.updateOperatorSettings).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        scoreThreshold: 3,
        crossRunSimilarityThreshold: 0.5,
        rssFeedMaxItems: 12,
        drafterReasoningEffort: "low",
        drafterMaxCompletionTokens: 1024,
        openRouterApiKey: STORED_SECRET_KEY,
        smtpHost: BASE_SETTINGS.smtpHost,
        smtpPort: BASE_SETTINGS.smtpPort,
        smtpUsername: BASE_SETTINGS.smtpUsername,
        smtpPassword: STORED_SMTP_PASSWORD,
        smtpFrom: BASE_SETTINGS.smtpFrom,
        smtpSecure: BASE_SETTINGS.smtpSecure,
        appPublicUrl: BASE_SETTINGS.appPublicUrl,
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
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

    expect(mocks.updateOperatorSettings).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        scoreThreshold: 0,
        crossRunSimilarityThreshold: 0,
        rssFeedMaxItems: null,
        drafterReasoningEffort: "",
        drafterMaxCompletionTokens: null,
      }),
    );
    const payload = mocks.updateOperatorSettings.mock.calls[0]![1] as {
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
    mocks.updateOperatorSettings.mockRejectedValue(
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
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("unknown failures return generic operator-safe error without secret values", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateOperatorSettings.mockRejectedValue(
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
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("failure logs exclude OpenRouter key and short SMTP password (no raw err dump)", async () => {
    const FAKE_KEY = "sk-or-TESTSECRET";
    const SHORT_SMTP_PASSWORD = "hunter2";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateOperatorSettings.mockRejectedValue(
      new SettingsRepositoryError(
        "appwrite",
        `Appwrite update failed key=${FAKE_KEY} password=${SHORT_SMTP_PASSWORD}`,
      ),
    );

    const result = await saveConnectionsSettingsAction({
      openRouterApiKey: "",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUsername: "ops@example.com",
      smtpPassword: "",
      smtpFrom: "news@example.com",
      smtpSecure: "true",
      appPublicUrl: "https://app.example.com",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(FAKE_KEY);
      expect(result.error).not.toContain(SHORT_SMTP_PASSWORD);
    }

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
