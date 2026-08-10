import type { NewsletterDateRange } from "../schema/declarations";
import { DEFAULT_LOOKBACK, LOOKBACK_MAX, LOOKBACK_MIN } from "../schema/declarations";
import { validatePromptTemplate } from "../prompts/contract";
import {
  modelIdValidationMessage,
  normalizeModelIdFields,
  type ModelIdFields,
} from "../settings/model-defaults";
import {
  NewsletterRepositoryError,
  type NewsletterFields,
  type CreateNewsletterInput,
  type UpdateNewsletterInput,
} from "./types";

const NAME_MAX_LENGTH = 255;
const AUDIENCE_MAX_LENGTH = 2000;
const DRAFTER_PROMPT_MAX_LENGTH = 50000;
const CHIP_MAX_LENGTH = 128;
const CHIP_LIST_MAX = 50;
const NEWS_ITEMS_MIN = 1;
const NEWS_ITEMS_MAX = 100;
const DEFAULT_NEWS_ITEMS = 16;
const DEFAULT_DATE_RANGE: NewsletterDateRange = "yesterday";

const NEWSLETTER_DATE_RANGES: ReadonlySet<string> = new Set([
  "yesterday",
  "last_3_days",
  "last_week",
  "all",
]);

export function validateNewsletterName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new NewsletterRepositoryError("validation", "Name is required");
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new NewsletterRepositoryError("validation", "Name must be 255 characters or less");
  }
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.includes("\0")
  ) {
    throw new NewsletterRepositoryError(
      "validation",
      "Name must not contain path separators, traversal sequences, or null bytes",
    );
  }
  return trimmed;
}

export function validateAudience(audience: string | undefined): string {
  if (audience === undefined) {
    return "";
  }
  const trimmed = audience.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length > AUDIENCE_MAX_LENGTH) {
    throw new NewsletterRepositoryError("validation", "Audience must be 2000 characters or less");
  }
  return trimmed;
}

export function validateChipList(chips: string[], fieldName: string): string[] {
  const trimmed: string[] = [];
  for (const chip of chips) {
    const value = typeof chip === "string" ? chip.trim() : "";
    if (value.length === 0) {
      throw new NewsletterRepositoryError("validation", `${fieldName} cannot contain empty values`);
    }
    if (value.length > CHIP_MAX_LENGTH) {
      throw new NewsletterRepositoryError(
        "validation",
        `${fieldName} entries must be 128 characters or less`,
      );
    }
    trimmed.push(value);
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of trimmed) {
    if (!seen.has(value)) {
      seen.add(value);
      deduped.push(value);
    }
  }
  if (deduped.length > CHIP_LIST_MAX) {
    throw new NewsletterRepositoryError(
      "validation",
      `${fieldName} cannot have more than 50 entries`,
    );
  }
  return deduped;
}

export function validateNewsItems(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new NewsletterRepositoryError(
      "validation",
      "News items must be an integer between 1 and 100",
    );
  }
  if (value < NEWS_ITEMS_MIN || value > NEWS_ITEMS_MAX) {
    throw new NewsletterRepositoryError(
      "validation",
      "News items must be an integer between 1 and 100",
    );
  }
  return value;
}

export function validateLookback(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new NewsletterRepositoryError(
      "validation",
      "Lookback must be an integer between 0 and 10",
    );
  }
  if (value < LOOKBACK_MIN || value > LOOKBACK_MAX) {
    throw new NewsletterRepositoryError(
      "validation",
      "Lookback must be an integer between 0 and 10",
    );
  }
  return value;
}

export function validateDateRange(value: NewsletterDateRange): NewsletterDateRange {
  if (typeof value !== "string" || !NEWSLETTER_DATE_RANGES.has(value)) {
    throw new NewsletterRepositoryError(
      "validation",
      "Date range must be yesterday, last_3_days, last_week, or all",
    );
  }
  return value as NewsletterDateRange;
}

/**
 * Parse a FormData chip JSON field (`topicsJson` / `dislikedTopicsJson`).
 * Returns the raw string array (untrimmed — {@link validateChipList} trims
 * later). Throws `NewsletterRepositoryError` (`validation`) on invalid JSON,
 * non-array payloads, or any non-string element. When `required` is false
 * (create default), a missing/blank raw value yields `[]`; when `required`
 * is true (update), missing/blank is a validation error.
 */
