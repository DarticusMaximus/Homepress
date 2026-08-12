import { describe, it, expect } from "vitest";
import { navItems } from "@/lib/nav-items";

describe("navItems", () => {
  it("pins title order including Issues between Newsletters and Runs, Settings after Delivery", () => {
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
      "Settings",
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

  it("maps Settings to /settings after Delivery", () => {
    const settings = navItems.find((item) => item.title === "Settings");
    expect(settings?.href).toBe("/settings");
    const deliveryIdx = navItems.findIndex((item) => item.title === "Delivery");
    const settingsIdx = navItems.findIndex((item) => item.title === "Settings");
    expect(settingsIdx).toBe(deliveryIdx + 1);
    expect(navItems).toHaveLength(9);
  });
});
