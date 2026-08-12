import type { Client } from "node-appwrite";

import { resolveOperatorSettings } from "../settings/resolve-operator-settings";
import type { SettingsSource } from "../settings/resolve-operator-settings";

export class AppPublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppPublicUrlError";
  }
}

/** Cascade field shape for `appPublicUrl` (GUI → env → none). */
export type ResolvedAppPublicUrlField = {
  value: string | null;
  source: SettingsSource;
};

/**
 * Resolve the public app base URL from `APP_PUBLIC_URL`.
 * Strips a trailing slash. Never invents a host (e.g. localhost).
 *
 * Env-only helper kept for legacy/unit tests. Production callers should use
 * {@link resolveEffectiveAppPublicUrl} (Stage 12 cascade).
 */
export function resolveAppPublicUrl(): string {
  const raw = process.env.APP_PUBLIC_URL;
  if (raw === undefined || raw.trim() === "") {
    throw new AppPublicUrlError("Missing required environment variable: APP_PUBLIC_URL");
  }
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Extract the public base URL from an already-resolved operator-settings snapshot.
 * Throws {@link AppPublicUrlError} when unset — never invents a host.
 * Prefer this on paths that already called `resolveOperatorSettings` (e.g. RSS GET).
 */
export function appPublicUrlFromResolved(appPublicUrl: ResolvedAppPublicUrlField): string {
  const { value, source } = appPublicUrl;
  if (source === "none" || value === null || value.trim() === "") {
    throw new AppPublicUrlError(
      "Missing public URL. Set it in Settings or APP_PUBLIC_URL.",
    );
  }
  return value.trim().replace(/\/+$/, "");
}

/**
 * Resolve the public app base URL via Feature 01 `resolveOperatorSettings`
 * (GUI → env). Throws {@link AppPublicUrlError} when unset — never invents a host.
 */
export async function resolveEffectiveAppPublicUrl(client: Client): Promise<string> {
  const resolved = await resolveOperatorSettings(client);
  return appPublicUrlFromResolved(resolved.appPublicUrl);
}
