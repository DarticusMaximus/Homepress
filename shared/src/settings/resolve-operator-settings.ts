import type { Client } from "node-appwrite";
import type { SmtpConfig } from "../delivery/smtp-config";
import {
  CROSS_RUN_SIMILARITY_THRESHOLD_ENV,
  DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
  DEFAULT_SCORE_THRESHOLD,
  DRAFTER_MAX_COMPLETION_TOKENS_ENV,
  DRAFTER_REASONING_EFFORT_ENV,
  RSS_FEED_MAX_ITEMS_ENV,
  SCORE_THRESHOLD_ENV,
} from "../pipeline/config";
import {
  DRAFTER_MAX_COMPLETION_TOKENS,
  DRAFTER_REASONING_EFFORT,
} from "../pipeline/drafter";
import { RSS_FEED_MAX_ITEMS } from "../schema/declarations";
import {
  CROSS_RUN_SIMILARITY_THRESHOLD_MAX,
  CROSS_RUN_SIMILARITY_THRESHOLD_MIN,
  DRAFTER_MAX_COMPLETION_TOKENS_MAX,
  DRAFTER_MAX_COMPLETION_TOKENS_MIN,
  DRAFTER_REASONING_EFFORTS,
  type DrafterReasoningEffort,
  parseSmtpSecureFlag,
  RSS_FEED_MAX_ITEMS_MAX,
  RSS_FEED_MAX_ITEMS_MIN,
  SCORE_THRESHOLD_MAX,
  SCORE_THRESHOLD_MIN,
} from "./operator-settings";
import { getOrCreateAppSettings } from "./repository";
import type { AppSettings } from "./types";

/** Re-export env key names for Feature 04 consumers. */
export {
  CROSS_RUN_SIMILARITY_THRESHOLD_ENV,
  DRAFTER_MAX_COMPLETION_TOKENS_ENV,
  DRAFTER_REASONING_EFFORT_ENV,
  RSS_FEED_MAX_ITEMS_ENV,
  SCORE_THRESHOLD_ENV,
};

export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";
export const APP_PUBLIC_URL_ENV = "APP_PUBLIC_URL";
export const SMTP_HOST_ENV = "SMTP_HOST";
export const SMTP_PORT_ENV = "SMTP_PORT";
export const SMTP_USERNAME_ENV = "SMTP_USERNAME";
export const SMTP_PASSWORD_ENV = "SMTP_PASSWORD";
export const SMTP_FROM_ENV = "SMTP_FROM";
export const SMTP_SECURE_ENV = "SMTP_SECURE";

export type SettingsSource = "gui" | "env" | "default" | "none";

export type ResolvedOperatorSettings = {
  openRouterApiKey: { value: string | null; source: SettingsSource };
  smtp: { value: SmtpConfig | null; source: SettingsSource };
  appPublicUrl: { value: string | null; source: SettingsSource };
  scoreThreshold: { value: number; source: Exclude<SettingsSource, "none"> };
  crossRunSimilarityThreshold: {
    value: number;
    source: Exclude<SettingsSource, "none">;
  };
  rssFeedMaxItems: { value: number; source: Exclude<SettingsSource, "none"> };
  drafterReasoningEffort: {
    value: DrafterReasoningEffort;
    source: Exclude<SettingsSource, "none">;
  };
  drafterMaxCompletionTokens: {
    value: number;
    source: Exclude<SettingsSource, "none">;
  };
};

function trimPresent(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function tryParseFiniteInRange(
  raw: string | undefined,
  opts: { min: number; max: number; integer?: boolean },
): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  if (opts.integer && !Number.isInteger(numeric)) return null;
  if (numeric < opts.min || numeric > opts.max) return null;
  return numeric;
}

/** Strict env try-parse: empty / non-finite / out-of-range → `null` (no clamp-as-env). */
export function tryParseScoreThresholdEnv(raw: string | undefined): number | null {
  return tryParseFiniteInRange(raw, {
    min: SCORE_THRESHOLD_MIN,
    max: SCORE_THRESHOLD_MAX,
  });
}

/** Strict env try-parse for cross-run similarity in `[0, 1]`. */
export function tryParseCrossRunSimilarityThresholdEnv(
  raw: string | undefined,
): number | null {
  return tryParseFiniteInRange(raw, {
    min: CROSS_RUN_SIMILARITY_THRESHOLD_MIN,
    max: CROSS_RUN_SIMILARITY_THRESHOLD_MAX,
  });
}

