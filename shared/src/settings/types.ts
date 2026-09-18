export type SettingsRepositoryErrorCode = "validation" | "appwrite";

export class SettingsRepositoryError extends Error {
  readonly code: SettingsRepositoryErrorCode;

  constructor(code: SettingsRepositoryErrorCode, message: string) {
    super(message);
    this.name = "SettingsRepositoryError";
    this.code = code;
  }
}

/** In-memory app settings record mapped from the singleton document. */
export interface AppSettings {
  runRetentionDays: number;
  updatedAt: string;
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  titleDekModel: string;
  embedderModel: string;
  /** Stage 12 operator overrides — strings `""` when unset; optional numbers `null`. */
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
}

/** GUI-facing settings: secret fields replaced with presence booleans. */
export type PublicAppSettings = Omit<AppSettings, "openRouterApiKey" | "smtpPassword"> & {
  hasOpenRouterApiKey: boolean;
  hasSmtpPassword: boolean;
};

export type SettingsSecretsHealth = {
  cipher: "off" | "on" | "invalid";
  storedSecretCount: 0 | 1 | 2;
  unreadableSecretCount: number;
};
