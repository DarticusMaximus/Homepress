import { cookies } from "next/headers";
import { Client, Account, type Models } from "node-appwrite";
import { getAppwriteEndpoint, getAppwriteProjectId } from "@newsletter/shared";

/**
 * Extract the bare session secret from an Appwrite session cookie value.
 *
 * The Appwrite server sets the HTTP cookie `a_session_<projectId>` to the raw
 * session secret. Under some proxies/SDKs the value is additionally URL-encoded
 * or wrapped as a JSON string/array. We decode defensively: try URI-decoding,
 * then JSON-parse; if that yields a string/array, unwrap it, otherwise fall back
 * to the decoded raw value.
 *
 * This mirrors how the browser SDK reads the session back (cookieFallback is a
 * JSON object keyed by `a_session_<project>` — sdk.js:737-738), adapted for the
 * server-side HTTP cookie that carries the bare secret.
 */
export function extractSessionSecret(rawCookieValue: string | undefined): string | null {
  if (!rawCookieValue) {
    return null;
  }

  let value = rawCookieValue;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Value was not URI-encoded; keep the original.
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      return parsed;
    }
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      return parsed[0];
    }
  } catch {
    // Not JSON — treat the decoded value itself as the secret.
  }

  return value;
}

/**
 * Build a node-appwrite Client authenticated with the end user's session
 * secret (NOT the server API key). `account.get()` on this client succeeds only
 * if the user has a valid, unexpired session — making the gate authoritative.
 */
function createSessionClient(secret: string): Account {
  const endpoint = getAppwriteEndpoint();
  const projectId = getAppwriteProjectId();
  if (!endpoint || !projectId) {
    throw new Error("Missing Appwrite env config");
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setSession(secret);

  return new Account(client);
}

/**
 * Validate the end user's session authoritatively. Returns the current user if
 * the session is valid, or `null` if the cookie is absent, malformed, or the
 * session is invalid/expired. Never throws.
 */
export async function getAuthenticatedUser(): Promise<Models.User<Models.Preferences> | null> {
  const projectId = getAppwriteProjectId();
  if (!projectId) {
    return null;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(`a_session_${projectId}`)?.value;
  const secret = extractSessionSecret(raw);
  if (!secret) {
    return null;
  }

  try {
    const account = createSessionClient(secret);
    return await account.get();
  } catch {
    return null;
  }
}
