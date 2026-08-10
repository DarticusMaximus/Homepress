import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  DEFAULT_MODELS,
  DEFAULT_TIMEOUT_MS,
  DRAFTER_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_MAX_FETCH_BYTES,
  DEFAULT_SCORE_THRESHOLD,
  getModelName,
  getDateFilter,
  parseScoreThreshold,
  DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
  CROSS_RUN_SIMILARITY_THRESHOLD_ENV,
  parseCrossRunSimilarityThreshold,
  getCrossRunSimilarityThreshold,
} from "../config";

describe("DEFAULT_MODELS", () => {
  it("deep-equals the legacy dict literal", () => {
    // Byte-identical to the legacy pipeline's DEFAULT_MODELS. Parity depends on it.
    expect(DEFAULT_MODELS).toEqual({
      tagger: "nvidia/nemotron-3-nano-30b-a3b",
      scorer: "nvidia/nemotron-3-nano-30b-a3b",
      drafter: "google/gemini-3-flash-preview",
      embedder: "google/gemini-embedding-001",
    });
  });
});

describe("default constants", () => {
  it("exposes the legacy default scalars", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(60000);
    expect(DRAFTER_TIMEOUT_MS).toBe(180_000);
    expect(DEFAULT_MAX_RETRIES).toBe(3);
    expect(DEFAULT_MAX_CONTENT_LENGTH).toBe(70000);
    expect(DEFAULT_MAX_FETCH_BYTES).toBe(5_000_000);
    expect(DEFAULT_SCORE_THRESHOLD).toBe(7.0);
  });
});

describe("getModelName", () => {
  const KEYS = ["TAGGER_MODEL", "SCORER_MODEL", "DRAFTER_MODEL", "EMBED_MODEL"] as const;

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    vi.unstubAllEnvs();
  });

  it("returns each component's default when its env var is unset", () => {
    expect(getModelName("tagger")).toBe("nvidia/nemotron-3-nano-30b-a3b");
    expect(getModelName("scorer")).toBe("nvidia/nemotron-3-nano-30b-a3b");
    expect(getModelName("drafter")).toBe("google/gemini-3-flash-preview");
    expect(getModelName("embedder")).toBe("google/gemini-embedding-001");
  });

  it("returns the env value when the env var is set", () => {
    process.env.TAGGER_MODEL = "custom/tagger-model";
    process.env.SCORER_MODEL = "custom/scorer-model";
    process.env.DRAFTER_MODEL = "custom/drafter-model";
    process.env.EMBED_MODEL = "custom/embed-model";

    expect(getModelName("tagger")).toBe("custom/tagger-model");
    expect(getModelName("scorer")).toBe("custom/scorer-model");
    expect(getModelName("drafter")).toBe("custom/drafter-model");
    expect(getModelName("embedder")).toBe("custom/embed-model");
  });

  it("isolates overrides per component", () => {
    process.env.SCORER_MODEL = "only/scorer-overridden";
    expect(getModelName("tagger")).toBe("nvidia/nemotron-3-nano-30b-a3b");
    expect(getModelName("scorer")).toBe("only/scorer-overridden");
    expect(getModelName("drafter")).toBe("google/gemini-3-flash-preview");
    expect(getModelName("embedder")).toBe("google/gemini-embedding-001");
  });
});

