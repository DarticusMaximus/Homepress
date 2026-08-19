import { describe, it, expect } from "vitest";
import { navItems } from "@/lib/nav-items";

describe("navItems", () => {
  it("pins reader title order Home, Newsletters, Admin", () => {
    const titles = navItems.map((item) => item.title);
    expect(titles).toEqual(["Home", "Newsletters", "Admin"]);
  });

  it("maps Home to /", () => {
    const home = navItems.find((item) => item.title === "Home");
    expect(home?.href).toBe("/");
  });

  it("maps Newsletters to /newsletters", () => {
    const newsletters = navItems.find((item) => item.title === "Newsletters");
    expect(newsletters?.href).toBe("/newsletters");
  });

  it("maps Admin to /admin and has no factory top-level items", () => {
    const admin = navItems.find((item) => item.title === "Admin");
    expect(admin?.href).toBe("/admin");
    expect(navItems).toHaveLength(3);
    expect(navItems.some((item) => item.title === "Feeds")).toBe(false);
    expect(navItems.some((item) => item.title === "Issues")).toBe(false);
    expect(navItems.some((item) => item.title === "Runs")).toBe(false);
    expect(navItems.some((item) => item.title === "Schedules")).toBe(false);
    expect(navItems.some((item) => item.title === "Settings")).toBe(false);
  });
});
