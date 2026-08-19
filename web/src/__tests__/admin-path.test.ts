import { describe, expect, it } from "vitest";
import { isAdminPath } from "@/lib/nav-active";
import { factoryNavItems, navItems } from "@/lib/nav-items";

describe("isAdminPath", () => {
  it("is true for /admin and nested /admin/* factory paths", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/feeds")).toBe(true);
    expect(isAdminPath("/admin/newsletters/nl-1")).toBe(true);
    expect(isAdminPath("/admin/runs/r/inspect")).toBe(true);
    expect(isAdminPath("/admin/issues/run-1")).toBe(true);
  });

  it("is false for reader paths and admin prefix siblings", () => {
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/newsletters")).toBe(false);
    expect(isAdminPath("/newsletters/nl-1")).toBe(false);
    expect(isAdminPath("/issues/run-1")).toBe(false);
    expect(isAdminPath("/administration")).toBe(false);
    expect(isAdminPath("/admin-extra")).toBe(false);
  });
});

describe("factoryNavItems vs navItems", () => {
  it("keeps navItems as three reader items and exports the eight factory roots", () => {
    expect(navItems).toHaveLength(3);
    expect(navItems.map((item) => item.title)).toEqual(["Home", "Newsletters", "Admin"]);
    expect(navItems.map((item) => item.href)).toEqual(["/", "/newsletters", "/admin"]);

    const readerTitles = navItems.map((item) => item.title);
    expect(readerTitles).not.toContain("Feeds");
    expect(readerTitles).not.toContain("Issues");
    expect(readerTitles).not.toContain("Runs");
    expect(readerTitles).not.toContain("Schedules");
    expect(readerTitles).not.toContain("Prompts");
    expect(readerTitles).not.toContain("Delivery");
    expect(readerTitles).not.toContain("Settings");

    expect(factoryNavItems.map((item) => item.title)).toEqual([
      "Feeds",
      "Newsletters",
      "Issues",
      "Runs",
      "Schedules",
      "Prompts",
      "Delivery",
      "Settings",
    ]);
    expect(factoryNavItems.map((item) => item.href)).toEqual([
      "/admin/feeds",
      "/admin/newsletters",
      "/admin/issues",
      "/admin/runs",
      "/admin/schedules",
      "/admin/prompts",
      "/admin/delivery",
      "/admin/settings",
    ]);
  });
});
