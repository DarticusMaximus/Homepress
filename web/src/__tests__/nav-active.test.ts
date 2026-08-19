import { describe, expect, it } from "vitest";
import { isNavItemActive } from "@/lib/nav-active";

describe("isNavItemActive", () => {
  describe("Home `/`", () => {
    it("is active only for exact `/`", () => {
      expect(isNavItemActive("/", "/")).toBe(true);
    });

    it("is not active for nested or sibling paths", () => {
      expect(isNavItemActive("/runs", "/")).toBe(false);
      expect(isNavItemActive("/feeds", "/")).toBe(false);
      expect(isNavItemActive("/admin", "/")).toBe(false);
      expect(isNavItemActive("/anything", "/")).toBe(false);
    });
  });

  describe("section hrefs (e.g. `/runs`, `/issues`)", () => {
    it("is active for exact match", () => {
      expect(isNavItemActive("/runs", "/runs")).toBe(true);
      expect(isNavItemActive("/issues", "/issues")).toBe(true);
      expect(isNavItemActive("/newsletters", "/newsletters")).toBe(true);
      expect(isNavItemActive("/feeds", "/feeds")).toBe(true);
    });

    it("is active for nested routes under the href", () => {
      expect(isNavItemActive("/runs/x/inspect", "/runs")).toBe(true);
      expect(isNavItemActive("/issues/x", "/issues")).toBe(true);
      expect(isNavItemActive("/admin/feeds", "/admin")).toBe(true);
    });

    it("marks reader Newsletters active on a channel and not on factory edit", () => {
      expect(isNavItemActive("/newsletters/nl-1", "/newsletters")).toBe(true);
      expect(isNavItemActive("/admin/newsletters/nl-1", "/newsletters")).toBe(false);
    });

    it("rejects prefix siblings (requires href + `/`)", () => {
      expect(isNavItemActive("/feedback", "/feeds")).toBe(false);
      expect(isNavItemActive("/runs-archive", "/runs")).toBe(false);
      expect(isNavItemActive("/issuesome", "/issues")).toBe(false);
    });

    it("does not activate a different section", () => {
      expect(isNavItemActive("/issues/x", "/runs")).toBe(false);
      expect(isNavItemActive("/runs/x/inspect", "/issues")).toBe(false);
    });
  });
});
