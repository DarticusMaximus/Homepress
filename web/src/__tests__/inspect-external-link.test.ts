import { describe, it, expect } from "vitest";
import { toSafeHttpUrl } from "@/components/runs/inspect-external-link";

describe("toSafeHttpUrl", () => {
  it("accepts absolute http and https URLs", () => {
    expect(toSafeHttpUrl("https://example.test/path")).toBe(
      "https://example.test/path",
    );
    expect(toSafeHttpUrl("http://example.test/plain")).toBe(
      "http://example.test/plain",
    );
  });

  it("rejects empty, relative, malformed, and non-HTTP(S) schemes", () => {
    expect(toSafeHttpUrl("")).toBeNull();
    expect(toSafeHttpUrl("   ")).toBeNull();
    expect(toSafeHttpUrl("/relative/path")).toBeNull();
    expect(toSafeHttpUrl("not a url")).toBeNull();
    expect(toSafeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(toSafeHttpUrl("data:text/html,hi")).toBeNull();
    expect(toSafeHttpUrl("mailto:ops@example.test")).toBeNull();
  });
});
