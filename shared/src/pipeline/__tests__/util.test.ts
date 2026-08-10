import { describe, it, expect } from "vitest";

import { truncateForHaltReason } from "../util";

describe("truncateForHaltReason (O1-20260630)", () => {
  it("strips \\n and \\r (collapsing runs) then slices to max (default 200)", () => {
    const msg = "line1\nline2\r\nline3\rmulti   spaces\n\n\nend" + "x".repeat(300);
    const out = truncateForHaltReason(msg);
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\r");
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it("input shorter than max → unchanged except newline flattening", () => {
    expect(truncateForHaltReason("hello\nworld")).toBe("hello world");
    expect(truncateForHaltReason("hello")).toBe("hello");
  });

  it("collapses consecutive newlines into a single space", () => {
    expect(truncateForHaltReason("a\n\n\nb")).toBe("a b");
    expect(truncateForHaltReason("a\r\n\r\nb")).toBe("a b");
  });

  it("respects a custom max", () => {
    expect(truncateForHaltReason("abcdef", 3)).toBe("abc");
    expect(truncateForHaltReason("ab\ncd", 4)).toBe("ab c");
  });

  it("exactly-max input (after flattening) is unchanged", () => {
    const exact = "a".repeat(200);
    expect(truncateForHaltReason(exact)).toBe(exact);
    expect(truncateForHaltReason(exact).length).toBe(200);
  });

  it("empty string → empty string", () => {
    expect(truncateForHaltReason("")).toBe("");
  });
});
