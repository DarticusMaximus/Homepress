/**
 * Maps a thrown login error to a safe, fixed user-facing message.
 *
 * Never throws. Never returns undefined. The real error detail must be logged
 * server-side by the caller (`console.error`); only the mapped string here is
 * ever surfaced to the client, so no Appwrite endpoint host or API key leaks.
 */
const CREDENTIALS_MESSAGE = "Invalid email or password";
const GENERIC_MESSAGE = "Login failed. Please try again.";

/**
 * Safely read a property from an unknown value, returning undefined if the
 * value is not an object, the property is absent, or the getter throws.
 */
function safeGet<T = unknown>(value: unknown, key: string): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  try {
    return (value as Record<string, T>)[key];
  } catch {
    return undefined;
  }
}

export function mapLoginError(err: unknown): string {
  // Read all signals defensively: hostile objects may throw on property access.
  const type = safeGet<unknown>(err, "type");
  const typeStr = typeof type === "string" ? type.toLowerCase() : "";
  const message = safeGet<unknown>(err, "message");
  const messageStr = typeof message === "string" ? message : "";
  const normalized = messageStr.toLowerCase();

  // Appwrite credentials failure. NOTE: we intentionally do NOT match on bare
  // `code === 401`. Appwrite overloads HTTP 401 for both a real wrong-password
  // credentials failure (`type: "user_invalid_credentials"`) AND a backend /
  // server-auth failure such as a misconfigured or expired API key
  // (`type: "user_unauthorized`). The latter must fall through to the generic
  // message so a backend outage is never shown to the user as "Invalid email or
  // password". Match only on an explicit credentials `type` or known sdk
  // message fragments.
  if (
    typeStr === "user_invalid_credentials" ||
    normalized.includes("user_invalid_credentials") ||
    normalized.includes("invalid credentials")
  ) {
    return CREDENTIALS_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
