/**
 * Vector math helpers for the MMR selection phase (feature 06).
 *
 * Pure functions, no dependencies. TypeScript strict-friendly.
 *
 * Finiteness policy (feature 08, C4):
 * - Every element of every vector input must be `typeof === 'number'` and
 *   `Number.isFinite`. A non-number, NaN, or Infinity element throws
 *   `InvalidVectorError` — the bug is surfaced at its source rather than
 *   propagating into a silent NaN result.
 * - The cosine `result` itself is additionally guarded: even with valid finite
 *   inputs the division could (in pathological cases the zero-norm guard
 *   already handles) yield a non-finite value; defensively return `0` there so
 *   the MMR scoring loop can never receive a NaN/Infinity similarity.
 */

/**
 * Typed error raised when a vector math function receives a non-finite or
 * non-number element. Carries the offending index and value for telemetry.
 */
export class InvalidVectorError extends Error {
  /** Function that detected the bad input. */
  readonly fn: string;
  /** Index of the offending element within the input vector. */
  readonly index: number;
  /** The offending value (may be `unknown` if it was a non-number). */
  readonly value: unknown;

  constructor(fn: string, index: number, value: unknown) {
    const valueDesc =
      typeof value === "number"
        ? Number.isNaN(value)
          ? "NaN"
          : Number.isFinite(value)
            ? String(value)
            : value > 0
              ? "Infinity"
              : "-Infinity"
        : `non-number (${typeof value})`;
    super(`${fn}: invalid vector element at index ${index}: ${valueDesc}`);
    this.name = "InvalidVectorError";
    this.fn = fn;
    this.index = index;
    this.value = value;
  }
}

/** Throw `InvalidVectorError` if `vec` contains any non-finite / non-number. */
function assertFiniteVector(fn: string, vec: number[]): void {
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i] as unknown;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new InvalidVectorError(fn, i, v);
    }
  }
}

export function dot(a: number[], b: number[]): number {
  assertFiniteVector("dot", a);
  assertFiniteVector("dot", b);
  if (a.length !== b.length) {
    throw new Error(`dot: length mismatch (${a.length} vs ${b.length})`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function norm(a: number[]): number {
  assertFiniteVector("norm", a);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two vectors. Returns a finite number in [-1, 1]
 * for valid inputs; `0` when either vector is the zero vector (no direction)
 * or — defensively — if the division somehow yields a non-finite value.
 *
 * Non-finite / non-number INPUT elements throw `InvalidVectorError`.
 */
export function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) {
    return 0;
  }
  const result = dot(a, b) / (na * nb);
  if (!Number.isFinite(result)) {
    // Defensive: with valid finite inputs this branch should be unreachable
    // (the zero-norm guard above handles the only numerical path to NaN/0÷0).
    // Return 0 so MMR scoring never receives a non-finite similarity.
    return 0;
  }
  return result;
}

export function argMax(values: number[]): number {
  if (values.length === 0) {
    throw new Error("argMax: empty input");
  }
  assertFiniteVector("argMax", values);
  let bestIdx = 0;
  let bestVal = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > bestVal) {
      bestVal = values[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}
