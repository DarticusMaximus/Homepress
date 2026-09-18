import "server-only";

import { Client, Databases } from "node-appwrite";
import {
  DATABASE_ID,
  APP_SETTINGS_COLLECTION_ID,
  APP_SETTINGS_DOCUMENT_ID,
  DEFAULT_RUN_RETENTION_DAYS,
  MIN_RUN_RETENTION_DAYS,
  MAX_RUN_RETENTION_DAYS,
} from "../schema/declarations";
import {
  type AppSettings,
  type PublicAppSettings,
  type SettingsSecretsHealth,
  SettingsRepositoryError,
} from "./types";
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
  validateAppPublicUrl,
  validateOpenRouterApiKey,
  validatePipelineKnobsSettings,
  validateSmtpBundle,
  type UpdateConnectionInput,
  type UpdatePipelineKnobsInput,
} from "./operator-settings";
import {
  decryptSecretValue,
  encryptSecretValue,
  isEncryptedSecretValue,
  settingsCipherStatus,
} from "./secrets";
import { describeError, sanitizeAppwriteMessageForLog } from "../util/log-redact";

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
 * Map SMTP attrs. Incomplete/invalid quartet → clear all six, except C3:
 * an unreadable encrypted password must not blank stored non-secret attrs.
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
  const storedPassword = mapOptionalStringFromDocument(doc.smtpPassword);
  const smtpPassword = decryptSecretValue(storedPassword);
  const smtpFrom = mapOptionalStringFromDocument(doc.smtpFrom);
  const smtpSecure = mapOptionalStringFromDocument(doc.smtpSecure);

  const nonSecretTrioComplete = smtpHost !== "" && smtpPort !== null && smtpUsername !== "";
  const quartetComplete = nonSecretTrioComplete && smtpPassword !== "";

  if (quartetComplete) {
    return {
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      smtpFrom,
      smtpSecure,
    };
  }

  const passwordUnreadable = isEncryptedSecretValue(storedPassword) && smtpPassword === "";
  if (nonSecretTrioComplete && passwordUnreadable) {
    return {
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword: "",
      smtpFrom,
      smtpSecure,
    };
  }

  return { ...UNSET_SMTP };
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
    openRouterApiKey: decryptSecretValue(mapOptionalStringFromDocument(doc.openRouterApiKey)),
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

export function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  const { openRouterApiKey, smtpPassword, ...rest } = settings;
  return {
    ...rest,
    hasOpenRouterApiKey: openRouterApiKey.trim() !== "",
    hasSmtpPassword: smtpPassword.trim() !== "",
  };
}

async function patchAppSettings(
  client: Client,
  data: Record<string, unknown>,
  phase: string,
): Promise<PublicAppSettings> {
  const databases = new Databases(client);
  const now = new Date().toISOString();
  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: APP_SETTINGS_COLLECTION_ID,
      documentId: APP_SETTINGS_DOCUMENT_ID,
      data: { ...data, updatedAt: now },
    });
    return toPublicAppSettings(documentToSettings(doc as unknown as Record<string, unknown>));
  } catch (err) {
    if (err instanceof SettingsRepositoryError) throw err;
    wrapAppwriteError(err, phase);
  }
}

async function getRawAppSettingsDocument(
  databases: Databases,
): Promise<Record<string, unknown> | null> {
  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: APP_SETTINGS_COLLECTION_ID,
      documentId: APP_SETTINGS_DOCUMENT_ID,
    });
    return doc as unknown as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SettingsRepositoryError) throw err;
    if (isNotFound(err)) return null;
    wrapAppwriteError(err, "get-app-settings");
  }
}

function rawStoredSecret(doc: Record<string, unknown> | null, field: string): string {
  if (!doc) return "";
  return mapOptionalStringFromDocument(doc[field]);
}

/** `""` / null / undefined → keep stored; non-empty after trim → replace. */
function isKeepSentinel(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "string") return false;
  return raw.trim() === "";
}

/**
 * Encrypt-on-write for a resolved secret. Empty → persist `""`. Invalid cipher
 * refuses any non-empty persist (including a kept stored secret). Under `on`,
 * kept already-encrypted values are re-persisted as-is; legacy plaintext is
 * encrypted (lazy migration).
 */
function persistResolvedSecret(storedRaw: string, keep: boolean, incomingPlain: string): string {
  const effective = keep ? storedRaw : incomingPlain;
  if (effective === "") return "";
  const status = settingsCipherStatus();
  if (status === "invalid") {
    return encryptSecretValue(effective);
  }
  if (status === "on" && keep && isEncryptedSecretValue(storedRaw)) {
    return storedRaw;
  }
  return encryptSecretValue(keep ? storedRaw : incomingPlain);
}

function validateEffectiveOpenRouterKey(effectiveRaw: string): void {
  if (effectiveRaw === "" || isEncryptedSecretValue(effectiveRaw)) return;
  validateOpenRouterApiKey(effectiveRaw);
}