describe("getDateFilter", () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("'yesterday': start is prior day 00:00:00.000, end is prior day 23:59:59.999, start <= end", () => {
    process.env.TZ = "UTC";
    const { start, end } = getDateFilter("yesterday");

    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);

    // start is midnight (UTC) of yesterday
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
    expect(start.getUTCMilliseconds()).toBe(0);

    // end is the last instant of yesterday
    expect(end!.getUTCHours()).toBe(23);
    expect(end!.getUTCMinutes()).toBe(59);
    expect(end!.getUTCSeconds()).toBe(59);
    expect(end!.getUTCMilliseconds()).toBe(999);

    // both reference the same calendar day (UTC)
    expect(start.getUTCFullYear()).toBe(end!.getUTCFullYear());
    expect(start.getUTCMonth()).toBe(end!.getUTCMonth());
    expect(start.getUTCDate()).toBe(end!.getUTCDate());

    // and that day is strictly before today (UTC)
    const todayUTC = new Date();
    expect(start.getTime()).toBeLessThan(todayUTC.getTime());

    expect(start.getTime()).toBeLessThanOrEqual(end!.getTime());
  });

  it("'last_3_days': start ≈ now−3d, end ≈ now", () => {
    process.env.TZ = "UTC";
    const now = Date.now();
    const { start, end } = getDateFilter("last_3_days");

    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    // start within a small tolerance of now - 3 days
    expect(Math.abs(start.getTime() - (now - threeDaysMs))).toBeLessThan(60 * 60 * 1000);
    // end within a small tolerance of now
    expect(Math.abs(end!.getTime() - now)).toBeLessThan(60 * 60 * 1000);
    expect(start.getTime()).toBeLessThanOrEqual(end!.getTime());
  });

  it("'last_week': start ≈ now−7d, end ≈ now", () => {
    process.env.TZ = "UTC";
    const now = Date.now();
    const { start, end } = getDateFilter("last_week");

    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);

    const weekMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(start.getTime() - (now - weekMs))).toBeLessThan(60 * 60 * 1000);
    expect(Math.abs(end!.getTime() - now)).toBeLessThan(60 * 60 * 1000);
    expect(start.getTime()).toBeLessThanOrEqual(end!.getTime());
  });

  it("'all': end is null and start is a Date", () => {
    process.env.TZ = "UTC";
    const { start, end } = getDateFilter("all");
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeNull();
  });

  it("unknown value falls back to the 'yesterday' range", () => {
    process.env.TZ = "UTC";
    const yesterday = getDateFilter("yesterday");
    const fallback = getDateFilter("totally-bogus" as never);

    expect(fallback.start.getUTCHours()).toBe(0);
    expect(fallback.end).toBeInstanceOf(Date);
    expect(fallback.end!.getUTCHours()).toBe(23);
    expect(fallback.end!.getUTCMinutes()).toBe(59);
    expect(fallback.end!.getUTCSeconds()).toBe(59);
    expect(fallback.end!.getUTCMilliseconds()).toBe(999);
    // same calendar day as the explicit yesterday range
    expect(fallback.start.getUTCDate()).toBe(yesterday.start.getUTCDate());
  });

  it("falls back to UTC when TZ is unset", () => {
    delete process.env.TZ;
    const { start, end } = getDateFilter("yesterday");
    // In UTC, midnight UTC should be the start of the range.
    expect(start.getUTCHours()).toBe(0);
    expect(end!.getUTCHours()).toBe(23);
  });

  // Helper: format a UTC instant as wall-clock Y-M-D H:M:S in a given tz.
  const wallParts = (instant: number, tz: string) => {
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
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
  };

  // The "today" wall-clock date in the given tz (as read from Intl).
  const todayWall = (tz: string) => {
    const p = wallParts(Date.now(), tz);
    return { year: p.year, month: p.month, day: p.day };
  };

  // Subtract one calendar day, handling month/year rollover.
  const priorDay = (y: number, m: number, d: number) => {
    const u = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000;
    return {
      year: new Date(u).getUTCFullYear(),
      month: new Date(u).getUTCMonth() + 1,
      day: new Date(u).getUTCDate(),
    };
  };

  // Regression: negative-offset TZ (Americas) must return the prior calendar
  // day's window in that tz's wall clock — not two days ago.
  it("'yesterday' in America/New_York (negative offset, DST) is the prior wall-clock day", () => {
    process.env.TZ = "America/New_York";
    const { start, end } = getDateFilter("yesterday");
    const tz = "America/New_York";

    const today = todayWall(tz);
    const expected = priorDay(today.year, today.month, today.day);

    const s = wallParts(start.getTime(), tz);
    expect(s.hour).toBe(0);
    expect(s.minute).toBe(0);
    expect(s.second).toBe(0);
    expect(s.year).toBe(expected.year);
    expect(s.month).toBe(expected.month);
    expect(s.day).toBe(expected.day);

    const e = wallParts(end!.getTime(), tz);
    expect(e.hour).toBe(23);
    expect(e.minute).toBe(59);
    expect(e.second).toBe(59);
    expect(e.year).toBe(expected.year);
    expect(e.month).toBe(expected.month);
    expect(e.day).toBe(expected.day);
  });

  // Regression: positive non-DST TZ must also be the prior wall-clock day.
  it("'yesterday' in Asia/Kolkata (positive offset, no DST) is the prior wall-clock day", () => {
    process.env.TZ = "Asia/Kolkata";
    const { start, end } = getDateFilter("yesterday");
    const tz = "Asia/Kolkata";

    const today = todayWall(tz);
    const expected = priorDay(today.year, today.month, today.day);

    const s = wallParts(start.getTime(), tz);
    expect(s.hour).toBe(0);
    expect(s.minute).toBe(0);
    expect(s.second).toBe(0);
    expect(s.year).toBe(expected.year);
    expect(s.month).toBe(expected.month);
    expect(s.day).toBe(expected.day);

    const e = wallParts(end!.getTime(), tz);
    expect(e.hour).toBe(23);
    expect(e.minute).toBe(59);
    expect(e.second).toBe(59);
    expect(e.year).toBe(expected.year);
    expect(e.month).toBe(expected.month);
    expect(e.day).toBe(expected.day);
  });

  // Southern-hemisphere DST: ensure correctness across the offset range.
  it("'yesterday' in Australia/Sydney (positive offset, DST) is the prior wall-clock day", () => {
    process.env.TZ = "Australia/Sydney";
    const { start } = getDateFilter("yesterday");
    const tz = "Australia/Sydney";

    const today = todayWall(tz);
    const expected = priorDay(today.year, today.month, today.day);

    const s = wallParts(start.getTime(), tz);
    expect(s.hour).toBe(0);
    expect(s.minute).toBe(0);
    expect(s.second).toBe(0);
    expect(s.year).toBe(expected.year);
    expect(s.month).toBe(expected.month);
    expect(s.day).toBe(expected.day);
  });
});

