import { describe, it, expect } from "vitest";
import type { Client } from "node-appwrite";
import { DEFAULT_SCORE_THRESHOLD } from "../../pipeline/config";
import { RSS_FEED_MAX_ITEMS } from "../../schema/declarations";
import { resolveOperatorSettings } from "../resolve-operator-settings";
import type { AppSettings } from "../types";

/** Injected settings shape for resolve tests (Stage 12 fields + existing singleton fields). */
type OperatorAppSettings = AppSettings & {
  openRouterApiKey: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpUsername: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: string;
  appPublicUrl: string;
  scoreThreshold: number | null;
  crossRunSimilarityThreshold: number | null;
  rssFeedMaxItems: number | null;
  drafterReasoningEffort: string;
  drafterMaxCompletionTokens: number | null;
};

const DEFAULT_CROSS_RUN_SIMILARITY = 0.85;
const DEFAULT_DRAFTER_REASONING = "high";
const DEFAULT_DRAFTER_MAX_TOKENS = 32000;

function clearedSettings(
  overrides: Partial<OperatorAppSettings> = {},
): OperatorAppSettings {
  return {
    runRetentionDays: 30,
    updatedAt: "2026-01-01T00:00:00.000Z",
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

/** Resolve tests inject settings/env — client is unused when settings is provided. */
const fakeClient = {} as Client;

describe("resolveOperatorSettings", () => {
  it("uses code defaults with source default when GUI and env are unset", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {},
    });

    expect(resolved.openRouterApiKey).toEqual({ value: null, source: "none" });
    expect(resolved.smtp).toEqual({ value: null, source: "none" });
    expect(resolved.appPublicUrl).toEqual({ value: null, source: "none" });
    expect(resolved.scoreThreshold).toEqual({
      value: DEFAULT_SCORE_THRESHOLD,
      source: "default",
    });
    expect(resolved.crossRunSimilarityThreshold).toEqual({
      value: DEFAULT_CROSS_RUN_SIMILARITY,
      source: "default",
    });
    expect(resolved.rssFeedMaxItems).toEqual({
      value: RSS_FEED_MAX_ITEMS,
      source: "default",
    });
    expect(resolved.drafterReasoningEffort).toEqual({
      value: DEFAULT_DRAFTER_REASONING,
      source: "default",
    });
    expect(resolved.drafterMaxCompletionTokens).toEqual({
      value: DEFAULT_DRAFTER_MAX_TOKENS,
      source: "default",
    });
  });

  it("GUI overrides win over env and default with source gui", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings({
        openRouterApiKey: "sk-or-gui",
        smtpHost: "smtp.gui.example",
        smtpPort: 465,
        smtpUsername: "gui-user",
        smtpPassword: "gui-pass",
        smtpFrom: "gui@example.com",
        smtpSecure: "true",
        appPublicUrl: "https://gui.example.com",
        scoreThreshold: 8.5,
        crossRunSimilarityThreshold: 0.7,
        rssFeedMaxItems: 20,
        drafterReasoningEffort: "low",
        drafterMaxCompletionTokens: 4096,
      }),
      env: {
        OPENROUTER_API_KEY: "sk-or-env",
        SMTP_HOST: "smtp.env.example",
        SMTP_PORT: "587",
        SMTP_USERNAME: "env-user",
        SMTP_PASSWORD: "env-pass",
        SMTP_FROM: "env@example.com",
        SMTP_SECURE: "false",
        APP_PUBLIC_URL: "https://env.example.com",
        SCORE_THRESHOLD: "6",
        CROSS_RUN_SIMILARITY_THRESHOLD: "0.5",
        RSS_FEED_MAX_ITEMS: "5",
        DRAFTER_REASONING_EFFORT: "medium",
        DRAFTER_MAX_COMPLETION_TOKENS: "8000",
      },
    });

    expect(resolved.openRouterApiKey).toEqual({ value: "sk-or-gui", source: "gui" });
    expect(resolved.smtp.source).toBe("gui");
    expect(resolved.smtp.value).toEqual({
      host: "smtp.gui.example",
      port: 465,
      username: "gui-user",
      password: "gui-pass",
      from: "gui@example.com",
      secure: true,
    });
    expect(resolved.appPublicUrl).toEqual({
      value: "https://gui.example.com",
      source: "gui",
    });
    expect(resolved.scoreThreshold).toEqual({ value: 8.5, source: "gui" });
    expect(resolved.crossRunSimilarityThreshold).toEqual({ value: 0.7, source: "gui" });
    expect(resolved.rssFeedMaxItems).toEqual({ value: 20, source: "gui" });
    expect(resolved.drafterReasoningEffort).toEqual({ value: "low", source: "gui" });
    expect(resolved.drafterMaxCompletionTokens).toEqual({ value: 4096, source: "gui" });
  });

  it("falls through blank GUI overrides to in-range env with source env", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {
        OPENROUTER_API_KEY: "sk-or-env",
        SMTP_HOST: "smtp.env.example",
        SMTP_PORT: "587",
        SMTP_USERNAME: "env-user",
        SMTP_PASSWORD: "env-pass",
        SMTP_FROM: "env@example.com",
        SMTP_SECURE: "1",
        APP_PUBLIC_URL: "https://env.example.com/",
        SCORE_THRESHOLD: "6.5",
        CROSS_RUN_SIMILARITY_THRESHOLD: "0.6",
        RSS_FEED_MAX_ITEMS: "15",
        DRAFTER_REASONING_EFFORT: "medium",
        DRAFTER_MAX_COMPLETION_TOKENS: "8192",
      },
    });

    expect(resolved.openRouterApiKey).toEqual({ value: "sk-or-env", source: "env" });
    expect(resolved.smtp.source).toBe("env");
    expect(resolved.smtp.value).toEqual({
      host: "smtp.env.example",
      port: 587,
      username: "env-user",
      password: "env-pass",
      from: "env@example.com",
      secure: true,
    });
    expect(resolved.appPublicUrl).toEqual({
      value: "https://env.example.com",
      source: "env",
    });
    expect(resolved.scoreThreshold).toEqual({ value: 6.5, source: "env" });
    expect(resolved.crossRunSimilarityThreshold).toEqual({ value: 0.6, source: "env" });
    expect(resolved.rssFeedMaxItems).toEqual({ value: 15, source: "env" });
    expect(resolved.drafterReasoningEffort).toEqual({ value: "medium", source: "env" });
    expect(resolved.drafterMaxCompletionTokens).toEqual({ value: 8192, source: "env" });
  });

  it("incomplete GUI SMTP quartet falls through to env for the whole SMTP bundle", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings({
        // password-only / incomplete — must NOT mix with env host
        smtpPassword: "gui-only-password",
        smtpFrom: "orphan-gui@example.com",
      }),
      env: {
        SMTP_HOST: "smtp.env.example",
        SMTP_PORT: "587",
        SMTP_USERNAME: "env-user",
        SMTP_PASSWORD: "env-pass",
        SMTP_FROM: "env@example.com",
      },
    });

    expect(resolved.smtp.source).toBe("env");
    expect(resolved.smtp.value).toEqual({
      host: "smtp.env.example",
      port: 587,
      username: "env-user",
      password: "env-pass",
      from: "env@example.com",
      secure: false,
    });
    // Never mix GUI password into env-resolved SMTP.
    expect(resolved.smtp.value?.password).not.toBe("gui-only-password");
  });

  it("out-of-range SCORE_THRESHOLD env falls through to default (not source env)", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {
        SCORE_THRESHOLD: "99",
      },
    });

    expect(resolved.scoreThreshold).toEqual({
      value: DEFAULT_SCORE_THRESHOLD,
      source: "default",
    });
  });

  it("out-of-range CROSS_RUN_SIMILARITY_THRESHOLD env falls through to default", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {
        CROSS_RUN_SIMILARITY_THRESHOLD: "2",
      },
    });

    expect(resolved.crossRunSimilarityThreshold).toEqual({
      value: DEFAULT_CROSS_RUN_SIMILARITY,
      source: "default",
    });
  });

  it("out-of-range RSS_FEED_MAX_ITEMS env falls through to default", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {
        RSS_FEED_MAX_ITEMS: "0",
      },
    });

    expect(resolved.rssFeedMaxItems).toEqual({
      value: RSS_FEED_MAX_ITEMS,
      source: "default",
    });
  });

  it("invalid DRAFTER_REASONING_EFFORT env falls through to default", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {
        DRAFTER_REASONING_EFFORT: "ultra",
      },
    });

    expect(resolved.drafterReasoningEffort).toEqual({
      value: DEFAULT_DRAFTER_REASONING,
      source: "default",
    });
  });

  it("out-of-range DRAFTER_MAX_COMPLETION_TOKENS env falls through to default", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings(),
      env: {
        DRAFTER_MAX_COMPLETION_TOKENS: "100",
      },
    });

    expect(resolved.drafterMaxCompletionTokens).toEqual({
      value: DEFAULT_DRAFTER_MAX_TOKENS,
      source: "default",
    });
  });

  it("whitespace-only GUI string overrides fall through to env", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings({
        openRouterApiKey: "   ",
        appPublicUrl: "\t",
      }),
      env: {
        OPENROUTER_API_KEY: "sk-or-env",
        APP_PUBLIC_URL: "https://env.example.com",
      },
    });

    expect(resolved.openRouterApiKey).toEqual({ value: "sk-or-env", source: "env" });
    expect(resolved.appPublicUrl).toEqual({
      value: "https://env.example.com",
      source: "env",
    });
  });

  it("SMTP from falls back to username when GUI bundle omits from", async () => {
    const resolved = await resolveOperatorSettings(fakeClient, {
      settings: clearedSettings({
        smtpHost: "smtp.gui.example",
        smtpPort: 587,
        smtpUsername: "gui-user",
        smtpPassword: "gui-pass",
        smtpFrom: "",
        smtpSecure: "",
      }),
      env: {},
    });

    expect(resolved.smtp.source).toBe("gui");
    expect(resolved.smtp.value?.from).toBe("gui-user");
    expect(resolved.smtp.value?.secure).toBe(false);
  });

  /**
   * T1: typed-invalid GUI knobs must never win as source "gui".
   * Inject AppSettings directly (bypass repository mapping) so tryGui* fallthrough
   * is proven even when Task 4 would have unset these on read.
   */
  describe("T1 typed-invalid GUI knobs fall through (tryGui*)", () => {
    /** Same-type but out-of-range / invalid-enum values that mapping would unset. */
    const typedInvalidGui = {
      scoreThreshold: 99,
      crossRunSimilarityThreshold: 2,
      rssFeedMaxItems: 0,
      drafterReasoningEffort: "ultra",
      drafterMaxCompletionTokens: 100,
    } as const;

    it("invalid GUI + valid env → source env (never gui) for each Stage 12 pipeline knob", async () => {
      const resolved = await resolveOperatorSettings(fakeClient, {
        settings: clearedSettings({ ...typedInvalidGui }),
        env: {
          SCORE_THRESHOLD: "6.5",
          CROSS_RUN_SIMILARITY_THRESHOLD: "0.6",
          RSS_FEED_MAX_ITEMS: "15",
          DRAFTER_REASONING_EFFORT: "medium",
          DRAFTER_MAX_COMPLETION_TOKENS: "8192",
        },
      });

      expect(resolved.scoreThreshold).toEqual({ value: 6.5, source: "env" });
      expect(resolved.crossRunSimilarityThreshold).toEqual({
        value: 0.6,
        source: "env",
      });
      expect(resolved.rssFeedMaxItems).toEqual({ value: 15, source: "env" });
      expect(resolved.drafterReasoningEffort).toEqual({
        value: "medium",
        source: "env",
      });
      expect(resolved.drafterMaxCompletionTokens).toEqual({
        value: 8192,
        source: "env",
      });
    });

    it("invalid GUI + no env → source default (never gui) for each Stage 12 pipeline knob", async () => {
      const resolved = await resolveOperatorSettings(fakeClient, {
        settings: clearedSettings({ ...typedInvalidGui }),
        env: {},
      });

      expect(resolved.scoreThreshold).toEqual({
        value: DEFAULT_SCORE_THRESHOLD,
        source: "default",
      });
      expect(resolved.crossRunSimilarityThreshold).toEqual({
        value: DEFAULT_CROSS_RUN_SIMILARITY,
        source: "default",
      });
      expect(resolved.rssFeedMaxItems).toEqual({
        value: RSS_FEED_MAX_ITEMS,
        source: "default",
      });
      expect(resolved.drafterReasoningEffort).toEqual({
        value: DEFAULT_DRAFTER_REASONING,
        source: "default",
      });
      expect(resolved.drafterMaxCompletionTokens).toEqual({
        value: DEFAULT_DRAFTER_MAX_TOKENS,
        source: "default",
      });
    });

    it("non-integer GUI rssFeedMaxItems / drafterMaxCompletionTokens fall through", async () => {
      const withEnv = await resolveOperatorSettings(fakeClient, {
        settings: clearedSettings({
          rssFeedMaxItems: 12.5,
          drafterMaxCompletionTokens: 2048.5,
        }),
        env: {
          RSS_FEED_MAX_ITEMS: "10",
          DRAFTER_MAX_COMPLETION_TOKENS: "4096",
        },
      });
      expect(withEnv.rssFeedMaxItems).toEqual({ value: 10, source: "env" });
      expect(withEnv.drafterMaxCompletionTokens).toEqual({
        value: 4096,
        source: "env",
      });

      const withoutEnv = await resolveOperatorSettings(fakeClient, {
        settings: clearedSettings({
          rssFeedMaxItems: 12.5,
          drafterMaxCompletionTokens: 2048.5,
        }),
        env: {},
      });
      expect(withoutEnv.rssFeedMaxItems).toEqual({
        value: RSS_FEED_MAX_ITEMS,
        source: "default",
      });
      expect(withoutEnv.drafterMaxCompletionTokens).toEqual({
        value: DEFAULT_DRAFTER_MAX_TOKENS,
        source: "default",
      });
    });
  });
});
