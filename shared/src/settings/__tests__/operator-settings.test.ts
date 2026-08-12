import { describe, it, expect } from "vitest";
import {
  OPENROUTER_API_KEY_MAX_LENGTH,
  parseSmtpSecureFlag,
  validateOperatorSettings,
  type OperatorSettingsInput,
} from "../operator-settings";
import { SettingsRepositoryError } from "../types";

const CLEARED: OperatorSettingsInput = {
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
};

const COMPLETE_SMTP = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "smtp-user",
  smtpPassword: "smtp-secret-password",
  smtpFrom: "noreply@example.com",
  smtpSecure: "true",
} as const;

function expectValidation(fn: () => unknown): SettingsRepositoryError {
  try {
    fn();
    throw new Error("Expected SettingsRepositoryError with code validation");
  } catch (err) {
    expect(err).toBeInstanceOf(SettingsRepositoryError);
    const repoErr = err as SettingsRepositoryError;
    expect(repoErr.code).toBe("validation");
    return repoErr;
  }
}

describe("validateOperatorSettings", () => {
  it("accepts a full cleared object", () => {
    expect(validateOperatorSettings({ ...CLEARED })).toEqual({ ...CLEARED });
  });

  it("accepts a full valid Stage 12 object and normalizes", () => {
    expect(
      validateOperatorSettings({
        ...CLEARED,
        openRouterApiKey: "  sk-or-test-key  ",
        ...COMPLETE_SMTP,
        appPublicUrl: "https://press.example.com/",
        scoreThreshold: 7.5,
        crossRunSimilarityThreshold: 0.9,
        rssFeedMaxItems: 12,
        drafterReasoningEffort: "medium",
        drafterMaxCompletionTokens: 16000,
      }),
    ).toEqual({
      openRouterApiKey: "sk-or-test-key",
      ...COMPLETE_SMTP,
      appPublicUrl: "https://press.example.com",
      scoreThreshold: 7.5,
      crossRunSimilarityThreshold: 0.9,
      rssFeedMaxItems: 12,
      drafterReasoningEffort: "medium",
      drafterMaxCompletionTokens: 16000,
    });
  });

  it("treats whitespace-only strings and null numbers as clears", () => {
    expect(
      validateOperatorSettings({
        ...CLEARED,
        openRouterApiKey: "  \t  ",
        smtpFrom: "   ",
        smtpSecure: "\n",
        appPublicUrl: " ",
        drafterReasoningEffort: "\t",
      }),
    ).toEqual({ ...CLEARED });
  });

  it("strips trailing slash from appPublicUrl", () => {
    expect(
      validateOperatorSettings({
        ...CLEARED,
        appPublicUrl: "https://press.example.com/path///",
      }).appPublicUrl,
    ).toBe("https://press.example.com/path");
  });

  it("rejects incomplete SMTP quartet", () => {
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
      }),
    );
  });

  it("rejects SMTP with optional fields set but required quartet incomplete", () => {
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        smtpFrom: "noreply@example.com",
        smtpSecure: "true",
      }),
    );
  });

  it("accepts complete SMTP quartet with optional from/secure empty", () => {
    expect(
      validateOperatorSettings({
        ...CLEARED,
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpUsername: "user",
        smtpPassword: "secret",
      }),
    ).toMatchObject({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpUsername: "user",
      smtpPassword: "secret",
      smtpFrom: "",
      smtpSecure: "",
    });
  });

  it("rejects non-positive or non-integer SMTP port", () => {
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        smtpHost: "smtp.example.com",
        smtpPort: 0,
        smtpUsername: "user",
        smtpPassword: "secret",
      }),
    );
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        smtpHost: "smtp.example.com",
        smtpPort: 587.5,
        smtpUsername: "user",
        smtpPassword: "secret",
      }),
    );
  });

  it("rejects out-of-range scoreThreshold", () => {
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, scoreThreshold: 11 }),
    );
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, scoreThreshold: -0.1 }),
    );
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, scoreThreshold: Number.NaN }),
    );
  });

  it("rejects out-of-range crossRunSimilarityThreshold", () => {
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, crossRunSimilarityThreshold: 1.5 }),
    );
  });

  it("rejects out-of-range rssFeedMaxItems", () => {
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, rssFeedMaxItems: 0 }),
    );
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, rssFeedMaxItems: 51 }),
    );
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, rssFeedMaxItems: 3.5 }),
    );
  });

  it("rejects invalid drafterReasoningEffort", () => {
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, drafterReasoningEffort: "ultra" }),
    );
  });

  it("rejects out-of-range drafterMaxCompletionTokens", () => {
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, drafterMaxCompletionTokens: 512 }),
    );
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        drafterMaxCompletionTokens: 128_001,
      }),
    );
  });

  it("rejects non-absolute or non-http(s) appPublicUrl", () => {
    expectValidation(() =>
      validateOperatorSettings({ ...CLEARED, appPublicUrl: "not-a-url" }),
    );
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        appPublicUrl: "ftp://press.example.com",
      }),
    );
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        appPublicUrl: "//press.example.com",
      }),
    );
  });

  it("rejects OpenRouter key with whitespace/control or over max length", () => {
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        openRouterApiKey: "sk-or has space",
      }),
    );
    expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        openRouterApiKey: "a".repeat(OPENROUTER_API_KEY_MAX_LENGTH + 1),
      }),
    );
  });

  it("validation errors never include raw SMTP password or OpenRouter key", () => {
    const secretPassword = "smtp-super-secret-xyz";
    const secretKey = "sk-or-super-secret-xyz";

    const err = expectValidation(() =>
      validateOperatorSettings({
        ...CLEARED,
        openRouterApiKey: secretKey,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
        smtpPassword: secretPassword,
        scoreThreshold: 99,
      }),
    );
    expect(err.message).not.toContain(secretPassword);
    expect(err.message).not.toContain(secretKey);
  });

  it("boundary values at range edges are accepted", () => {
    expect(
      validateOperatorSettings({
        ...CLEARED,
        scoreThreshold: 0,
        crossRunSimilarityThreshold: 1,
        rssFeedMaxItems: 1,
        drafterReasoningEffort: "low",
        drafterMaxCompletionTokens: 1024,
      }),
    ).toMatchObject({
      scoreThreshold: 0,
      crossRunSimilarityThreshold: 1,
      rssFeedMaxItems: 1,
      drafterReasoningEffort: "low",
      drafterMaxCompletionTokens: 1024,
    });

    expect(
      validateOperatorSettings({
        ...CLEARED,
        scoreThreshold: 10,
        crossRunSimilarityThreshold: 0,
        rssFeedMaxItems: 50,
        drafterReasoningEffort: "high",
        drafterMaxCompletionTokens: 128_000,
      }),
    ).toMatchObject({
      scoreThreshold: 10,
      crossRunSimilarityThreshold: 0,
      rssFeedMaxItems: 50,
      drafterReasoningEffort: "high",
      drafterMaxCompletionTokens: 128_000,
    });
  });
});

describe("parseSmtpSecureFlag", () => {
  it("treats true/1/yes as true; empty/other as false", () => {
    expect(parseSmtpSecureFlag(undefined)).toBe(false);
    expect(parseSmtpSecureFlag(null)).toBe(false);
    expect(parseSmtpSecureFlag("")).toBe(false);
    expect(parseSmtpSecureFlag("false")).toBe(false);
    expect(parseSmtpSecureFlag("true")).toBe(true);
    expect(parseSmtpSecureFlag("TRUE")).toBe(true);
    expect(parseSmtpSecureFlag("1")).toBe(true);
    expect(parseSmtpSecureFlag("yes")).toBe(true);
    expect(parseSmtpSecureFlag(" YES ")).toBe(true);
  });
});
