import { describe, it, expect } from "vitest";

import {
  DEFAULT_SCHEDULE_TIMEZONE,
  SCHEDULE_CRON_MAX_LENGTH,
  SCHEDULE_TIMEZONE_MAX_LENGTH,
} from "../../schema/declarations";
import { NewsletterRepositoryError } from "../types";
import {
  assertValidCronExpression,
  computePreviousFireAt,
  isScheduleDue,
  isValidIanaTimezone,
  resolveScheduleFields,
  toNewsletterScheduleView,
} from "../schedule";

/** Weekday 09:00 America/New_York — Monday 2025-01-06 09:00 EST → 14:00 UTC. */
const WEEKDAY_CRON = "0 9 * * 1-5";
const NY_TZ = "America/New_York";
const MONDAY_FIRE_ISO = "2025-01-06T14:00:00.000Z";
const MONDAY_AFTER_FIRE = new Date("2025-01-06T15:00:00.000Z");

function expectValidationError(fn: () => unknown): NewsletterRepositoryError {
  try {
    fn();
    throw new Error("Expected NewsletterRepositoryError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(NewsletterRepositoryError);
    const repoErr = err as NewsletterRepositoryError;
    expect(repoErr.code).toBe("validation");
    return repoErr;
  }
}

describe("toNewsletterScheduleView", () => {
  it("returns null nextFireAt when schedule is disabled", () => {
    const view = toNewsletterScheduleView({
      scheduleEnabled: false,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
    });

    expect(view).toEqual({
      enabled: false,
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
      nextFireAt: null,
    });
  });

  it("computes next fire for weekday cron in IANA timezone (Sunday evening UTC → Monday 09:00 local)", () => {
    // 2025-01-05 is Sunday; 23:00 UTC is Sunday evening in America/New_York (EST).
    const now = new Date("2025-01-05T23:00:00.000Z");
    const view = toNewsletterScheduleView(
      {
        scheduleEnabled: true,
        scheduleCron: "0 9 * * 1-5",
        scheduleTimezone: "America/New_York",
      },
      now,
    );

    expect(view.enabled).toBe(true);
    expect(view.cron).toBe("0 9 * * 1-5");
    expect(view.timezone).toBe("America/New_York");
    // Monday 2025-01-06 09:00 America/New_York (EST, UTC-5) → 14:00 UTC
    expect(view.nextFireAt).toBe("2025-01-06T14:00:00.000Z");
    expect(new Date(view.nextFireAt!).getTime()).toBeGreaterThan(now.getTime());
  });

  it("skips the nonexistent local hour on US DST spring-forward (2025-03-09)", () => {
    // US clocks spring forward 2025-03-09 02:00 → 03:00 America/New_York.
    // Daily 02:00 local on that Sunday is skipped; next fire is Monday 02:00 EDT.
    const now = new Date("2025-03-08T12:00:00.000Z");
    const view = toNewsletterScheduleView(
      {
        scheduleEnabled: true,
        scheduleCron: "0 2 * * *",
        scheduleTimezone: "America/New_York",
      },
      now,
    );

    // Monday 2025-03-10 02:00 EDT (UTC-4) → 06:00 UTC — not the skipped 2025-03-09 02:00 slot
    expect(view.nextFireAt).toBe("2025-03-10T06:00:00.000Z");
    expect(new Date(view.nextFireAt!).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("isValidIanaTimezone", () => {
  it("rejects invalid IANA timezone ids", () => {
    expect(isValidIanaTimezone("Not/A_Zone")).toBe(false);
  });

  it("accepts a known IANA timezone", () => {
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
  });

  it("rejects empty timezone", () => {
    expect(isValidIanaTimezone("")).toBe(false);
  });
});

describe("assertValidCronExpression", () => {
  it("rejects 6-field cron expressions", () => {
    expectValidationError(() => assertValidCronExpression("0 0 0 1 1 0"));
  });

  it("rejects garbage cron expressions", () => {
    expectValidationError(() => assertValidCronExpression("not a cron"));
  });

  it("rejects cron expressions over SCHEDULE_CRON_MAX_LENGTH", () => {
    const overLength = `${"0 ".repeat(SCHEDULE_CRON_MAX_LENGTH)}* * * *`;
    expect(overLength.length).toBeGreaterThan(SCHEDULE_CRON_MAX_LENGTH);
    expectValidationError(() => assertValidCronExpression(overLength));
  });

  it("rejects @hourly alias", () => {
    expectValidationError(() => assertValidCronExpression("@hourly"));
  });

  it("rejects @daily alias", () => {
    expectValidationError(() => assertValidCronExpression("@daily"));
  });

  it("accepts a valid 5-field cron expression", () => {
    expect(assertValidCronExpression("0 9 * * 1-5")).toBe("0 9 * * 1-5");
  });
});

describe("resolveScheduleFields", () => {
  it("rejects empty cron when schedule is enabled", () => {
    expectValidationError(() =>
      resolveScheduleFields({
        scheduleEnabled: true,
        scheduleCron: "",
        scheduleTimezone: "UTC",
      }),
    );
  });

  it("rejects invalid timezone via resolveScheduleFields", () => {
    expectValidationError(() =>
      resolveScheduleFields({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * *",
        scheduleTimezone: "Not/A_Zone",
      }),
    );
  });

  it("rejects disabled schedule with invalid non-empty cron", () => {
    expectValidationError(() =>
      resolveScheduleFields({
        scheduleEnabled: false,
        scheduleCron: "not a cron",
        scheduleTimezone: "UTC",
      }),
    );
  });

  it("accepts disabled schedule with empty cron and stores empty string", () => {
    const resolved = resolveScheduleFields({
      scheduleEnabled: false,
      scheduleCron: "",
      scheduleTimezone: "UTC",
    });

    expect(resolved).toEqual({
      scheduleEnabled: false,
      scheduleCron: "",
      scheduleTimezone: "UTC",
    });
  });

  it("resolves empty timezone to DEFAULT_SCHEDULE_TIMEZONE (UTC)", () => {
    const resolved = resolveScheduleFields({
      scheduleEnabled: true,
      scheduleCron: "0 9 * * *",
      scheduleTimezone: "",
    });

    expect(resolved.scheduleTimezone).toBe(DEFAULT_SCHEDULE_TIMEZONE);
    expect(resolved.scheduleTimezone).toBe("UTC");
  });

  it("accepts a valid enabled schedule", () => {
    const resolved = resolveScheduleFields({
      scheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
    });

    expect(resolved).toEqual({
      scheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
    });
  });

  it("rejects timezone over SCHEDULE_TIMEZONE_MAX_LENGTH", () => {
    const overLength = "A".repeat(SCHEDULE_TIMEZONE_MAX_LENGTH + 1);
    expectValidationError(() =>
      resolveScheduleFields({
        scheduleEnabled: true,
        scheduleCron: "0 9 * * *",
        scheduleTimezone: overLength,
      }),
    );
  });
});

describe("computePreviousFireAt", () => {
  it("returns the fire instant when now is exactly on a fire (inclusive)", () => {
    const now = new Date(MONDAY_FIRE_ISO);
    const previous = computePreviousFireAt(WEEKDAY_CRON, NY_TZ, now);
    expect(previous).not.toBeNull();
    expect(previous!.toISOString()).toBe(MONDAY_FIRE_ISO);
  });

  it("returns null for an invalid cron without throwing", () => {
    const previous = computePreviousFireAt("not a cron", NY_TZ, MONDAY_AFTER_FIRE);
    expect(previous).toBeNull();
  });
});

describe("isScheduleDue", () => {
  it("returns false when the schedule is disabled", () => {
    expect(
      isScheduleDue(
        {
          scheduleEnabled: false,
          scheduleCron: WEEKDAY_CRON,
          scheduleTimezone: NY_TZ,
          scheduleLastFiredAt: null,
        },
        MONDAY_AFTER_FIRE,
      ),
    ).toBe(false);
  });

  it("returns true when enabled, never fired, and a previous fire exists (NY weekday)", () => {
    expect(
      isScheduleDue(
        {
          scheduleEnabled: true,
          scheduleCron: WEEKDAY_CRON,
          scheduleTimezone: NY_TZ,
          scheduleLastFiredAt: null,
        },
        MONDAY_AFTER_FIRE,
      ),
    ).toBe(true);
  });

  it("returns false when already stamped for that previous fire", () => {
    expect(
      isScheduleDue(
        {
          scheduleEnabled: true,
          scheduleCron: WEEKDAY_CRON,
          scheduleTimezone: NY_TZ,
          scheduleLastFiredAt: MONDAY_FIRE_ISO,
        },
        MONDAY_AFTER_FIRE,
      ),
    ).toBe(false);
  });

  it("returns true once after downtime for the latest previous fire only", () => {
    // Stamped Friday 2025-01-03 09:00 EST; now is Wednesday after the weekend —
    // due for latest previous (Wed 2025-01-08 09:00 EST), not every missed slot.
    const fridayFireIso = "2025-01-03T14:00:00.000Z";
    const wednesdayAfterFire = new Date("2025-01-08T15:00:00.000Z");
    const wednesdayFireIso = "2025-01-08T14:00:00.000Z";

    expect(
      isScheduleDue(
        {
          scheduleEnabled: true,
          scheduleCron: WEEKDAY_CRON,
          scheduleTimezone: NY_TZ,
          scheduleLastFiredAt: fridayFireIso,
        },
        wednesdayAfterFire,
      ),
    ).toBe(true);

    const previous = computePreviousFireAt(WEEKDAY_CRON, NY_TZ, wednesdayAfterFire);
    expect(previous).not.toBeNull();
    expect(previous!.toISOString()).toBe(wednesdayFireIso);
  });

  it("returns false for an invalid cron without throwing", () => {
    expect(
      isScheduleDue(
        {
          scheduleEnabled: true,
          scheduleCron: "%%%",
          scheduleTimezone: NY_TZ,
          scheduleLastFiredAt: null,
        },
        MONDAY_AFTER_FIRE,
      ),
    ).toBe(false);
  });
});
