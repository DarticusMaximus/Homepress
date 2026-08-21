import type { ModelComponent } from "../pipeline/config";
import { SettingsRepositoryError } from "./types";

export const MODEL_COMPONENTS: readonly ModelComponent[] = [
  "tagger",
  "scorer",
  "drafter",
  "titleDek",
  "embedder",
] as const;

export type GlobalModelDefaults = {
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  titleDekModel: string;
  embedderModel: string;
};

/** Shared shape for the per-role OpenRouter model ID fields. */
export type ModelIdFields = GlobalModelDefaults;

const MODEL_FIELD_BY_ROLE: Record<ModelComponent, keyof ModelIdFields> = {
  tagger: "taggerModel",
  scorer: "scorerModel",
  drafter: "drafterModel",
  titleDek: "titleDekModel",
  embedder: "embedderModel",
};

export const MAX_MODEL_ID_LENGTH = 256;

function hasWhitespaceOrControl(value: string): boolean {
  return /[\s\p{Cc}\p{Cf}]/u.test(value);
}

/** OpenRouter-style: non-empty author / non-empty slug (optional extra path segments). */
function isOpenRouterStyleId(value: string): boolean {
  if (hasWhitespaceOrControl(value)) return false;
  const parts = value.split("/");
  if (parts.length < 2) return false;
  return parts.every((part) => part.length > 0);
}

export function normalizeModelIdInput(raw: string): string {
  return String(raw ?? "").trim();
}

/** Non-empty OpenRouter-style id: length ≤ 256, at least one `/`, no whitespace/control. */
export function isValidModelId(value: string): boolean {
  if (value.length > MAX_MODEL_ID_LENGTH) return false;
  return isOpenRouterStyleId(value);
}

/**
 * Normalize model-id fields (trim; empty → `""`). Collects invalid roles
 * without throwing so callers can map to their own error type.
 */
export function normalizeModelIdFields(
  models: Partial<Record<keyof ModelIdFields, unknown>>,
): { fields: ModelIdFields; invalidRoles: ModelComponent[] } {
  const invalidRoles: ModelComponent[] = [];
  const fields: ModelIdFields = {
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    titleDekModel: "",
    embedderModel: "",
  };

  for (const role of MODEL_COMPONENTS) {
    const field = MODEL_FIELD_BY_ROLE[role];
    const trimmed = normalizeModelIdInput(String(models[field] ?? ""));
    if (trimmed === "") {
      fields[field] = "";
      continue;
    }
    if (!isValidModelId(trimmed)) {
      invalidRoles.push(role);
      continue;
    }
    fields[field] = trimmed;
  }

  return { fields, invalidRoles };
}

export function modelIdValidationMessage(invalidRoles: readonly ModelComponent[]): string {
  const named = invalidRoles.join(", ");
  return `Invalid model ID for ${named}. Use an OpenRouter-style id like provider/model (max ${MAX_MODEL_ID_LENGTH} characters, no whitespace).`;
}

/**
 * Validate and normalize all global model default fields.
 * Empty after trim → `""`. All-or-nothing: any invalid field rejects the whole payload.
 */
export function validateGlobalModelDefaults(models: GlobalModelDefaults): GlobalModelDefaults {
  const { fields, invalidRoles } = normalizeModelIdFields(models);
  if (invalidRoles.length > 0) {
    throw new SettingsRepositoryError("validation", modelIdValidationMessage(invalidRoles));
  }
  return fields;
}

export function mapModelFieldFromDocument(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return "";
  return raw;
}
