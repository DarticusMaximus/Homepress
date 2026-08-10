/**
 * Safe Appwrite-style document id for URL path segments.
 * Alphanumeric plus `_` / `-` only — rejects `/`, `.`, `?`, `#`, spaces, etc.
 */
const SAFE_NEWSLETTER_ID = /^[a-zA-Z0-9_-]+$/;

export function isSafeNewsletterId(id: string): boolean {
  return SAFE_NEWSLETTER_ID.test(id);
}
