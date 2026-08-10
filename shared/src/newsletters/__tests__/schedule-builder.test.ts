import { describe, it, expect } from "vitest";

import {
  DEFAULT_GUIDED_SCHEDULE,
  decodeGuidedCron,
  encodeGuidedCron,
  type GuidedScheduleState,
} from "../schedule-builder";

describe("encodeGuidedCron", () => {
  it("encodes Daily to minute hour * * *", () => {
    const state: GuidedScheduleState = {
      frequency: "daily",
      hour: 9,
      minute: 0,
      daysOfWeek: [],
    };
    expect(encodeGuidedCron(state)).toBe("0 9 * * *");
  });

  it("encodes Weekdays to minute hour * * 1-5", () => {
    const state: GuidedScheduleState = {
      frequency: "weekdays",
      hour: 9,
      minute: 0,
      daysOfWeek: [],
    };
    expect(encodeGuidedCron(state)).toBe("0 9 * * 1-5");
  });

  it("encodes Weekly to minute hour * * {dow}", () => {
    const state: GuidedScheduleState = {
      frequency: "weekly",
      hour: 14,
      minute: 30,
      daysOfWeek: [1],
    };
    expect(encodeGuidedCron(state)).toBe("30 14 * * 1");
  });

  it("encodes Custom weekdays to sorted unique comma-separated dows", () => {
    const state: GuidedScheduleState = {
      frequency: "custom",
      hour: 9,
      minute: 0,
      daysOfWeek: [6, 0],
    };
    expect(encodeGuidedCron(state)).toBe("0 9 * * 0,6");
  });

  it("emits 0 for Sunday, never 7", () => {
    const state: GuidedScheduleState = {
      frequency: "weekly",
      hour: 9,
      minute: 0,
      daysOfWeek: [0],
    };
    expect(encodeGuidedCron(state)).toBe("0 9 * * 0");
  });

  it("throws when Custom has zero days", () => {
    const state: GuidedScheduleState = {
      frequency: "custom",
      hour: 9,
      minute: 0,
      daysOfWeek: [],
    };
    expect(() => encodeGuidedCron(state)).toThrow();
  });
});

describe("DEFAULT_GUIDED_SCHEDULE", () => {
  it("encodes to weekdays at 09:00", () => {
    expect(DEFAULT_GUIDED_SCHEDULE.frequency).toBe("weekdays");
    expect(DEFAULT_GUIDED_SCHEDULE.hour).toBe(9);
    expect(DEFAULT_GUIDED_SCHEDULE.minute).toBe(0);
    expect(encodeGuidedCron(DEFAULT_GUIDED_SCHEDULE)).toBe("0 9 * * 1-5");
  });
});

describe("decodeGuidedCron", () => {
  it("decodes Daily / Weekdays / Weekly / Custom back to guided state", () => {
    expect(decodeGuidedCron("0 9 * * *")).toEqual({
      frequency: "daily",
      hour: 9,
      minute: 0,
      daysOfWeek: [],
    });
    expect(decodeGuidedCron("0 9 * * 1-5")).toEqual({
      frequency: "weekdays",
      hour: 9,
      minute: 0,
      daysOfWeek: [],
    });
    expect(decodeGuidedCron("30 14 * * 1")).toEqual({
      frequency: "weekly",
      hour: 14,
      minute: 30,
      daysOfWeek: [1],
    });
    expect(decodeGuidedCron("0 9 * * 0,6")).toEqual({
      frequency: "custom",
      hour: 9,
      minute: 0,
      daysOfWeek: [0, 6],
    });
  });

  it("returns null for non-guided expressions", () => {
    expect(decodeGuidedCron("")).toBeNull();
    expect(decodeGuidedCron("@daily")).toBeNull();
    expect(decodeGuidedCron("0 9 1 * *")).toBeNull();
    expect(decodeGuidedCron("*/15 * * * *")).toBeNull();
    expect(decodeGuidedCron("0 9 * * 1-5,6")).toBeNull();
    expect(decodeGuidedCron("7 9 * * 1-5")).toBeNull(); // minute not on 5-min grid
    expect(decodeGuidedCron("0 9 * * MON")).toBeNull();
  });

  it("normalizes Sunday 7 in a single-dow field to Weekly Sunday (0)", () => {
    expect(decodeGuidedCron("0 9 * * 7")).toEqual({
      frequency: "weekly",
      hour: 9,
      minute: 0,
      daysOfWeek: [0],
    });
  });

  it("does not auto-promote literal 1,2,3,4,5 to Weekdays", () => {
    expect(decodeGuidedCron("0 9 * * 1,2,3,4,5")).toEqual({
      frequency: "custom",
      hour: 9,
      minute: 0,
      daysOfWeek: [1, 2, 3, 4, 5],
    });
  });
});

describe("round-trip encode(decode(cron))", () => {
  const matchedCrons = [
    "0 9 * * *",
    "0 9 * * 1-5",
    "30 14 * * 1",
    "0 9 * * 0,6",
    "0 9 * * 7", // Sunday alias → canonical weekly Sunday
    "15 8 * * 1,2,3,4,5",
    "0 0 * * 0",
  ];

  it.each(matchedCrons)("encode(decode(%j)) equals canonical encode", (cron) => {
    const decoded = decodeGuidedCron(cron);
    expect(decoded).not.toBeNull();
    const canonical = encodeGuidedCron(decoded!);
    expect(encodeGuidedCron(decodeGuidedCron(canonical)!)).toBe(canonical);
    // Input may use 7 for Sunday; canonical always emits 0
    expect(canonical).toBe(encodeGuidedCron(decoded!));
  });
});
