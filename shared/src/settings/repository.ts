import { Client, Databases } from "node-appwrite";
import {
  DATABASE_ID,
  APP_SETTINGS_COLLECTION_ID,
  APP_SETTINGS_DOCUMENT_ID,
  DEFAULT_RUN_RETENTION_DAYS,
  MIN_RUN_RETENTION_DAYS,
  MAX_RUN_RETENTION_DAYS,
} from "../schema/declarations";
import { type AppSettings, SettingsRepositoryError } from "./types";
import {
  mapModelFieldFromDocument,
  validateGlobalModelDefaults,
  type GlobalModelDefaults,
} from "./model-defaults";
import {
  CROSS_RUN_SIMILARITY_THRESHOLD_MAX,
  CROSS_RUN_SIMILARITY_THRESHOLD_MIN,
  DRAFTER_MAX_COMPLETION_TOKENS_MAX,
  DRAFTER_MAX_COMPLETION_TOKENS_MIN,
  DRAFTER_REASONING_EFFORTS,
  RSS_FEED_MAX_ITEMS_MAX,
  RSS_FEED_MAX_ITEMS_MIN,
  SCORE_THRESHOLD_MAX,
  SCORE_THRESHOLD_MIN,
  validateOperatorSettings,
  type OperatorSettingsInput,
} from "./operator-settings";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

const UNSET_SMTP = {
  smtpHost: "",
  smtpPort: null as number | null,
  smtpUsername: "",
  smtpPassword: "",
  smtpFrom: "",
  smtpSecure: "",
} as const;

interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

function describeError(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as AppwriteExceptionLike;
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}

function wrapAppwriteError(err: unknown, phase: string): never {
  const { message, code } = describeError(err);
  console.error({ phase, code, message: sanitizeAppwriteMessageForLog(message) });
  throw new SettingsRepositoryError("appwrite", APPWRITE_SAFE_MESSAGE);
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404;
}

function clampRetentionDays(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || Number.isNaN(raw)) {
    return DEFAULT_RUN_RETENTION_DAYS;
  }
  if (raw < MIN_RUN_RETENTION_DAYS || raw > MAX_RUN_RETENTION_DAYS) {
    return DEFAULT_RUN_RETENTION_DAYS;
  }
  return raw;
}

/**
 * Defensive string mapping: corrupt / missing / whitespace-only → `""`.
 * Otherwise returns the trimmed string.
 */
