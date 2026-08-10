import { describe, it, expect } from "vitest";

import { dot, norm, cosine, argMax, InvalidVectorError } from "../vectors";

// ---------------------------------------------------------------------------
// InvalidVectorError
// ---------------------------------------------------------------------------

describe("vectors — InvalidVectorError", () => {
  it("is an Error subclass carrying fn and index context", () => {
    const err = new InvalidVectorError("dot", 1, NaN);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidVectorError);
    expect(err.name).toBe("InvalidVectorError");
    expect(err.fn).toBe("dot");
    expect(err.index).toBe(1);
    expect(err.value).toBe(NaN);
    expect(err.message).toContain("dot");
  });
});

// ---------------------------------------------------------------------------
// dot
// ---------------------------------------------------------------------------

describe("vectors — dot", () => {
  it("computes the dot product of equal-length vectors", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("throws on length mismatch", () => {
    expect(() => dot([1, 2], [1, 2, 3])).toThrow();
  });

  it("throws InvalidVectorError on a NaN element in either input", () => {
    expect(() => dot([NaN, 2], [1, 2])).toThrow(InvalidVectorError);
    expect(() => dot([1, 2], [NaN, 2])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError on an Infinity element in either input", () => {
    expect(() => dot([Infinity, 2], [1, 2])).toThrow(InvalidVectorError);
    expect(() => dot([1, 2], [Infinity, 2])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError on a non-number element", () => {
    expect(() => dot([1, 2], ["x" as unknown as number, 2])).toThrow(InvalidVectorError);
  });
});

// ---------------------------------------------------------------------------
// norm
// ---------------------------------------------------------------------------

describe("vectors — norm", () => {
  it("computes the Euclidean norm", () => {
    expect(norm([3, 4])).toBe(5);
  });

  it("returns 0 for the zero vector", () => {
    expect(norm([0, 0])).toBe(0);
  });

  it("throws InvalidVectorError on a NaN element", () => {
    expect(() => norm([NaN])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError on an Infinity element", () => {
    expect(() => norm([Infinity, 1])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError on a non-number element", () => {
    expect(() => norm([null as unknown as number])).toThrow(InvalidVectorError);
  });
});

// ---------------------------------------------------------------------------
// cosine
// ---------------------------------------------------------------------------

describe("vectors — cosine", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosine([1, 0], [-1, 0])).toBe(-1);
  });

  it("returns 0 (never NaN) when one vector is the zero vector", () => {
    const result = cosine([0, 0], [1, 0]);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("throws InvalidVectorError when an input element is NaN", () => {
    expect(() => cosine([NaN, 0], [1, 0])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError when an input element is Infinity", () => {
    expect(() => cosine([Infinity, 0], [1, 0])).toThrow(InvalidVectorError);
  });

  it("never returns NaN: result is finite even defensively", () => {
    // With valid finite inputs the cosine must always be a finite number.
    const result = cosine([1, 2, 3], [4, 5, 6]);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// argMax
// ---------------------------------------------------------------------------

describe("vectors — argMax", () => {
  it("returns the index of the maximum value", () => {
    expect(argMax([1, 3, 2])).toBe(1);
  });

  it("resolves ties to the lowest index", () => {
    expect(argMax([5, 5, 3])).toBe(0);
  });

  it("throws on empty input", () => {
    expect(() => argMax([])).toThrow();
  });

  it("throws InvalidVectorError when any element is NaN", () => {
    expect(() => argMax([NaN, 1, 2])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError when any element is Infinity", () => {
    expect(() => argMax([1, Infinity, 2])).toThrow(InvalidVectorError);
  });

  it("throws InvalidVectorError when any element is a non-number", () => {
    expect(() => argMax([1, undefined as unknown as number, 2])).toThrow(InvalidVectorError);
  });
});