/**
 * Validate and persist a new `runRetentionDays`. Rejects non-integers and
 * values outside `[MIN, MAX]`. Partial-updates only that attribute + `updatedAt`.
 */
export async function updateRunRetentionDays(
  client: Client,
  days: number,
): Promise<PublicAppSettings> {
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

  return patchAppSettings(client, { runRetentionDays: days }, "update-run-retention-days");
}

/**
 * Validate and persist global OpenRouter model defaults for tagger, scorer,
 * drafter, titleDek, and embedder. Empty string clears a global override.
 * Partial-updates only the five model attributes + `updatedAt`.
 */
export async function updateGlobalModelDefaults(
  client: Client,
  models: GlobalModelDefaults,
): Promise<PublicAppSettings> {
  const normalized = validateGlobalModelDefaults(models);
  return patchAppSettings(
    client,
    {
      taggerModel: normalized.taggerModel,
      scorerModel: normalized.scorerModel,
      drafterModel: normalized.drafterModel,
      titleDekModel: normalized.titleDekModel,
      embedderModel: normalized.embedderModel,
    },
    "update-global-model-defaults",
  );
}

/**
 * Connections section writer. Secrets use keep-sentinel (`""` keeps stored).
 * Partial-updates only connection attributes + `updatedAt`. Encrypts on write.
 */
export async function updateConnectionSettings(
  client: Client,
  input: UpdateConnectionInput,
): Promise<PublicAppSettings> {
  const databases = new Databases(client);
  const storedDoc = await getRawAppSettingsDocument(databases);
  const storedKey = rawStoredSecret(storedDoc, "openRouterApiKey");
  const storedPassword = rawStoredSecret(storedDoc, "smtpPassword");

  const keepKey = isKeepSentinel(input.openRouterApiKey);
  const keepPassword = isKeepSentinel(input.smtpPassword);
  const incomingKey = keepKey ? "" : validateOpenRouterApiKey(input.openRouterApiKey);
  const effectiveKeyRaw = keepKey ? storedKey : incomingKey;
  const effectivePasswordRaw = keepPassword ? storedPassword : input.smtpPassword;

  validateEffectiveOpenRouterKey(effectiveKeyRaw);
  const smtp = validateSmtpBundle({
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpUsername: input.smtpUsername,
    smtpPassword: effectivePasswordRaw,
    smtpFrom: input.smtpFrom,
    smtpSecure: input.smtpSecure,
  });
  const appPublicUrl = validateAppPublicUrl(input.appPublicUrl);

  const openRouterApiKey = persistResolvedSecret(storedKey, keepKey, incomingKey);
  const smtpPassword = persistResolvedSecret(storedPassword, keepPassword, smtp.smtpPassword);

  return patchAppSettings(
    client,
    {
      openRouterApiKey,
      smtpHost: smtp.smtpHost,
      smtpPort: smtp.smtpPort,
      smtpUsername: smtp.smtpUsername,
      smtpPassword,
      smtpFrom: smtp.smtpFrom,
      smtpSecure: smtp.smtpSecure,
      appPublicUrl,
    },
    "update-connection-settings",
  );
}

export async function updatePipelineKnobsSettings(
  client: Client,
  input: UpdatePipelineKnobsInput,
): Promise<PublicAppSettings> {
  const knobs = validatePipelineKnobsSettings(input);
  return patchAppSettings(client, { ...knobs }, "update-pipeline-knobs-settings");
}

export async function clearOpenRouterApiKeyOverride(client: Client): Promise<PublicAppSettings> {
  return patchAppSettings(client, { openRouterApiKey: "" }, "clear-openrouter-api-key-override");
}

export async function clearSmtpBundleOverride(client: Client): Promise<PublicAppSettings> {
  return patchAppSettings(
    client,
    {
      smtpHost: "",
      smtpPort: null,
      smtpUsername: "",
      smtpPassword: "",
      smtpFrom: "",
      smtpSecure: "",
    },
    "clear-smtp-bundle-override",
  );
}

export async function getSettingsSecretsHealth(client: Client): Promise<SettingsSecretsHealth> {
  const cipher = settingsCipherStatus();
  const databases = new Databases(client);
  const doc = await getRawAppSettingsDocument(databases);
  if (!doc) {
    return { cipher, storedSecretCount: 0, unreadableSecretCount: 0 };
  }

  const fields = [doc.openRouterApiKey, doc.smtpPassword];
  let stored = 0;
  let unreadable = 0;
  for (const raw of fields) {
    const value = mapOptionalStringFromDocument(raw);
    if (value === "") continue;
    stored += 1;
    if (isEncryptedSecretValue(value) && decryptSecretValue(value) === "") {
      unreadable += 1;
    }
  }
  return {
    cipher,
    storedSecretCount: stored as 0 | 1 | 2,
    unreadableSecretCount: unreadable,
  };
}
