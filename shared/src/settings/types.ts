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
