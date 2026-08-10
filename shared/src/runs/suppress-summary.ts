import type { SuppressSummary, SuppressItem } from "../pipeline/cross-run-suppress";

/**
 * Serialize a {@link SuppressSummary} for run-record storage.
 *
 * `count === 0` → `""` (empty string). Otherwise the full JSON
 * (`{ "count": N, "items": [...] }`).
 */
export function serializeSuppressSummary(summary: SuppressSummary): string {
  if (summary.count === 0) {
    return "";
  }
  return JSON.stringify(summary);
}

/**
 * Parse a stored suppress-summary JSON string back into a typed
 * {@link SuppressSummary}.
 *
 * - Non-string / empty / whitespace-only → `{ count: 0, items: [] }`.
 * - Invalid JSON → `{ count: 0, items: [] }` (logs the parse error).
 * - Valid object → best-effort coerced items; malformed entries are dropped,
 *   missing string fields default to `""`, a non-number `similarity` defaults
 *   to `0`. `count` is always recomputed from the validated `items.length` so
 *   the invariant `count === items.length` holds even if the stored count was
 *   wrong.
 */
export function parseSuppressSummary(raw: string): SuppressSummary {
  const empty: SuppressSummary = { count: 0, items: [] };
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error({
      phase: "parse-suppress-summary",
      message: "Invalid JSON in suppress summary, returning empty",
    });
    return empty;
  }

  if (parsed === null || typeof parsed !== "object") {
    return empty;
  }

  const obj = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];

  const items: SuppressItem[] = [];
  for (const entry of rawItems) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    items.push({
      title: typeof e.title === "string" ? e.title : "",
      link: typeof e.link === "string" ? e.link : "",
      matchedRunId: typeof e.matchedRunId === "string" ? e.matchedRunId : "",
      matchedTitle: typeof e.matchedTitle === "string" ? e.matchedTitle : "",
      similarity: typeof e.similarity === "number" ? e.similarity : 0,
    });
  }

  return { count: items.length, items };
}
