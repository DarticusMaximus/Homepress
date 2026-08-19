import { describe, expect, it } from "vitest";
import { buildHomeHref } from "@/lib/home-url";

describe("buildHomeHref", () => {
  it("emits / for default and page 1, and /?page=N when page > 1", () => {
    expect(buildHomeHref({})).toBe("/");
    expect(buildHomeHref({ page: 1 })).toBe("/");
    expect(buildHomeHref({ page: 2 })).toBe("/?page=2");
  });
});
