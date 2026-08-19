import { describe, expect, it } from "vitest";
import { buildChannelHref, buildReaderNewslettersHref } from "@/lib/channel-url";

describe("buildReaderNewslettersHref", () => {
  it("emits /newsletters for default and page 1, and /newsletters?page=N when page > 1", () => {
    expect(buildReaderNewslettersHref({})).toBe("/newsletters");
    expect(buildReaderNewslettersHref({ page: 1 })).toBe("/newsletters");
    expect(buildReaderNewslettersHref({ page: 2 })).toBe("/newsletters?page=2");
  });
});

describe("buildChannelHref", () => {
  it("emits /newsletters/{id} for default and page 1, and ?page=N when page > 1", () => {
    expect(buildChannelHref("nl-1", {})).toBe("/newsletters/nl-1");
    expect(buildChannelHref("nl-1", { page: 1 })).toBe("/newsletters/nl-1");
    expect(buildChannelHref("nl-1", { page: 2 })).toBe("/newsletters/nl-1?page=2");
  });
});
