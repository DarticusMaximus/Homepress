import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CROSS_RUN_SIMILARITY_THRESHOLD_ENV,
  DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD,
  parseCrossRunSimilarityThreshold,
} from "../config";

function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: could not locate pnpm-workspace.yaml above ${dir}`);
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("cross-run threshold constants match docs", () => {
  it("env key string is exactly CROSS_RUN_SIMILARITY_THRESHOLD", () => {
    expect(CROSS_RUN_SIMILARITY_THRESHOLD_ENV).toBe("CROSS_RUN_SIMILARITY_THRESHOLD");
  });

  it("default is exactly 0.85", () => {
    expect(DEFAULT_CROSS_RUN_SIMILARITY_THRESHOLD).toBe(0.85);
  });
});

describe("parseCrossRunSimilarityThreshold smoke (regression vs feature 03)", () => {
  it("undefined -> 0.85", () => {
    expect(parseCrossRunSimilarityThreshold(undefined)).toBe(0.85);
  });

  it("'' -> 0.85", () => {
    expect(parseCrossRunSimilarityThreshold("")).toBe(0.85);
  });

  it("'0.9' -> 0.9", () => {
    expect(parseCrossRunSimilarityThreshold("0.9")).toBe(0.9);
  });

  it("1.5 -> 1 (clamp high)", () => {
    expect(parseCrossRunSimilarityThreshold(1.5)).toBe(1);
  });

  it("-0.1 -> 0 (clamp low)", () => {
    expect(parseCrossRunSimilarityThreshold(-0.1)).toBe(0);
  });

  it("'0.85abc' -> 0.85 (trailing garbage falls through to NaN guard)", () => {
    expect(parseCrossRunSimilarityThreshold("0.85abc")).toBe(0.85);
  });

  it("'NaN' -> 0.85 (non-finite guard)", () => {
    expect(parseCrossRunSimilarityThreshold("NaN")).toBe(0.85);
  });

  it("'Infinity' -> 0.85 (non-finite guard)", () => {
    expect(parseCrossRunSimilarityThreshold("Infinity")).toBe(0.85);
  });

  it("'   ' -> 0.85 (whitespace-only trims to empty)", () => {
    expect(parseCrossRunSimilarityThreshold("   ")).toBe(0.85);
  });

  it("Number.NaN -> 0.85 (number fast path)", () => {
    expect(parseCrossRunSimilarityThreshold(Number.NaN)).toBe(0.85);
  });

  it("Number.POSITIVE_INFINITY -> 0.85 (number fast path)", () => {
    expect(parseCrossRunSimilarityThreshold(Number.POSITIVE_INFINITY)).toBe(0.85);
  });

  it("Number.NEGATIVE_INFINITY -> 0.85 (number fast path)", () => {
    expect(parseCrossRunSimilarityThreshold(Number.NEGATIVE_INFINITY)).toBe(0.85);
  });

  it("'foo' -> 0.85 (invalid string falls through to NaN guard)", () => {
    expect(parseCrossRunSimilarityThreshold("foo")).toBe(0.85);
  });

  it("'  0.85  ' -> 0.85 (whitespace-padded valid number)", () => {
    expect(parseCrossRunSimilarityThreshold("  0.85  ")).toBe(0.85);
  });

  it("Number(-0) -> 0 (regression: clamp-low path for negative-zero finite input)", () => {
    expect(parseCrossRunSimilarityThreshold(Number(-0))).toBe(0);
  });
});

describe("repo-root .env.example documents the threshold", () => {
  it("contains CROSS_RUN_SIMILARITY_THRESHOLD and 0.85", () => {
    const contents = readRepoFile(".env.example");
    expect(contents).toContain("CROSS_RUN_SIMILARITY_THRESHOLD");
    expect(contents).toContain("0.85");
  });
});

describe("repo-root README documents the threshold", () => {
  it("names CROSS_RUN_SIMILARITY_THRESHOLD and requires a worker restart", () => {
    const contents = readRepoFile("README.md");
    expect(contents).toContain("CROSS_RUN_SIMILARITY_THRESHOLD");
    expect(contents).toMatch(/restart/i);
  });

  it("documents the >= comparison direction beside the threshold", () => {
    const contents = readRepoFile("README.md");
    const key = "CROSS_RUN_SIMILARITY_THRESHOLD";
    const idx = contents.indexOf(key);
    expect(idx).toBeGreaterThanOrEqual(0);
    const start = Math.max(0, idx - 200);
    const end = Math.min(contents.length, idx + key.length + 400);
    const window = contents.slice(start, end);
    expect(window).toMatch(/(≥|>=|at or above|greater than or equal)/i);
  });
});
