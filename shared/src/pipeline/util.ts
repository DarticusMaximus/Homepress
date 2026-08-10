/**
 * Small shared pipeline utilities. Kept dependency-free so any phase can import
 * it without pulling in LLM/network code.
 */

/**
 * Bound a free-text message before it is interpolated into a human-facing
 * `haltReason` string (O1-20260630). Raw LLM error messages can be arbitrarily
 * long and contain embedded newlines, which corrupt single-line log records,
 * run summaries, and Appwrite document fields. The full raw content stays on
 * the originating error object (e.g. {@link import("./scorer").ScoreParseError.raw}
 * retains the full raw response) — this helper only bounds the human-facing
 * summary string.
 *
 * PINNED behavior: replace runs of `\r`/`\n` with a single space first (so
 * words separated by a newline don't get glued together), THEN slice to `max`
 * UTF-16 code units. Edge cases:
 * - input shorter than `max` → unchanged except newline flattening.
 * - input exactly `max` long (after flattening) → unchanged.
 * - multi-byte / emoji: JS `String.prototype.slice` operates on UTF-16 code
 *   units; a surrogate pair may be split. Acceptable for an error summary.
 *
 * @param msg - the raw message to bound.
 * @param max - max length in UTF-16 code units (default 200).
 */
export function truncateForHaltReason(msg: string, max = 200): string {
  return msg.replace(/[\r\n]+/g, " ").slice(0, max);
}
