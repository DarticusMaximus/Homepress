/**
 * Pure encode/decode helpers for the guided schedule builder UI.
 * Maps cadence + time ↔ canonical 5-field cron (minute hour * * dow).
 */

export type GuidedScheduleFrequency = "daily" | "weekdays" | "weekly" | "custom";

/**
 * Guided builder state. `daysOfWeek` uses cron numbering: 0 = Sunday … 6 = Saturday.
 * - daily / weekdays: unused (empty)
 * - weekly: exactly one day
 * - custom: one or more unique days (encode throws if empty)
 */
export interface GuidedScheduleState {
  frequency: GuidedScheduleFrequency;
  hour: number;
  minute: number;
  daysOfWeek: number[];
}

/** Default seed when cron is blank: Weekdays at 09:00 → `0 9 * * 1-5`. */
export const DEFAULT_GUIDED_SCHEDULE: GuidedScheduleState = {
  frequency: "weekdays",
  hour: 9,
  minute: 0,
  daysOfWeek: [],
};

function normalizeDow(n: number): number {
  return n === 7 ? 0 : n;
}

function canonicalizeDays(days: number[]): number[] {
  const normalized = days.map(normalizeDow);
  return [...new Set(normalized)].sort((a, b) => a - b);
}

/**
 * Produce a canonical 5-field cron from guided state.
 * Minute/hour are decimal integers with no leading zeros (`0` not `00`).
 * Sunday is always emitted as `0`, never `7`.
 * Custom with zero days throws.
 */
export function encodeGuidedCron(state: GuidedScheduleState): string {
  const minute = state.minute;
  const hour = state.hour;

  switch (state.frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly": {
      const dow = normalizeDow(state.daysOfWeek[0] ?? 0);
      return `${minute} ${hour} * * ${dow}`;
    }
    case "custom": {
      const days = canonicalizeDays(state.daysOfWeek);
      if (days.length === 0) {
        throw new Error("Custom weekdays require at least one day");
      }
      return `${minute} ${hour} * * ${days.join(",")}`;
    }
    default: {
      const _exhaustive: never = state.frequency;
      throw new Error(`Unknown guided frequency: ${_exhaustive}`);
    }
  }
}

function parseIntField(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) {
    return null;
  }
  const n = Number(field);
  if (!Number.isInteger(n) || n < min || n > max) {
    return null;
  }
  return n;
}

/**
 * Parse a comma-separated day-of-week list into unique sorted 0–6 days.
 * Accepts `7` as Sunday (normalized to `0`). Rejects steps, names, ranges, etc.
 */
function parseCustomDows(field: string): number[] | null {
  if (field.includes("/") || field.includes("-") || field.includes("#") || field.includes("?")) {
    return null;
  }
  if (/[a-zA-Z]/.test(field) || field.includes("L")) {
    return null;
  }

  const parts = field.split(",");
  if (parts.length === 0 || parts.some((p) => p.length === 0)) {
    return null;
  }

  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (!Number.isInteger(n) || (n < 0 || n > 7)) {
      return null;
    }
    days.push(normalizeDow(n));
  }

  const unique = canonicalizeDays(days);
  if (unique.length === 0) {
    return null;
  }
  return unique;
}

/**
 * Return guided state when cron matches a guided pattern; otherwise `null` (Custom).
 */
export function decodeGuidedCron(cron: string): GuidedScheduleState | null {
  const trimmed = cron.trim();
  if (trimmed.length === 0 || trimmed.startsWith("@")) {
    return null;
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const [minuteField, hourField, dom, month, dowField] = fields;

  if (dom !== "*" || month !== "*") {
    return null;
  }

  const minute = parseIntField(minuteField, 0, 59);
  if (minute === null || minute % 5 !== 0) {
    return null;
  }

  const hour = parseIntField(hourField, 0, 23);
  if (hour === null) {
    return null;
  }

  // Daily
  if (dowField === "*") {
    return { frequency: "daily", hour, minute, daysOfWeek: [] };
  }

  // Weekdays — only exact `1-5`
  if (dowField === "1-5") {
    return { frequency: "weekdays", hour, minute, daysOfWeek: [] };
  }

  // Weekly — single digit 0–6 (also accept 7 as Sunday)
  if (/^[0-7]$/.test(dowField)) {
    const dow = normalizeDow(Number(dowField));
    return { frequency: "weekly", hour, minute, daysOfWeek: [dow] };
  }

  // Custom weekdays — comma-separated unique 0–6 (normalize 7→0)
  // Literal `1,2,3,4,5` stays Custom (do not promote to Weekdays).
  if (dowField.includes(",")) {
    const days = parseCustomDows(dowField);
    if (days === null) {
      return null;
    }
    return { frequency: "custom", hour, minute, daysOfWeek: days };
  }

  // Reject everything else: steps, names, other ranges, L/#/?, etc.
  return null;
}
