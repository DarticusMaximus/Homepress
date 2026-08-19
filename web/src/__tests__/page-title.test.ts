import { describe, expect, it } from "vitest";
import { APP_NAME } from "@newsletter/shared";
import { pageTitleForPath } from "@/lib/page-title";

describe("pageTitleForPath", () => {
  it.each<[string, string]>([
    ["/admin/feeds", "Feeds"],
    ["/admin/newsletters", "Newsletters"],
    ["/admin/issues", "Issues"],
    ["/admin/runs", "Runs"],
    ["/admin/schedules", "Schedules"],
    ["/admin/prompts", "Prompts"],
    ["/admin/delivery", "Delivery"],
    ["/admin/settings", "Settings"],
    ["/admin", "Admin"],
    ["/newsletters", "Newsletters"],
    ["/issues", "Issue"],
    ["/", "Home"],
  ])("maps %s → %s", (pathname, title) => {
    expect(pageTitleForPath(pathname)).toBe(title);
  });

  it("titles nested factory newsletter edit as Newsletters, not Admin", () => {
    expect(pageTitleForPath("/admin/newsletters/nl-1")).toBe("Newsletters");
  });

  it("titles a reader channel path as Newsletters", () => {
    expect(pageTitleForPath("/newsletters/nl-1")).toBe("Newsletters");
    expect(pageTitleForPath("/admin/newsletters/nl-1")).toBe("Newsletters");
  });

  it("titles issue reader as Issue", () => {
    expect(pageTitleForPath("/issues/run-1")).toBe("Issue");
  });

  it("falls back to APP_NAME for unknown paths", () => {
    expect(pageTitleForPath("/not-a-real-route")).toBe(APP_NAME);
  });
});
