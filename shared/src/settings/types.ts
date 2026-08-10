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
  embedderModel: string;
}
