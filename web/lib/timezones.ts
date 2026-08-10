/** Pinned common IANA zones — order is intentional (spec Stage 10 Feature 01). */
export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

const COMMON_SET = new Set<string>(COMMON_TIMEZONES);

function supportedTimezones(): string[] {
  try {
    if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // fall through
  }
  return [...COMMON_TIMEZONES];
}

/**
 * Full IANA list with common zones first (pinned order), then the rest
 * alphabetical. Always includes at least the common set + UTC.
 */
export function listIanaTimezones(): string[] {
  const all = supportedTimezones();
  const rest = all
    .filter((zone) => !COMMON_SET.has(zone))
    .sort((a, b) => a.localeCompare(b));
  return [...COMMON_TIMEZONES, ...rest];
}

export type TimezoneGroup = {
  value: string;
  items: string[];
};

/**
 * Common-first groups for the timezone combobox.
 * When `selected` is unknown (not in the list), it is prepended to Common
 * so it remains selectable/visible.
 */
export function listTimezoneGroups(selected?: string): TimezoneGroup[] {
  const all = listIanaTimezones();
  const common: string[] = [...COMMON_TIMEZONES];
  const other = all.filter((zone) => !COMMON_SET.has(zone));

  if (selected && selected.length > 0 && !all.includes(selected)) {
    common.unshift(selected);
  }

  return [
    { value: "Common", items: common },
    { value: "All timezones", items: other },
  ];
}
