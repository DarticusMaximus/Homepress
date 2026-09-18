/**
 * Guards for Appwrite document ids and list-query limits. Untrusted path
 * segments and query params go through these before they ever hit a
 * collection lookup or `Query.limit`.
 */

/** Appwrite's max custom-id length. `ID.unique()` ids are 26 chars. */
export const APWRITE_DOCUMENT_ID_MAX = 36;

const APPWRITE_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,36}$/;

/**
 * Same charset as `web/lib/newsletter-id.ts` (`A-Za-z0-9_-`), plus a hard
 * 1–36 length bound so `/`, `.`, `?`, empty, and over-length ids never
 * reach Appwrite as a document id.
 */
export function isValidAppwriteDocumentId(id: string): boolean {
  return APPWRITE_DOCUMENT_ID.test(id);
}

export const LIST_LIMIT_MAX = 500;

/**
 * Coerce an untrusted list-limit into `[1, 500]`. `undefined` keeps the
 * caller-supplied fallback (which is assumed already in range).
 */
export function clampListLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), LIST_LIMIT_MAX);
}
