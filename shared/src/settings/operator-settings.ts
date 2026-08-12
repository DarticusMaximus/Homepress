import { SettingsRepositoryError } from "./types";

/** Allowed drafter reasoning-effort override values. */
export const DRAFTER_REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type DrafterReasoningEffort = (typeof DRAFTER_REASONING_EFFORTS)[number];

export const OPENROUTER_API_KEY_MAX_LENGTH = 512;
export const SMTP_STRING_MAX_LENGTH = 512;
export const SMTP_SECURE_MAX_LENGTH = 16;
export const APP_PUBLIC_URL_MAX_LENGTH = 512;
export const DRAFTER_REASONING_EFFORT_MAX_LENGTH = 16;

export const SCORE_THRESHOLD_MIN = 0;
export const SCORE_THRESHOLD_MAX = 10;
export const CROSS_RUN_SIMILARITY_THRESHOLD_MIN = 0;
export const CROSS_RUN_SIMILARITY_THRESHOLD_MAX = 1;
export const RSS_FEED_MAX_ITEMS_MIN = 1;
export const RSS_FEED_MAX_ITEMS_MAX = 50;
export const DRAFTER_MAX_COMPLETION_TOKENS_MIN = 1024;
export const DRAFTER_MAX_COMPLETION_TOKENS_MAX = 128_000;

/**
 * Full Stage-12 operator override object. Every `updateOperatorSettings` /
 * `validateOperatorSettings` call must send every field (not a sparse patch).
 * Empty string / `null` clears that override.
 */
export type OperatorSettingsInput = {
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

/** Normalized Stage-12 overrides ready to persist (strings `""`, numbers `null` when unset). */
export type ValidatedOperatorSettings = {
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
  drafterReasoningEffort: DrafterReasoningEffort | "";
  drafterMaxCompletionTokens: number | null;
};

const TRUTHY_SECURE = new Set(["true", "1", "yes"]);

function hasWhitespaceOrControl(value: string): boolean {
  return /[\s\p{Cc}\p{Cf}]/u.test(value);
}

function failValidation(message: string): never {
  throw new SettingsRepositoryError("validation", message);
}

function asOptionalString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") {
    failValidation("Invalid operator settings value");
  }
  return raw.trim();
}

function isStringClear(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "string") return false;
  return raw.trim() === "";
}

function isPortClear(raw: unknown): boolean {
  return raw === null || raw === undefined;
}

function validateOpenRouterApiKey(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") {
    failValidation("OpenRouter API key must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed.length > OPENROUTER_API_KEY_MAX_LENGTH) {
    failValidation(
      `OpenRouter API key must be ${OPENROUTER_API_KEY_MAX_LENGTH} characters or less`,
    );
  }
  if (hasWhitespaceOrControl(trimmed)) {
    failValidation("OpenRouter API key must not contain whitespace or control characters");
  }
  return trimmed;
}

function validateOptionalFiniteInRange(
  raw: unknown,
  opts: { fieldLabel: string; min: number; max: number; integer?: boolean },
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    failValidation(
      opts.integer
        ? `${opts.fieldLabel} must be an integer between ${opts.min} and ${opts.max}`
        : `${opts.fieldLabel} must be a number between ${opts.min} and ${opts.max}`,
    );
  }
  if (opts.integer && !Number.isInteger(raw)) {
    failValidation(`${opts.fieldLabel} must be an integer between ${opts.min} and ${opts.max}`);
  }
  if (raw < opts.min || raw > opts.max) {
    failValidation(
      opts.integer
        ? `${opts.fieldLabel} must be an integer between ${opts.min} and ${opts.max}`
        : `${opts.fieldLabel} must be a number between ${opts.min} and ${opts.max}`,
    );
  }
  return raw;
}

function validateDrafterReasoningEffort(raw: unknown): DrafterReasoningEffort | "" {
  const trimmed = asOptionalString(raw);
  if (trimmed === "") return "";
  if (trimmed.length > DRAFTER_REASONING_EFFORT_MAX_LENGTH) {
    failValidation("Drafter reasoning effort must be low, medium, or high");
  }
  if (!(DRAFTER_REASONING_EFFORTS as readonly string[]).includes(trimmed)) {
    failValidation("Drafter reasoning effort must be low, medium, or high");
  }
  return trimmed as DrafterReasoningEffort;
}

