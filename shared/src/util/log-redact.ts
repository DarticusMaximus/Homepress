const REDACTED = "[redacted]";

const SK_TOKEN = /sk[-_][A-Za-z0-9_-]+/g;
const BEARER_TOKEN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const LONG_RUN = /[A-Za-z0-9_-]{24,}/g;

function redactSecrets(input: string): string {
  return input
    .replace(SK_TOKEN, REDACTED)
    .replace(BEARER_TOKEN, REDACTED)
    .replace(LONG_RUN, REDACTED);
}

/**
 * Bound and de-secret an Appwrite error message before it is written to server
 * logs. Redaction runs first (so a long key is fully replaced before any
 * slicing could leave a partial tail), then the result is truncated to
 * `maxLen` characters. Never used for the thrown / returned user-facing
 * message — only for the `message` field of structured `console.error` logs.
 */
export function sanitizeAppwriteMessageForLog(raw: string, maxLen = 160): string {
  const redacted = redactSecrets(raw);
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}...`;
}

/**
 * Redact secrets from an error message before persisting it to the database
 * (e.g. `failureMessage` on a run document). Redaction runs first so a long
 * key is fully replaced before truncation could leave a partial tail; the
 * result is then hard-truncated to `maxLen`.
 */
export function redactMessageForStorage(raw: string, maxLen: number): string {
  return redactSecrets(raw).slice(0, maxLen);
}

/**
 * Summarise an unknown thrown value for structured logs. Prefers a non-empty
 * string `message` and a numeric `code` when the value is AppwriteException-
 * shaped; otherwise `String(err)`. Does not dump arbitrary objects.
 */
export function describeError(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown };
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}