function mapOptionalStringFromDocument(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * Defensive optional number mapping: corrupt / non-finite / out-of-range → `null`.
 * When `integer` is true, non-integers map to unset.
 * When `min`/`max` are set, values outside the inclusive range map to unset.
 * When `positiveInteger` is true, only finite positive integers are kept.
 */
function mapOptionalNumberFromDocument(
  raw: unknown,
  opts?: {
    integer?: boolean;
    min?: number;
    max?: number;
    positiveInteger?: boolean;
  },
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (opts?.integer && !Number.isInteger(raw)) return null;
  if (opts?.positiveInteger) {
    if (!Number.isInteger(raw) || raw <= 0) return null;
    return raw;
  }
  if (opts?.min !== undefined && raw < opts.min) return null;
  if (opts?.max !== undefined && raw > opts.max) return null;
  return raw;
}

/** Exact `low`|`medium`|`high` after trim; anything else → unset. */
function mapDrafterReasoningEffortFromDocument(raw: unknown): string {
  const trimmed = mapOptionalStringFromDocument(raw);
  if (trimmed === "") return "";
  if (!(DRAFTER_REASONING_EFFORTS as readonly string[]).includes(trimmed)) {
    return "";
  }
  return trimmed;
}

/**
 * Absolute http(s) URL after trim; strip trailing `/` when keeping.
 * Invalid / non-http(s) / whitespace-only → unset.
 */
function mapAppPublicUrlFromDocument(raw: unknown): string {
  const trimmed = mapOptionalStringFromDocument(raw);
  if (trimmed === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  if (!parsed.hostname) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * Map SMTP attrs; if required quartet is incomplete/invalid, clear all six.
 * Quartet: non-empty trimmed host/username/password + finite positive integer port.
 */
function mapSmtpBundleFromDocument(doc: Record<string, unknown>): {
  smtpHost: string;
  smtpPort: number | null;
  smtpUsername: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: string;
} {
  const smtpHost = mapOptionalStringFromDocument(doc.smtpHost);
  const smtpPort = mapOptionalNumberFromDocument(doc.smtpPort, { positiveInteger: true });
  const smtpUsername = mapOptionalStringFromDocument(doc.smtpUsername);
  const smtpPassword = mapOptionalStringFromDocument(doc.smtpPassword);
  const smtpFrom = mapOptionalStringFromDocument(doc.smtpFrom);
  const smtpSecure = mapOptionalStringFromDocument(doc.smtpSecure);

  const quartetComplete =
    smtpHost !== "" &&
    smtpPort !== null &&
    smtpUsername !== "" &&
    smtpPassword !== "";

  if (!quartetComplete) {
    return { ...UNSET_SMTP };
  }

  return {
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    smtpFrom,
    smtpSecure,
  };
}

function documentToSettings(doc: Record<string, unknown>): AppSettings {
  return {
    runRetentionDays: clampRetentionDays(doc.runRetentionDays),
    updatedAt: doc.updatedAt as string,
    taggerModel: mapModelFieldFromDocument(doc.taggerModel),
    scorerModel: mapModelFieldFromDocument(doc.scorerModel),
    drafterModel: mapModelFieldFromDocument(doc.drafterModel),
    titleDekModel: mapModelFieldFromDocument(doc.titleDekModel),
    embedderModel: mapModelFieldFromDocument(doc.embedderModel),
    openRouterApiKey: mapOptionalStringFromDocument(doc.openRouterApiKey),
    ...mapSmtpBundleFromDocument(doc),
    appPublicUrl: mapAppPublicUrlFromDocument(doc.appPublicUrl),
    scoreThreshold: mapOptionalNumberFromDocument(doc.scoreThreshold, {
      min: SCORE_THRESHOLD_MIN,
      max: SCORE_THRESHOLD_MAX,
    }),
    crossRunSimilarityThreshold: mapOptionalNumberFromDocument(doc.crossRunSimilarityThreshold, {
      min: CROSS_RUN_SIMILARITY_THRESHOLD_MIN,
      max: CROSS_RUN_SIMILARITY_THRESHOLD_MAX,
    }),
    rssFeedMaxItems: mapOptionalNumberFromDocument(doc.rssFeedMaxItems, {
      integer: true,
      min: RSS_FEED_MAX_ITEMS_MIN,
      max: RSS_FEED_MAX_ITEMS_MAX,
    }),
    drafterReasoningEffort: mapDrafterReasoningEffortFromDocument(doc.drafterReasoningEffort),
    drafterMaxCompletionTokens: mapOptionalNumberFromDocument(doc.drafterMaxCompletionTokens, {
      integer: true,
      min: DRAFTER_MAX_COMPLETION_TOKENS_MIN,
      max: DRAFTER_MAX_COMPLETION_TOKENS_MAX,
    }),
  };
}

/**
 * Get the singleton app_settings document (`$id: "default"`), creating it with
 * the default retention window if it does not yet exist. Invalid stored
 * `runRetentionDays` values are clamped to the default on read (defensive).
 */
export async function getOrCreateAppSettings(client: Client): Promise<AppSettings> {
  const databases = new Databases(client);

  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: APP_SETTINGS_COLLECTION_ID,
      documentId: APP_SETTINGS_DOCUMENT_ID,
    });
    return documentToSettings(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof SettingsRepositoryError) throw err;
    if (isNotFound(err)) {
      const now = new Date().toISOString();
      const data = {
        runRetentionDays: DEFAULT_RUN_RETENTION_DAYS,
        updatedAt: now,
      };
      try {
        const doc = await databases.createDocument({
          databaseId: DATABASE_ID,
          collectionId: APP_SETTINGS_COLLECTION_ID,
          documentId: APP_SETTINGS_DOCUMENT_ID,
          data,
        });
        return documentToSettings(doc as unknown as Record<string, unknown>);
      } catch (err2) {
        if (err2 instanceof SettingsRepositoryError) throw err2;
        wrapAppwriteError(err2, "create-app-settings");
      }
    }
    wrapAppwriteError(err, "get-app-settings");
  }
}

