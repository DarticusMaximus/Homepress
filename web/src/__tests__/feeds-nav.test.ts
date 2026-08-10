import { describe, it, expect } from "vitest";
import { navItems } from "@/lib/nav-items";

describe("navItems", () => {
  it("pins title order including Issues between Newsletters and Runs", () => {
    const titles = navItems.map((item) => item.title);
    expect(titles).toEqual([
      "Dashboard",
      "Feeds",
      "Newsletters",
      "Issues",
      "Runs",
      "Schedules",
      "Prompts",
      "Delivery",
    ]);
  });

  it("maps Feeds to /feeds", () => {
    const feeds = navItems.find((item) => item.title === "Feeds");
    expect(feeds?.href).toBe("/feeds");
  });

  it("maps Issues to /issues", () => {
    const issues = navItems.find((item) => item.title === "Issues");
    expect(issues?.href).toBe("/issues");
  });

  it("maps Schedules to /schedules", () => {
    const schedules = navItems.find((item) => item.title === "Schedules");
    expect(schedules?.href).toBe("/schedules");
  });
});