/** Strict env try-parse for RSS last-N integer in `1…50`. */
export function tryParseRssFeedMaxItemsEnv(raw: string | undefined): number | null {
  return tryParseFiniteInRange(raw, {
    min: RSS_FEED_MAX_ITEMS_MIN,
    max: RSS_FEED_MAX_ITEMS_MAX,
    integer: true,
  });
}

/** Strict env try-parse for drafter reasoning effort enum. */
export function tryParseDrafterReasoningEffortEnv(
  raw: string | undefined,
): DrafterReasoningEffort | null {
  const trimmed = trimPresent(raw);
  if (trimmed === null) return null;
  if (!(DRAFTER_REASONING_EFFORTS as readonly string[]).includes(trimmed)) {
    return null;
  }
  return trimmed as DrafterReasoningEffort;
}

/** Strict env try-parse for drafter max completion tokens in `1024…128000`. */
export function tryParseDrafterMaxCompletionTokensEnv(
  raw: string | undefined,
): number | null {
  return tryParseFiniteInRange(raw, {
    min: DRAFTER_MAX_COMPLETION_TOKENS_MIN,
    max: DRAFTER_MAX_COMPLETION_TOKENS_MAX,
    integer: true,
  });
}

/**
 * Try to resolve SMTP from env (all-or-nothing required quartet).
 * Optional FROM falls back to username; SECURE defaults false — same as
 * {@link resolveSmtpConfig}, without throwing or touching production callers.
 */
export function tryResolveSmtpConfigFromEnv(
  env: NodeJS.ProcessEnv,
): SmtpConfig | null {
  const host = trimPresent(env[SMTP_HOST_ENV]);
  const portRaw = trimPresent(env[SMTP_PORT_ENV]);
  const username = trimPresent(env[SMTP_USERNAME_ENV]);
  const passwordRaw = env[SMTP_PASSWORD_ENV];
  const password =
    passwordRaw === undefined || passwordRaw.trim() === ""
      ? null
      : passwordRaw.trim();

  if (host === null || portRaw === null || username === null || password === null) {
    return null;
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || String(port) !== portRaw || port <= 0) {
    return null;
  }

  const fromRaw = trimPresent(env[SMTP_FROM_ENV]);
  return {
    host,
    port,
    username,
    password,
    from: fromRaw ?? username,
    secure: parseSmtpSecureFlag(env[SMTP_SECURE_ENV]),
  };
}

/** Try to resolve public URL from env; strips trailing slash; never invents a host. */
export function tryResolveAppPublicUrlFromEnv(
  env: NodeJS.ProcessEnv,
): string | null {
  const trimmed = trimPresent(env[APP_PUBLIC_URL_ENV]);
  if (trimmed === null) return null;
  return trimmed.replace(/\/+$/, "");
}

function tryGuiOptionalNumber(
  raw: number | null,
  opts: { min: number; max: number; integer?: boolean },
): number | null {
  if (raw === null) return null;
  if (!Number.isFinite(raw)) return null;
  if (opts.integer && !Number.isInteger(raw)) return null;
  if (raw < opts.min || raw > opts.max) return null;
  return raw;
}

function tryGuiReasoningEffort(raw: string): DrafterReasoningEffort | null {
  const trimmed = trimPresent(raw);
  if (trimmed === null) return null;
  if (!(DRAFTER_REASONING_EFFORTS as readonly string[]).includes(trimmed)) {
    return null;
  }
  return trimmed as DrafterReasoningEffort;
}

function isCompleteGuiSmtp(settings: AppSettings): boolean {
  const host = trimPresent(settings.smtpHost);
  const username = trimPresent(settings.smtpUsername);
  const password = trimPresent(settings.smtpPassword);
  const port = settings.smtpPort;
  return (
    host !== null &&
    username !== null &&
    password !== null &&
    port !== null &&
    Number.isFinite(port) &&
    Number.isInteger(port) &&
    port > 0
  );
}

function smtpFromGui(settings: AppSettings): SmtpConfig {
  const username = settings.smtpUsername.trim();
  const fromRaw = trimPresent(settings.smtpFrom);
  return {
    host: settings.smtpHost.trim(),
    port: settings.smtpPort as number,
    username,
    password: settings.smtpPassword.trim(),
    from: fromRaw ?? username,
    secure: parseSmtpSecureFlag(settings.smtpSecure),
  };
}

function resolveOptionalString(opts: {
  gui: string | null;
  env: string | null;
}): { value: string | null; source: SettingsSource } {
  if (opts.gui !== null) return { value: opts.gui, source: "gui" };
  if (opts.env !== null) return { value: opts.env, source: "env" };
  return { value: null, source: "none" };
}

