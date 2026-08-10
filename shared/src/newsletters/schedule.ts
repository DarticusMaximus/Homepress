import { CronExpressionParser } from "cron-parser";

import {
  DEFAULT_SCHEDULE_TIMEZONE,
  SCHEDULE_CRON_MAX_LENGTH,
  SCHEDULE_TIMEZONE_MAX_LENGTH,
} from "../schema/declarations";
import { NewsletterRepositoryError, type Newsletter } from "./types";

export interface NewsletterScheduleView {
  enabled: boolean;
  cron: string;
  timezone: string;
  /** ISO-8601 UTC instant of the next fire, or null when disabled. */
  nextFireAt: string | null;
}

export interface UpdateNewsletterScheduleInput {
  scheduleEnabled: boolean;
  scheduleCron: string;
  scheduleTimezone: string;
}

type NewsletterScheduleSource = Pick<
  UpdateNewsletterScheduleInput,
  "scheduleEnabled" | "scheduleCron" | "scheduleTimezone"
>;

export function isValidIanaTimezone(tz: string): boolean {
  if (tz.length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).formatToParts(new Date());
    return true;
  } catch {
    return false;
  }
}

export function assertValidCronExpression(cron: string): string {
  const trimmed = cron.trim();

  if (trimmed.length === 0) {
    throw new NewsletterRepositoryError("validation", "Schedule cron is required");
  }

  if (trimmed.length > SCHEDULE_CRON_MAX_LENGTH) {
    throw new NewsletterRepositoryError(
      "validation",
      `Schedule cron must be ${SCHEDULE_CRON_MAX_LENGTH} characters or less`,
    );
  }

  if (trimmed.startsWith("@")) {
    throw new NewsletterRepositoryError(
      "validation",
      "Schedule cron must use a 5-field expression (predefined @ aliases are not supported)",
    );
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new NewsletterRepositoryError(
      "validation",
      "Schedule cron must have exactly 5 fields",
    );
  }

  try {
    CronExpressionParser.parse(trimmed);
  } catch {
    throw new NewsletterRepositoryError("validation", "Schedule cron is invalid");
  }

  return trimmed;
}

export function resolveScheduleFields(
  input: UpdateNewsletterScheduleInput,
): UpdateNewsletterScheduleInput {
  const scheduleEnabled = input.scheduleEnabled;
  if (scheduleEnabled !== true && scheduleEnabled !== false) {
    throw new NewsletterRepositoryError("validation", "scheduleEnabled must be a boolean");
  }

  const scheduleCronRaw = String(input.scheduleCron ?? "").trim();
  if (scheduleCronRaw.length > SCHEDULE_CRON_MAX_LENGTH) {
    throw new NewsletterRepositoryError(
      "validation",
      `Schedule cron must be ${SCHEDULE_CRON_MAX_LENGTH} characters or less`,
    );
  }

  let scheduleTimezone = String(input.scheduleTimezone ?? "").trim();
  if (scheduleTimezone.length === 0) {
    scheduleTimezone = DEFAULT_SCHEDULE_TIMEZONE;
  }
  if (scheduleTimezone.length > SCHEDULE_TIMEZONE_MAX_LENGTH) {
    throw new NewsletterRepositoryError(
      "validation",
      `Schedule timezone must be ${SCHEDULE_TIMEZONE_MAX_LENGTH} characters or less`,
    );
  }
  if (!isValidIanaTimezone(scheduleTimezone)) {
    throw new NewsletterRepositoryError("validation", "Schedule timezone is invalid");
  }

  let scheduleCron: string;
  if (scheduleEnabled) {
    if (scheduleCronRaw.length === 0) {
      throw new NewsletterRepositoryError(
        "validation",
        "Schedule cron is required when scheduling is enabled",
      );
    }
    scheduleCron = assertValidCronExpression(scheduleCronRaw);
  } else {
    scheduleCron =
      scheduleCronRaw.length === 0 ? "" : assertValidCronExpression(scheduleCronRaw);
  }

  return {
    scheduleEnabled,
    scheduleCron,
    scheduleTimezone,
  };
}

export function computeNextFireAt(
  cron: string,
  timezone: string,
  now: Date = new Date(),
): Date | null {
  try {
    let currentDate: Date | undefined = now;
    const trimmed = cron.trim();

    for (let attempt = 0; attempt < 400; attempt++) {
      const interval = CronExpressionParser.parse(trimmed, { currentDate, tz: timezone });
      const next = interval.next().toDate();

      if (next.getTime() <= now.getTime()) {
        currentDate = new Date(next.getTime() + 1);
        continue;
      }

      if (isWallClockConsistentWithCron(next, trimmed, timezone)) {
        return next;
      }

      currentDate = new Date(next.getTime() + 1);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Previous fire at or before `now` (inclusive). Re-parses each call — never `reset()`.
 * Empty/invalid cron → null (does not throw).
 */
export function computePreviousFireAt(
  cron: string,
  timezone: string,
  now: Date = new Date(),
): Date | null {
  try {
    const trimmed = cron.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const interval = CronExpressionParser.parse(trimmed, {
      currentDate: new Date(now.getTime() + 1),
      tz: timezone,
    });
    return interval.prev().toDate();
  } catch {
    return null;
  }
}

export type ScheduleDueSource = Pick<
  Newsletter,
  "scheduleEnabled" | "scheduleCron" | "scheduleTimezone" | "scheduleLastFiredAt"
>;

/**
 * Whether an enabled schedule has a previous fire that has not yet been stamped.
 * Empty/invalid cron → false (does not throw).
 */
export function isScheduleDue(newsletter: ScheduleDueSource, now: Date = new Date()): boolean {
  if (!newsletter.scheduleEnabled) {
    return false;
  }

  const previousFire = computePreviousFireAt(
    newsletter.scheduleCron,
    newsletter.scheduleTimezone,
    now,
  );
  if (previousFire === null) {
    return false;
  }

  if (newsletter.scheduleLastFiredAt === null) {
    return true;
  }

  return previousFire.getTime() > new Date(newsletter.scheduleLastFiredAt).getTime();
}

function isNumericCronField(field: string): boolean {
  return /^\d+$/.test(field);
}

function getLocalHourMinute(instant: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)!.value);
  return { hour: get("hour"), minute: get("minute") };
}

/** Reject parser artifacts such as a 03:00 fire for a fixed 02:00 cron on DST spring-forward. */
function isWallClockConsistentWithCron(instant: Date, cron: string, tz: string): boolean {
  const [minuteField, hourField] = cron.split(/\s+/);
  const { hour, minute } = getLocalHourMinute(instant, tz);

  if (isNumericCronField(minuteField) && Number(minuteField) !== minute) {
    return false;
  }
  if (isNumericCronField(hourField) && Number(hourField) !== hour) {
    return false;
  }

  return true;
}

export function toNewsletterScheduleView(
  newsletter: NewsletterScheduleSource,
  now: Date = new Date(),
): NewsletterScheduleView {
  const { scheduleEnabled, scheduleCron, scheduleTimezone } = newsletter;

  if (!scheduleEnabled) {
    return {
      enabled: false,
      cron: scheduleCron,
      timezone: scheduleTimezone,
      nextFireAt: null,
    };
  }

  const nextFire = computeNextFireAt(scheduleCron, scheduleTimezone, now);

  return {
    enabled: true,
    cron: scheduleCron,
    timezone: scheduleTimezone,
    nextFireAt: nextFire ? nextFire.toISOString() : null,
  };
}