describe("parseScoreThreshold", () => {
  it("'7.0' -> 7", () => {
    expect(parseScoreThreshold("7.0")).toBe(7);
  });

  it("'15' -> 10 (clamp high)", () => {
    expect(parseScoreThreshold("15")).toBe(10);
  });

  it("'-2' -> 0 (clamp low)", () => {
    expect(parseScoreThreshold("-2")).toBe(0);
  });

  it("'notanumber' -> 7 (fallback)", () => {
    expect(parseScoreThreshold("notanumber")).toBe(7);
  });

  it("'' -> 7 (fallback)", () => {
    expect(parseScoreThreshold("")).toBe(7);
  });

  it("falls back to 7 for undefined-ish input", () => {
    expect(parseScoreThreshold(undefined)).toBe(7);
  });
});

describe("DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD", () => {
  it("equals 0.85", () => {
    expect(DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD).toBe(0.85);
  });
});

describe("parseCrossRunSimilarityThreshold", () => {
  it("undefined -> 0.85", () => {
    expect(parseCrossRunSimilarityThreshold(undefined)).toBe(0.85);
  });

  it("'' -> 0.85", () => {
    expect(parseCrossRunSimilarityThreshold("")).toBe(0.85);
  });

  it("NaN -> 0.85", () => {
    expect(parseCrossRunSimilarityThreshold(NaN)).toBe(0.85);
  });

  it("0.9 (number) -> 0.9", () => {
    expect(parseCrossRunSimilarityThreshold(0.9)).toBe(0.9);
  });

  it("1.5 (number) -> 1 (clamp high)", () => {
    expect(parseCrossRunSimilarityThreshold(1.5)).toBe(1);
  });

  it("-0.1 (number) -> 0 (clamp low)", () => {
    expect(parseCrossRunSimilarityThreshold(-0.1)).toBe(0);
  });

  it("'0.85' (string) -> 0.85", () => {
    expect(parseCrossRunSimilarityThreshold("0.85")).toBe(0.85);
  });
});

describe("getCrossRunSimilarityThreshold", () => {
  const ENV_KEY = CROSS_RUN_SIMILARITY_THRESHOLD_ENV;
  const ORIGINAL = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = ORIGINAL;
  });

  it("returns 0.85 when env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(getCrossRunSimilarityThreshold()).toBe(0.85);
  });

  it("returns parsed value when env var is set", () => {
    process.env[ENV_KEY] = "0.7";
    expect(getCrossRunSimilarityThreshold()).toBe(0.7);
  });
});
