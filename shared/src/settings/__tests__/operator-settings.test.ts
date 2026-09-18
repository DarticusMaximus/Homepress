import { describe, it, expect } from "vitest";
import {
  OPENROUTER_API_KEY_MAX_LENGTH,
  parseSmtpSecureFlag,
  validateAppPublicUrl,
  validateOpenRouterApiKey,
  validatePipelineKnobsSettings,
  validateSmtpBundle,
  type UpdatePipelineKnobsInput,
} from "../operator-settings";
import { SettingsRepositoryError } from "../types";

const CLEARED_SMTP = {
  smtpHost: "",
  smtpPort: null,
  smtpUsername: "",
  smtpPassword: "",
  smtpFrom: "",
  smtpSecure: "",
} as const;

const COMPLETE_SMTP = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "smtp-user",
  smtpPassword: "smtp-secret-password",
  smtpFrom: "noreply@example.com",
  smtpSecure: "true",
} as const;

const CLEARED_KNOBS: UpdatePipelineKnobsInput = {
  scoreThreshold: null,
  crossRunSimilarityThreshold: null,
  rssFeedMaxItems: null,
  drafterReasoningEffort: "",
  drafterMaxCompletionTokens: null,
};

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

describe("validateOpenRouterApiKey", () => {
  it("trims a valid key and treats whitespace-only as clear", () => {
    expect(validateOpenRouterApiKey("  sk-or-test-key  ")).toBe("sk-or-test-key");
    expect(validateOpenRouterApiKey("  \t  ")).toBe("");
    expect(validateOpenRouterApiKey("")).toBe("");
    expect(validateOpenRouterApiKey(null)).toBe("");
  });

  it("rejects keys with whitespace/control or over max length", () => {
    expectValidation(() => validateOpenRouterApiKey("sk-or has space"));
    expectValidation(() => validateOpenRouterApiKey("a".repeat(OPENROUTER_API_KEY_MAX_LENGTH + 1)));
  });

  it("validation errors never include the raw key", () => {
    const secretKey = "sk-or-super-secret-xyz";
    const err = expectValidation(() => validateOpenRouterApiKey(`${secretKey} has space`));
    expect(err.message).not.toContain(secretKey);
  });
});

describe("validateAppPublicUrl", () => {
  it("strips trailing slashes", () => {
    expect(validateAppPublicUrl("https://press.example.com/path///")).toBe(
      "https://press.example.com/path",
    );
    expect(validateAppPublicUrl("https://press.example.com/")).toBe("https://press.example.com");
  });

  it("treats whitespace-only as clear", () => {
    expect(validateAppPublicUrl(" ")).toBe("");
  });

  it("rejects non-absolute or non-http(s) URLs", () => {
    expectValidation(() => validateAppPublicUrl("not-a-url"));
    expectValidation(() => validateAppPublicUrl("ftp://press.example.com"));
    expectValidation(() => validateAppPublicUrl("//press.example.com"));
  });
});

