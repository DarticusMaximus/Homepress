/**
 * Pipeline configuration constants and helpers.
 *
 * Pure config: no LLM calls, no network, no Appwrite, no persistence.
 * Mirrors the legacy Python `config/settings.py` semantics byte-for-byte.
 */

export type DateRange = "yesterday" | "last_3_days" | "last_week" | "all";

export type ModelComponent = "tagger" | "scorer" | "drafter" | "embedder";

export const DEFAULT_MODELS = {
  tagger: "nvidia/nemotron-3-nano-30b-a3b",
  scorer: "nvidia/nemotron-3-nano-30b-a3b",
  drafter: "google/gemini-3-flash-preview",
  embedder: "google/gemini-embedding-001",
} as const;

export const DEFAULT_TIMEOUT_MS = 60000;
/**
 * Per-request timeout for the drafter LLM call. Drafting a full newsletter
 * (high reasoning effort, up to 32k completion tokens) routinely exceeds the
 * shared {@link DEFAULT_TIMEOUT_MS} used by short per-article tagger/scorer calls.
 */
export const DRAFTER_TIMEOUT_MS = 180_000;
export const DEFAULT_MAX_RETRIES = 3;
/**
 * Cap on extracted/cleaned article TEXT fed into an LLM prompt (chars).
 * Applies to the post-Readability markdown, NOT to the raw HTTP body.
 */
export const DEFAULT_MAX_CONTENT_LENGTH = 70000;
/**
 * Cap on a raw HTTP response body buffered by the fetcher/scraper (bytes).
 * This is a DoS guard against hostile multi-gigabyte feeds/articles, NOT a
 * prompt-truncation limit — real article HTML pages run hundreds of KB before
 * Readability extracts the ~2–10KB of actual content. Distinct from
 * {@link DEFAULT_MAX_CONTENT_LENGTH} (a char cap on already-extracted text).
 */
export const DEFAULT_MAX_FETCH_BYTES = 5_000_000;
export const DEFAULT_SCORE_THRESHOLD = 7.0;
export const DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD = 0.85;
export const CROSS_RUN_SIMILARITY_THRESHOLD_ENV = "CROSS_RUN_SIMILARITY_THRESHOLD";

export const ENV_MODEL_KEYS: Record<ModelComponent, string> = {
  tagger: "TAGGER_MODEL",
  scorer: "SCORER_MODEL",
  drafter: "DRAFTER_MODEL",
  embedder: "EMBED_MODEL",
};

export function getModelName(component: ModelComponent): string {
  const envKey = ENV_MODEL_KEYS[component];
  const override = process.env[envKey];
  if (override !== undefined && override !== "") {
    return override;
  }
  return DEFAULT_MODELS[component];
}

/**
 * Resolve the timezone from the TZ env var, mirroring the legacy
 * `config/settings.get_timezone`. Defaults to UTC when unset or when `Intl`
 * cannot resolve the supplied zone.
 */
function resolveTimezone(): string {
  const tz = process.env.TZ;
  if (!tz) return "UTC";
  try {
    // Probe: throws if the zone is not in the IANA database.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).formatToParts(new Date());
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Returns the wall-clock calendar date (year, month, day) of "now" in the
 * given IANA timezone. Month is 1-indexed.
 */
function todayInTz(tz: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

/**
 * Returns the timezone offset (in ms) in effect at the given UTC instant for
 * the given IANA timezone. Positive = east of UTC. Computed by formatting the
 * instant as wall-clock components in the tz and re-interpreting those
 * components as UTC; the difference vs. the original instant is the offset.
 */
function offsetAt(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Returns the UTC instant corresponding to 00:00:00.000 (midnight) of the
 * given wall-clock calendar date in the given IANA timezone.
 *
 * Relationship: wall_clock(t) = t + offset(t). We want the instant t where
 * wall_clock(t) == Date.UTC(year, month-1, day) (the target midnight expressed
 * as a UTC value). So t = target - offset(t). Because the offset itself
 * depends on t (DST), iterate a few times until t stabilises — this naturally
 * handles DST transitions that straddle midnight.
 */
function midnightInTz(year: number, month: number, day: number, tz: string): Date {
  const target = Date.UTC(year, month - 1, day);
  let instant = target - offsetAt(target, tz);
  for (let i = 0; i < 3; i++) {
    const adjusted = target - offsetAt(instant, tz);
    if (adjusted === instant) break;
    instant = adjusted;
  }
  return new Date(instant);
}

export interface DateWindow {
  start: Date;
  end: Date | null;
}

export function getDateFilter(range: DateRange | string): DateWindow {
  const tz = resolveTimezone();
  const today = todayInTz(tz);
  const midnightToday = midnightInTz(today.year, today.month, today.day, tz);

  switch (range) {
    case "all":
      return { start: new Date(0), end: null };
    case "last_3_days":
      return {
        start: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        end: new Date(),
      };
    case "last_week":
      return {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        end: new Date(),
      };
    case "yesterday":
    default: {
      // "yesterday" semantics: prior calendar day 00:00:00.000 → 23:59:59.999
      // in the resolved timezone. Unknown ranges fall back to yesterday.
      // Compute yesterday's calendar date directly so DST transitions that
      // straddle midnight do not corrupt the start instant.
      const yesterdayUtc = midnightToday.getTime() - 24 * 60 * 60 * 1000;
      const yParts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(yesterdayUtc));
      const yGet = (t: string): number => Number(yParts.find((p) => p.type === t)!.value);
      const start = midnightInTz(yGet("year"), yGet("month"), yGet("day"), tz);
      const end = new Date(midnightToday.getTime() - 1);
      return { start, end };
    }
  }
}

export function parseScoreThreshold(value: string | number | undefined | null): number {
  if (value === undefined || value === null) {
    return DEFAULT_SCORE_THRESHOLD;
  }

  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else {
    const trimmed = value.trim();
    if (trimmed === "") {
      return DEFAULT_SCORE_THRESHOLD;
    }
    numeric = Number(trimmed);
  }

  if (!Number.isFinite(numeric)) {
    return DEFAULT_SCORE_THRESHOLD;
  }
  if (numeric < 0) {
    return 0;
  }
  if (numeric > 10) {
    return 10;
  }
  return numeric;
}

/**
 * Parse the cross-run similarity threshold. Accepts string | number | undefined
 * | null. Empty/NaN/non-finite/invalid → DEFAULT (0.85); finite number → clamped
 * to [0, 1].
 */
export function parseCrossRunSimilarityThreshold(
  value: string | number | undefined | null,
): number {
  if (value === undefined || value === null) {
    return DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD;
  }

  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else {
    const trimmed = value.trim();
    if (trimmed === "") {
      return DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD;
    }
    numeric = Number(trimmed);
  }

  if (!Number.isFinite(numeric)) {
    return DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD;
  }
  if (numeric > 1) {
    return 1;
  }
  if (numeric <= 0) {
    return 0;
  }
  return numeric;
}

/**
 * Read the cross-run similarity threshold from
 * `process.env[CROSS_RUN_SIMILARITY_THRESHOLD_ENV]` via
 * {@link parseCrossRunSimilarityThreshold}. Env values are always strings.
 */
export function getCrossRunSimilarityThreshold(): number {
  return parseCrossRunSimilarityThreshold(process.env[CROSS_RUN_SIMILARITY_THRESHOLD_ENV]);
}