/**
 * Validate and persist a new `runRetentionDays`. Rejects non-integers and
 * values outside `[MIN, MAX]`. Upsert: get-or-create then `updateDocument`
 * with the new value + `updatedAt: now`. Returns the updated settings.
 */
export async function updateRunRetentionDays(client: Client, days: number): Promise<AppSettings> {
  if (
    typeof days !== "number" ||
    !Number.isFinite(days) ||
    Number.isNaN(days) ||
    !Number.isInteger(days) ||
    days < MIN_RUN_RETENTION_DAYS ||
    days > MAX_RUN_RETENTION_DAYS
  ) {
    throw new SettingsRepositoryError("validation", "Retention must be between 1 and 365 days");
  }

  const existing = await getOrCreateAppSettings(client);

  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    runRetentionDays: days,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: APP_SETTINGS_COLLECTION_ID,
      documentId: APP_SETTINGS_DOCUMENT_ID,
      data,
    });
    return documentToSettings(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof SettingsRepositoryError) throw err;
    void existing;
    wrapAppwriteError(err, "update-run-retention-days");
  }
}

/**
 * Validate and persist global OpenRouter model defaults for tagger, scorer,
 * drafter, titleDek, and embedder. Empty string clears a global override. Upsert via
 * get-or-create then `updateDocument`. Preserves `runRetentionDays`.
 */
export async function updateGlobalModelDefaults(
  client: Client,
  models: GlobalModelDefaults,
): Promise<AppSettings> {
  const normalized = validateGlobalModelDefaults(models);

  const existing = await getOrCreateAppSettings(client);

  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    taggerModel: normalized.taggerModel,
    scorerModel: normalized.scorerModel,
    drafterModel: normalized.drafterModel,
    titleDekModel: normalized.titleDekModel,
    embedderModel: normalized.embedderModel,
    runRetentionDays: existing.runRetentionDays,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: APP_SETTINGS_COLLECTION_ID,
      documentId: APP_SETTINGS_DOCUMENT_ID,
      data,
    });
    return documentToSettings(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof SettingsRepositoryError) throw err;
    wrapAppwriteError(err, "update-global-model-defaults");
  }
}

/**
 * Validate and persist the full Stage-12 operator override object.
 * Caller must send every Stage 12 field (not a sparse patch). Empty string /
 * `null` clears that override; SMTP clear-all wipes all six SMTP attrs.
 * Rejects the whole write on any invalid field. Preserves retention and
 * global model defaults.
 */
export async function updateOperatorSettings(
  client: Client,
  input: OperatorSettingsInput,
): Promise<AppSettings> {
  const normalized = validateOperatorSettings(input);

  const existing = await getOrCreateAppSettings(client);

  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    openRouterApiKey: normalized.openRouterApiKey,
    smtpHost: normalized.smtpHost,
    smtpPort: normalized.smtpPort,
    smtpUsername: normalized.smtpUsername,
    smtpPassword: normalized.smtpPassword,
    smtpFrom: normalized.smtpFrom,
    smtpSecure: normalized.smtpSecure,
    appPublicUrl: normalized.appPublicUrl,
    scoreThreshold: normalized.scoreThreshold,
    crossRunSimilarityThreshold: normalized.crossRunSimilarityThreshold,
    rssFeedMaxItems: normalized.rssFeedMaxItems,
    drafterReasoningEffort: normalized.drafterReasoningEffort,
    drafterMaxCompletionTokens: normalized.drafterMaxCompletionTokens,
    // Preserve existing retention / global models (not part of this payload).
    runRetentionDays: existing.runRetentionDays,
    taggerModel: existing.taggerModel,
    scorerModel: existing.scorerModel,
    drafterModel: existing.drafterModel,
    titleDekModel: existing.titleDekModel,
    embedderModel: existing.embedderModel,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: APP_SETTINGS_COLLECTION_ID,
      documentId: APP_SETTINGS_DOCUMENT_ID,
      data,
    });
    return documentToSettings(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof SettingsRepositoryError) throw err;
    wrapAppwriteError(err, "update-operator-settings");
  }
}
