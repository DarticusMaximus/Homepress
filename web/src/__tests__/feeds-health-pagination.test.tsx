/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { FeedsPagination } from "@/components/feeds/feeds-pagination";
import { buildFeedsHref } from "@/components/feeds/feeds-url";

afterEach(() => {
  cleanup();
});

describe("buildFeedsHref", () => {
  it("omits query string for defaults", () => {
    expect(buildFeedsHref({})).toBe("/admin/feeds");
    expect(buildFeedsHref({ page: 1 })).toBe("/admin/feeds");
  });

  it("emits only page when no health filter", () => {
    expect(buildFeedsHref({ page: 2 })).toBe("/admin/feeds?page=2");
  });

  it("preserves health=unhealthy across pages (query preservation)", () => {
    expect(buildFeedsHref({ health: "unhealthy", page: 1 })).toBe("/admin/feeds?health=unhealthy");
    expect(buildFeedsHref({ health: "unhealthy", page: 2 })).toBe(
      "/admin/feeds?health=unhealthy&page=2",
    );
  });

  it("ignores unknown health values", () => {
    expect(buildFeedsHref({ health: "bogus", page: 2 })).toBe("/admin/feeds?page=2");
  });
});

describe("FeedsPagination query preservation", () => {
  function renderNav(overrides: {
    page?: number;
    totalPages?: number;
    total?: number;
    health?: string;
  }) {
    return render(
      <FeedsPagination
        page={overrides.page ?? 2}
        totalPages={overrides.totalPages ?? 3}
        total={overrides.total ?? 60}
        health={overrides.health}
      />,
    );
  }

  it("keeps health=unhealthy in Next/Prev hrefs when filter is set", () => {
    const { container } = renderNav({ health: "unhealthy" });
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("health=unhealthy");
    }
    // Next (page 3) must include both params, Prev (page 1) keeps health.
    const next = links.find((a) => /Next/.test(a.textContent ?? ""));
    expect(next?.getAttribute("href")).toBe("/admin/feeds?health=unhealthy&page=3");
    const prev = links.find((a) => /Previous/.test(a.textContent ?? ""));
    expect(prev?.getAttribute("href")).toBe("/admin/feeds?health=unhealthy");
  });

  it("does not add health param when filter is absent", () => {
    const { container } = renderNav({});
    const links = Array.from(container.querySelectorAll("a"));
    for (const a of links) {
      expect(a.getAttribute("href")).not.toContain("health=");
    }
  });

  it("renders nothing when total <= 20", () => {
    const { container } = renderNav({ total: 20, page: 1, totalPages: 1 });
    expect(container.querySelector("nav")).toBeNull();
    expect(within(document.body).queryByLabelText("Feeds pagination")).toBeNull();
  });
});
