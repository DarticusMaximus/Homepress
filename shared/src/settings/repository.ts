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
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

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

function documentToSettings(doc: Record<string, unknown>): AppSettings {
  return {
    runRetentionDays: clampRetentionDays(doc.runRetentionDays),
    updatedAt: doc.updatedAt as string,
    taggerModel: mapModelFieldFromDocument(doc.taggerModel),
    scorerModel: mapModelFieldFromDocument(doc.scorerModel),
    drafterModel: mapModelFieldFromDocument(doc.drafterModel),
    embedderModel: mapModelFieldFromDocument(doc.embedderModel),
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
 * drafter, and embedder. Empty string clears a global override. Upsert via
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
