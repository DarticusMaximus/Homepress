import { describe, it, expect } from "vitest";

import { serializeSuppressSummary, parseSuppressSummary } from "../suppress-summary";
import type { SuppressSummary } from "../../pipeline/cross-run-suppress";

describe("serializeSuppressSummary", () => {
  it("empty -> ''", () => {
    expect(serializeSuppressSummary({ count: 0, items: [] })).toBe("");
  });

  it("non-empty produces a non-empty string", () => {
    const summary: SuppressSummary = {
      count: 1,
      items: [
        {
          title: "T",
          link: "L",
          matchedRunId: "R1",
          matchedTitle: "MT",
          similarity: 0.92,
        },
      ],
    };
    const out = serializeSuppressSummary(summary);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("parseSuppressSummary", () => {
  it("'' -> { count: 0, items: [] }", () => {
    expect(parseSuppressSummary("")).toEqual({ count: 0, items: [] });
  });

  it("invalid JSON -> { count: 0, items: [] }", () => {
    expect(parseSuppressSummary("not-json{")).toEqual({ count: 0, items: [] });
  });
});

describe("round-trip", () => {
  it("round-trips a single-item summary", () => {
    const summary: SuppressSummary = {
      count: 1,
      items: [
        {
          title: "T",
          link: "L",
          matchedRunId: "R1",
          matchedTitle: "MT",
          similarity: 0.92,
        },
      ],
    };
    const parsed = parseSuppressSummary(serializeSuppressSummary(summary));
    expect(parsed).toEqual(summary);
    expect(parsed.count).toBe(parsed.items.length);
  });

  it("round-trips a count=2 summary keeping the count invariant", () => {
    const summary: SuppressSummary = {
      count: 2,
      items: [
        {
          title: "T1",
          link: "L1",
          matchedRunId: "R1",
          matchedTitle: "MT1",
          similarity: 0.9,
        },
        {
          title: "T2",
          link: "L2",
          matchedRunId: "R2",
          matchedTitle: "MT2",
          similarity: 0.88,
        },
      ],
    };
    const parsed = parseSuppressSummary(serializeSuppressSummary(summary));
    expect(parsed.count).toBe(2);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.count).toBe(parsed.items.length);
    expect(parsed).toEqual(summary);
  });
});
