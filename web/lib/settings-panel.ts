import type { AppSettings, ResolvedOperatorSettings, SettingsSource } from "@newsletter/shared";

/** Cascade source labels for Settings panel display. */
export type SettingsSourceLabel = SettingsSource;

/**
 * Secret-stripped DTO for the Settings page client sections.
 * Never includes OpenRouter key or SMTP password string values.
 */
export type SettingsPanelData = {
  openRouterApiKeySet: boolean;
  smtpHost: string;
  smtpPort: number | null;
  smtpUsername: string;
  smtpPasswordSet: boolean;
  smtpFrom: string;
  smtpSecure: string;
  appPublicUrl: string;
  scoreThreshold: number | null;
  crossRunSimilarityThreshold: number | null;
  rssFeedMaxItems: number | null;
  drafterReasoningEffort: string;
  drafterMaxCompletionTokens: number | null;
  resolved: {
    openRouterApiKey: { source: SettingsSourceLabel };
    smtp: {
      source: SettingsSourceLabel;
      host: string | null;
      port: number | null;
      username: string | null;
      from: string | null;
      secure: boolean | null;
    };
    appPublicUrl: { value: string | null; source: SettingsSourceLabel };
    scoreThreshold: { value: number; source: Exclude<SettingsSourceLabel, "none"> };
    crossRunSimilarityThreshold: {
      value: number;
      source: Exclude<SettingsSourceLabel, "none">;
    };
    rssFeedMaxItems: { value: number; source: Exclude<SettingsSourceLabel, "none"> };
    drafterReasoningEffort: {
      value: "low" | "medium" | "high";
      source: Exclude<SettingsSourceLabel, "none">;
    };
    drafterMaxCompletionTokens: {
      value: number;
      source: Exclude<SettingsSourceLabel, "none">;
    };
  };
};

/**
 * Map stored settings + resolver output into a browser-safe Settings panel DTO.
 * Secret fields become booleans / source-only; raw key/password strings are never copied.
 */
export function toSettingsPanelData(
  settings: AppSettings,
  resolved: ResolvedOperatorSettings,
): SettingsPanelData {
  const smtp = resolved.smtp.value;

  return {
    openRouterApiKeySet: settings.openRouterApiKey.trim() !== "",
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUsername: settings.smtpUsername,
    smtpPasswordSet: settings.smtpPassword.trim() !== "",
    smtpFrom: settings.smtpFrom,
    smtpSecure: settings.smtpSecure,
    appPublicUrl: settings.appPublicUrl,
    scoreThreshold: settings.scoreThreshold,
    crossRunSimilarityThreshold: settings.crossRunSimilarityThreshold,
    rssFeedMaxItems: settings.rssFeedMaxItems,
    drafterReasoningEffort: settings.drafterReasoningEffort,
    drafterMaxCompletionTokens: settings.drafterMaxCompletionTokens,
    resolved: {
      openRouterApiKey: { source: resolved.openRouterApiKey.source },
      smtp: {
        source: resolved.smtp.source,
        host: smtp?.host ?? null,
        port: smtp?.port ?? null,
        username: smtp?.username ?? null,
        from: smtp?.from ?? null,
        secure: smtp?.secure ?? null,
      },
      appPublicUrl: {
        value: resolved.appPublicUrl.value,
        source: resolved.appPublicUrl.source,
      },
      scoreThreshold: resolved.scoreThreshold,
      crossRunSimilarityThreshold: resolved.crossRunSimilarityThreshold,
      rssFeedMaxItems: resolved.rssFeedMaxItems,
      drafterReasoningEffort: resolved.drafterReasoningEffort,
      drafterMaxCompletionTokens: resolved.drafterMaxCompletionTokens,
    },
  };
}