describe("validateSmtpBundle", () => {
  it("accepts a full cleared object", () => {
    expect(validateSmtpBundle({ ...CLEARED_SMTP })).toEqual({ ...CLEARED_SMTP });
  });

  it("accepts a complete quartet and normalizes optional from/secure", () => {
    expect(validateSmtpBundle({ ...COMPLETE_SMTP })).toEqual({ ...COMPLETE_SMTP });
  });

  it("treats whitespace-only optional strings as clears when the quartet is empty", () => {
    expect(
      validateSmtpBundle({
        ...CLEARED_SMTP,
        smtpFrom: "   ",
        smtpSecure: "\n",
      }),
    ).toEqual({ ...CLEARED_SMTP });
  });

  it("rejects incomplete SMTP quartet", () => {
    expectValidation(() =>
      validateSmtpBundle({
        ...CLEARED_SMTP,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUsername: "user",
      }),
    );
  });

  it("rejects SMTP with optional fields set but required quartet incomplete", () => {
    expectValidation(() =>
      validateSmtpBundle({
        ...CLEARED_SMTP,
        smtpFrom: "noreply@example.com",
        smtpSecure: "true",
      }),
    );
  });

  it("accepts complete SMTP quartet with optional from/secure empty", () => {
    expect(
      validateSmtpBundle({
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpUsername: "user",
        smtpPassword: "secret",
        smtpFrom: "",
        smtpSecure: "",
      }),
    ).toEqual({
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
      validateSmtpBundle({
        smtpHost: "smtp.example.com",
        smtpPort: 0,
        smtpUsername: "user",
        smtpPassword: "secret",
        smtpFrom: "",
        smtpSecure: "",
      }),
    );
    expectValidation(() =>
      validateSmtpBundle({
        smtpHost: "smtp.example.com",
        smtpPort: 587.5,
        smtpUsername: "user",
        smtpPassword: "secret",
        smtpFrom: "",
        smtpSecure: "",
      }),
    );
  });

  it("validation errors never include the raw SMTP password", () => {
    const secretPassword = "smtp-super-secret-xyz";
    const err = expectValidation(() =>
      validateSmtpBundle({
        smtpHost: "smtp.example.com",
        smtpPort: 0,
        smtpUsername: "user",
        smtpPassword: secretPassword,
        smtpFrom: "",
        smtpSecure: "",
      }),
    );
    expect(err.message).not.toContain(secretPassword);
  });
});

describe("validatePipelineKnobsSettings", () => {
  it("accepts a full cleared object", () => {
    expect(validatePipelineKnobsSettings({ ...CLEARED_KNOBS })).toEqual({ ...CLEARED_KNOBS });
  });

  it("accepts a valid knobs object", () => {
    expect(
      validatePipelineKnobsSettings({
        scoreThreshold: 7.5,
        crossRunSimilarityThreshold: 0.9,
        rssFeedMaxItems: 12,
        drafterReasoningEffort: "medium",
        drafterMaxCompletionTokens: 16000,
      }),
    ).toEqual({
      scoreThreshold: 7.5,
      crossRunSimilarityThreshold: 0.9,
      rssFeedMaxItems: 12,
      drafterReasoningEffort: "medium",
      drafterMaxCompletionTokens: 16000,
    });
  });

  it("treats whitespace-only reasoning effort as clear", () => {
    expect(
      validatePipelineKnobsSettings({
        ...CLEARED_KNOBS,
        drafterReasoningEffort: "\t",
      }),
    ).toEqual({ ...CLEARED_KNOBS });
  });

  it("rejects out-of-range scoreThreshold", () => {
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, scoreThreshold: 11 }),
    );
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, scoreThreshold: -0.1 }),
    );
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, scoreThreshold: Number.NaN }),
    );
  });

  it("rejects out-of-range crossRunSimilarityThreshold", () => {
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, crossRunSimilarityThreshold: 1.5 }),
    );
  });

  it("rejects out-of-range rssFeedMaxItems", () => {
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, rssFeedMaxItems: 0 }),
    );
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, rssFeedMaxItems: 51 }),
    );
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, rssFeedMaxItems: 3.5 }),
    );
  });

  it("rejects invalid drafterReasoningEffort", () => {
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, drafterReasoningEffort: "ultra" }),
    );
  });

  it("rejects out-of-range drafterMaxCompletionTokens", () => {
    expectValidation(() =>
      validatePipelineKnobsSettings({ ...CLEARED_KNOBS, drafterMaxCompletionTokens: 512 }),
    );
    expectValidation(() =>
      validatePipelineKnobsSettings({
        ...CLEARED_KNOBS,
        drafterMaxCompletionTokens: 128_001,
      }),
    );
  });

  it("boundary values at range edges are accepted", () => {
    expect(
      validatePipelineKnobsSettings({
        scoreThreshold: 0,
        crossRunSimilarityThreshold: 1,
        rssFeedMaxItems: 1,
        drafterReasoningEffort: "low",
        drafterMaxCompletionTokens: 1024,
      }),
    ).toEqual({
      scoreThreshold: 0,
      crossRunSimilarityThreshold: 1,
      rssFeedMaxItems: 1,
      drafterReasoningEffort: "low",
      drafterMaxCompletionTokens: 1024,
    });

    expect(
      validatePipelineKnobsSettings({
        scoreThreshold: 10,
        crossRunSimilarityThreshold: 0,
        rssFeedMaxItems: 50,
        drafterReasoningEffort: "high",
        drafterMaxCompletionTokens: 128_000,
      }),
    ).toEqual({
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
