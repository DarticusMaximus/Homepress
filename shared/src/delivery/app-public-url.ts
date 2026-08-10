export class AppPublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppPublicUrlError";
  }
}

/**
 * Resolve the public app base URL from `APP_PUBLIC_URL`.
 * Strips a trailing slash. Never invents a host (e.g. localhost).
 */
export function resolveAppPublicUrl(): string {
  const raw = process.env.APP_PUBLIC_URL;
  if (raw === undefined || raw.trim() === "") {
    throw new AppPublicUrlError("Missing required environment variable: APP_PUBLIC_URL");
  }
  return raw.trim().replace(/\/+$/, "");
}