export function parseChipJsonField(
  field: string,
  raw: string | null | undefined,
  options?: { required?: boolean },
): string[] {
  const required = options?.required === true;
  if (raw === null || raw === undefined || raw === "") {
    if (required) {
      throw new NewsletterRepositoryError("validation", `Invalid ${field} payload`);
    }
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NewsletterRepositoryError("validation", `Invalid ${field} payload`);
  }
  if (!Array.isArray(parsed)) {
    throw new NewsletterRepositoryError("validation", `Invalid ${field} payload`);
  }
  for (const element of parsed) {
    if (typeof element !== "string") {
      throw new NewsletterRepositoryError("validation", `Invalid ${field} payload`);
    }
  }
  return parsed as string[];
}

/**
 * Drop chips that are blank after trim before strict validation. The form chip
 * input may yield whitespace-only entries (e.g. a stray space); these are
 * dropped rather than rejected so an accidental blank chip does not block a
 * whole submission. {@link validateChipList} remains strict (throws on empty)
 * for callers that want hard rejection — e.g. server-action validation of a
 * parsed JSON payload.
 */
function dropBlankChips(chips: string[] | undefined): string[] {
  return (chips ?? []).filter((chip) => chip.trim().length > 0);
}

/**
 * Validate optional per-role model overrides (Feature 04 OpenRouter-style rules).
 * Empty after trim → `""` (no override). Invalid rejects the whole write.
 */
function validateModelOverrides(
  models: Partial<Record<keyof ModelIdFields, unknown>>,
): ModelIdFields {
  const { fields, invalidRoles } = normalizeModelIdFields(models);
  if (invalidRoles.length > 0) {
    throw new NewsletterRepositoryError("validation", modelIdValidationMessage(invalidRoles));
  }
  return fields;
}

/**
 * Validate optional per-newsletter drafter prompt override.
 * Empty / whitespace-only → `""` (use global). Non-empty must be ≤ 50000 and
 * include all required drafter placeholders; unknown placeholders are allowed.
 */
export function validateDrafterPrompt(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length > DRAFTER_PROMPT_MAX_LENGTH) {
    throw new NewsletterRepositoryError(
      "validation",
      `Drafter prompt must be ${DRAFTER_PROMPT_MAX_LENGTH} characters or less`,
    );
  }
  const validation = validatePromptTemplate("drafter", trimmed);
  if (!validation.ok) {
    const missing = validation.missing.join(", ");
    throw new NewsletterRepositoryError(
      "validation",
      `Missing required placeholders: ${missing}`,
    );
  }
  return trimmed;
}

export function resolveCreateFields(input: CreateNewsletterInput): NewsletterFields {
  const models = validateModelOverrides({
    taggerModel: input.taggerModel,
    scorerModel: input.scorerModel,
    drafterModel: input.drafterModel,
    embedderModel: input.embedderModel,
  });
  return {
    name: validateNewsletterName(input.name),
    topics: validateChipList(dropBlankChips(input.topics), "topics"),
    dislikedTopics: validateChipList(dropBlankChips(input.dislikedTopics), "disliked topics"),
    audience: validateAudience(input.audience),
    newsItems: validateNewsItems(input.newsItems ?? DEFAULT_NEWS_ITEMS),
    dateRange: validateDateRange(input.dateRange ?? DEFAULT_DATE_RANGE),
    lookback: validateLookback(input.lookback ?? DEFAULT_LOOKBACK),
    ...models,
    drafterPrompt: validateDrafterPrompt(input.drafterPrompt),
  };
}

export function resolveUpdateFields(input: UpdateNewsletterInput): NewsletterFields {
  const models = validateModelOverrides({
    taggerModel: input.taggerModel,
    scorerModel: input.scorerModel,
    drafterModel: input.drafterModel,
    embedderModel: input.embedderModel,
  });
  return {
    name: validateNewsletterName(input.name),
    topics: validateChipList(dropBlankChips(input.topics), "topics"),
    dislikedTopics: validateChipList(dropBlankChips(input.dislikedTopics), "disliked topics"),
    audience: validateAudience(input.audience),
    newsItems: validateNewsItems(input.newsItems),
    dateRange: validateDateRange(input.dateRange),
    lookback: validateLookback(input.lookback),
    ...models,
    drafterPrompt: validateDrafterPrompt(input.drafterPrompt),
  };
}