function validateAppPublicUrl(raw: unknown): string {
  const trimmed = asOptionalString(raw);
  if (trimmed === "") return "";
  if (trimmed.length > APP_PUBLIC_URL_MAX_LENGTH) {
    failValidation(`Public URL must be ${APP_PUBLIC_URL_MAX_LENGTH} characters or less`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    failValidation("Public URL must be an absolute http:// or https:// URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    failValidation("Public URL must be an absolute http:// or https:// URL");
  }
  if (!parsed.hostname) {
    failValidation("Public URL must be an absolute http:// or https:// URL");
  }
  // Strip trailing slashes on store; never invent a host.
  return trimmed.replace(/\/+$/, "");
}

function validateSmtpStringField(
  raw: unknown,
  opts: { fieldLabel: string; required: boolean; maxLength: number },
): string {
  if (raw === null || raw === undefined) {
    if (opts.required) {
      failValidation(`${opts.fieldLabel} is required when configuring SMTP`);
    }
    return "";
  }
  if (typeof raw !== "string") {
    failValidation(`${opts.fieldLabel} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (opts.required) {
      failValidation(`${opts.fieldLabel} is required when configuring SMTP`);
    }
    return "";
  }
  if (trimmed.length > opts.maxLength) {
    failValidation(`${opts.fieldLabel} must be ${opts.maxLength} characters or less`);
  }
  return trimmed;
}

function validateSmtpPort(raw: unknown, required: boolean): number | null {
  if (isPortClear(raw)) {
    if (required) {
      failValidation("SMTP port is required when configuring SMTP");
    }
    return null;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    failValidation("SMTP port must be a positive integer");
  }
  return raw;
}

/**
 * Normalize optional SMTP secure override for storage.
 * Empty clears. Non-empty is trimmed; truthy parsing (`true`/`1`/`yes`) is for
 * resolve-time — write accepts any short string within the attr size.
 */
function validateSmtpSecure(raw: unknown): string {
  const trimmed = asOptionalString(raw);
  if (trimmed === "") return "";
  if (trimmed.length > SMTP_SECURE_MAX_LENGTH) {
    failValidation(`SMTP secure must be ${SMTP_SECURE_MAX_LENGTH} characters or less`);
  }
  return trimmed;
}

function isSmtpClearAll(input: OperatorSettingsInput): boolean {
  return (
    isStringClear(input.smtpHost) &&
    isPortClear(input.smtpPort) &&
    isStringClear(input.smtpUsername) &&
    isStringClear(input.smtpPassword) &&
    isStringClear(input.smtpFrom) &&
    isStringClear(input.smtpSecure)
  );
}

function isSmtpQuartetPresent(input: OperatorSettingsInput): boolean {
  return (
    !isStringClear(input.smtpHost) &&
    !isPortClear(input.smtpPort) &&
    !isStringClear(input.smtpUsername) &&
    !isStringClear(input.smtpPassword)
  );
}

function validateSmtpBundle(input: OperatorSettingsInput): {
  smtpHost: string;
  smtpPort: number | null;
  smtpUsername: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: string;
} {
  if (isSmtpClearAll(input)) {
    return {
      smtpHost: "",
      smtpPort: null,
      smtpUsername: "",
      smtpPassword: "",
      smtpFrom: "",
      smtpSecure: "",
    };
  }

  if (!isSmtpQuartetPresent(input)) {
    failValidation(
      "SMTP settings must be a complete host/port/username/password set, or all cleared",
    );
  }

  // Required quartet — never echo password (or other secrets) in messages.
  const smtpHost = validateSmtpStringField(input.smtpHost, {
    fieldLabel: "SMTP host",
    required: true,
    maxLength: SMTP_STRING_MAX_LENGTH,
  });
  const smtpPort = validateSmtpPort(input.smtpPort, true);
  const smtpUsername = validateSmtpStringField(input.smtpUsername, {
    fieldLabel: "SMTP username",
    required: true,
    maxLength: SMTP_STRING_MAX_LENGTH,
  });
  const smtpPassword = validateSmtpStringField(input.smtpPassword, {
    fieldLabel: "SMTP password",
    required: true,
    maxLength: SMTP_STRING_MAX_LENGTH,
  });
  const smtpFrom = validateSmtpStringField(input.smtpFrom, {
    fieldLabel: "SMTP from",
    required: false,
    maxLength: SMTP_STRING_MAX_LENGTH,
  });
  const smtpSecure = validateSmtpSecure(input.smtpSecure);

  return {
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    smtpFrom,
    smtpSecure,
  };
}

/** Parse SMTP secure like env (`true` / `1` / `yes`, case-insensitive). Empty → false. */
export function parseSmtpSecureFlag(raw: string | null | undefined): boolean {
  if (raw === undefined || raw === null || raw.trim() === "") return false;
  return TRUTHY_SECURE.has(raw.trim().toLowerCase());
}

/**
 * Validate and normalize a full Stage-12 operator settings object.
 * Empty string / `null` clears. SMTP is complete-quartet or clear-all-six.
 * Never includes OpenRouter key or SMTP password in error messages.
 */
export function validateOperatorSettings(input: OperatorSettingsInput): ValidatedOperatorSettings {
  const openRouterApiKey = validateOpenRouterApiKey(input.openRouterApiKey);
  const smtp = validateSmtpBundle(input);
  const appPublicUrl = validateAppPublicUrl(input.appPublicUrl);
  const scoreThreshold = validateOptionalFiniteInRange(input.scoreThreshold, {
    fieldLabel: "Score threshold",
    min: SCORE_THRESHOLD_MIN,
    max: SCORE_THRESHOLD_MAX,
  });
  const crossRunSimilarityThreshold = validateOptionalFiniteInRange(
    input.crossRunSimilarityThreshold,
    {
      fieldLabel: "Cross-run similarity threshold",
      min: CROSS_RUN_SIMILARITY_THRESHOLD_MIN,
      max: CROSS_RUN_SIMILARITY_THRESHOLD_MAX,
    },
  );
  const rssFeedMaxItems = validateOptionalFiniteInRange(input.rssFeedMaxItems, {
    fieldLabel: "RSS feed max items",
    min: RSS_FEED_MAX_ITEMS_MIN,
    max: RSS_FEED_MAX_ITEMS_MAX,
    integer: true,
  });
  const drafterReasoningEffort = validateDrafterReasoningEffort(input.drafterReasoningEffort);
  const drafterMaxCompletionTokens = validateOptionalFiniteInRange(
    input.drafterMaxCompletionTokens,
    {
      fieldLabel: "Drafter max completion tokens",
      min: DRAFTER_MAX_COMPLETION_TOKENS_MIN,
      max: DRAFTER_MAX_COMPLETION_TOKENS_MAX,
      integer: true,
    },
  );

  return {
    openRouterApiKey,
    ...smtp,
    appPublicUrl,
    scoreThreshold,
    crossRunSimilarityThreshold,
    rssFeedMaxItems,
    drafterReasoningEffort,
    drafterMaxCompletionTokens,
  };
}
