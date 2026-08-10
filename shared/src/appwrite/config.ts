export type AppwriteConfig = {
  endpoint: string;
  projectId: string;
  apiKey: string;
};

/**
 * Read an env var at runtime via dynamic key access.
 *
 * Next.js inlines static `process.env.NEXT_PUBLIC_*` references at build time.
 * Dynamic access keeps Homepress images configurable from `.env` / container
 * env without rebuilding (all Appwrite config is server-side only).
 */
export function readRuntimeEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getAppwriteEndpoint(): string | undefined {
  return readRuntimeEnv("NEXT_PUBLIC_APPWRITE_ENDPOINT");
}

export function getAppwriteProjectId(): string | undefined {
  return readRuntimeEnv("NEXT_PUBLIC_APPWRITE_PROJECT_ID");
}

export function getAppwriteConfig(): AppwriteConfig {
  const endpoint = getAppwriteEndpoint();
  const projectId = getAppwriteProjectId();
  const apiKey = readRuntimeEnv("APPWRITE_API_KEY");

  if (!endpoint) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APPWRITE_ENDPOINT");
  }
  if (!projectId) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_APPWRITE_PROJECT_ID");
  }
  if (!apiKey) {
    throw new Error("Missing required environment variable: APPWRITE_API_KEY");
  }

  return { endpoint, projectId, apiKey };
}