function resolveKnob<T>(opts: {
  gui: T | null;
  env: T | null;
  defaultValue: T;
}): { value: T; source: Exclude<SettingsSource, "none"> } {
  if (opts.gui !== null) return { value: opts.gui, source: "gui" };
  if (opts.env !== null) return { value: opts.env, source: "env" };
  return { value: opts.defaultValue, source: "default" };
}

/**
 * Resolve Stage-12 operator settings: GUI override → env → code default.
 * SMTP is all-or-nothing (complete GUI quartet or whole-bundle env).
 * Env middle-tier uses strict try-parse (out-of-range → fall through to default).
 */
export async function resolveOperatorSettings(
  client: Client,
  opts?: { env?: NodeJS.ProcessEnv; settings?: AppSettings },
): Promise<ResolvedOperatorSettings> {
  const env = opts?.env ?? process.env;
  const settings = opts?.settings ?? (await getOrCreateAppSettings(client));

  const openRouterApiKey = resolveOptionalString({
    gui: trimPresent(settings.openRouterApiKey),
    env: trimPresent(env[OPENROUTER_API_KEY_ENV]),
  });

  const guiSmtp = isCompleteGuiSmtp(settings) ? smtpFromGui(settings) : null;
  const envSmtp = guiSmtp === null ? tryResolveSmtpConfigFromEnv(env) : null;
  const smtp: ResolvedOperatorSettings["smtp"] =
    guiSmtp !== null
      ? { value: guiSmtp, source: "gui" }
      : envSmtp !== null
        ? { value: envSmtp, source: "env" }
        : { value: null, source: "none" };

  const appPublicUrl = resolveOptionalString({
    gui: (() => {
      const raw = trimPresent(settings.appPublicUrl);
      return raw === null ? null : raw.replace(/\/+$/, "");
    })(),
    env: tryResolveAppPublicUrlFromEnv(env),
  });

  const scoreThreshold = resolveKnob({
    gui: tryGuiOptionalNumber(settings.scoreThreshold, {
      min: SCORE_THRESHOLD_MIN,
      max: SCORE_THRESHOLD_MAX,
    }),
    env: tryParseScoreThresholdEnv(env[SCORE_THRESHOLD_ENV]),
    defaultValue: DEFAULT_SCORE_THRESHOLD,
  });

  const crossRunSimilarityThreshold = resolveKnob({
    gui: tryGuiOptionalNumber(settings.crossRunSimilarityThreshold, {
      min: CROSS_RUN_SIMILARITY_THRESHOLD_MIN,
      max: CROSS_RUN_SIMILARITY_THRESHOLD_MAX,
    }),
    env: tryParseCrossRunSimilarityThresholdEnv(
      env[CROSS_RUN_SIMILARITY_THRESHOLD_ENV],
    ),
    defaultValue: DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
  });

  const rssFeedMaxItems = resolveKnob({
    gui: tryGuiOptionalNumber(settings.rssFeedMaxItems, {
      min: RSS_FEED_MAX_ITEMS_MIN,
      max: RSS_FEED_MAX_ITEMS_MAX,
      integer: true,
    }),
    env: tryParseRssFeedMaxItemsEnv(env[RSS_FEED_MAX_ITEMS_ENV]),
    defaultValue: RSS_FEED_MAX_ITEMS,
  });

  const drafterReasoningEffort = resolveKnob({
    gui: tryGuiReasoningEffort(settings.drafterReasoningEffort),
    env: tryParseDrafterReasoningEffortEnv(env[DRAFTER_REASONING_EFFORT_ENV]),
    defaultValue: DRAFTER_REASONING_EFFORT,
  });

  const drafterMaxCompletionTokens = resolveKnob({
    gui: tryGuiOptionalNumber(settings.drafterMaxCompletionTokens, {
      min: DRAFTER_MAX_COMPLETION_TOKENS_MIN,
      max: DRAFTER_MAX_COMPLETION_TOKENS_MAX,
      integer: true,
    }),
    env: tryParseDrafterMaxCompletionTokensEnv(
      env[DRAFTER_MAX_COMPLETION_TOKENS_ENV],
    ),
    defaultValue: DRAFTER_MAX_COMPLETION_TOKENS,
  });

  return {
    openRouterApiKey,
    smtp,
    appPublicUrl,
    scoreThreshold,
    crossRunSimilarityThreshold,
    rssFeedMaxItems,
    drafterReasoningEffort,
    drafterMaxCompletionTokens,
  };
}
