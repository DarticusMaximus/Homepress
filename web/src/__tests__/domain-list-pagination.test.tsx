/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DomainListPagination } from "@/components/domain-list/domain-list-pagination";
import { FeedsPagination } from "@/components/feeds/feeds-pagination";

afterEach(() => {
  cleanup();
});

function buildPageHref(page: number): string {
  return page === 1 ? "/feeds" : `/feeds?page=${page}`;
}

function renderPagination(
  overrides: {
    page?: number;
    totalPages?: number;
    total?: number;
    noun?: string;
    ariaLabel?: string;
    pageSizeThreshold?: number;
    buildPageHref?: (page: number) => string;
  } = {},
) {
  return render(
    <DomainListPagination
      ariaLabel={overrides.ariaLabel ?? "Feeds pagination"}
      page={overrides.page ?? 2}
      totalPages={overrides.totalPages ?? 3}
      total={overrides.total ?? 60}
      noun={overrides.noun ?? "feeds"}
      buildPageHref={overrides.buildPageHref ?? buildPageHref}
      pageSizeThreshold={overrides.pageSizeThreshold}
    />,
  );
}

describe("DomainListPagination", () => {
  it("renders nothing when total equals the default pageSizeThreshold (20)", () => {
    const { container } = renderPagination({ total: 20, page: 1, totalPages: 1 });
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.queryByLabelText("Feeds pagination")).toBeNull();
  });

  it("renders nothing when total is below pageSizeThreshold", () => {
    const { container } = renderPagination({ total: 5, page: 1, totalPages: 1 });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("honors a custom pageSizeThreshold", () => {
    const { container } = renderPagination({
      total: 25,
      page: 1,
      totalPages: 1,
      pageSizeThreshold: 30,
    });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("shows status text with noun when total exceeds the threshold", () => {
    renderPagination({ page: 2, totalPages: 3, total: 60, noun: "feeds" });

    const nav = screen.getByLabelText("Feeds pagination");
    expect(nav).toHaveClass("mt-4", "flex", "items-center", "justify-between", "gap-4");
    expect(within(nav).getByText("Page 2 of 3 (60 feeds)")).toBeInTheDocument();
  });

  it("wires Prev/Next hrefs through buildPageHref and disables at ends", () => {
    const hrefBuilder = vi.fn((page: number) =>
      page === 1 ? "/items" : `/items?page=${page}`,
    );

    const { rerender } = render(
      <DomainListPagination
        ariaLabel="Items pagination"
        page={2}
        totalPages={3}
        total={60}
        noun="items"
        buildPageHref={hrefBuilder}
      />,
    );

    const midNav = screen.getByLabelText("Items pagination");
    const midLinks = Array.from(midNav.querySelectorAll("a"));
    expect(midLinks).toHaveLength(2);

    const prev = midLinks.find((a) => /Previous/.test(a.textContent ?? ""));
    const next = midLinks.find((a) => /Next/.test(a.textContent ?? ""));
    expect(prev?.getAttribute("href")).toBe("/items");
    expect(next?.getAttribute("href")).toBe("/items?page=3");
    expect(hrefBuilder).toHaveBeenCalledWith(1);
    expect(hrefBuilder).toHaveBeenCalledWith(3);

    rerender(
      <DomainListPagination
        ariaLabel="Items pagination"
        page={1}
        totalPages={3}
        total={60}
        noun="items"
        buildPageHref={hrefBuilder}
      />,
    );

    const firstNav = screen.getByLabelText("Items pagination");
    expect(within(firstNav).getByRole("button", { name: /Previous/ })).toBeDisabled();
    const firstNext = within(firstNav).getByRole("link", { name: /Next/ });
    expect(firstNext.getAttribute("href")).toBe("/items?page=2");

    rerender(
      <DomainListPagination
        ariaLabel="Items pagination"
        page={3}
        totalPages={3}
        total={60}
        noun="items"
        buildPageHref={hrefBuilder}
      />,
    );

    const lastNav = screen.getByLabelText("Items pagination");
    expect(within(lastNav).getByRole("button", { name: /Next/ })).toBeDisabled();
    const lastPrev = within(lastNav).getByRole("link", { name: /Previous/ });
    expect(lastPrev.getAttribute("href")).toBe("/items?page=2");
  });

  it("uses buildPageHref for page 1 links without inventing query params", () => {
    renderPagination({
      page: 2,
      totalPages: 2,
      total: 40,
      buildPageHref,
    });

    const nav = screen.getByLabelText("Feeds pagination");
    const prev = Array.from(nav.querySelectorAll("a")).find((a) =>
      /Previous/.test(a.textContent ?? ""),
    );
    expect(prev?.getAttribute("href")).toBe("/feeds");
  });
});

describe("FeedsPagination thin wrapper (T2)", () => {
  it("exposes Feeds pagination aria-label and shared status text when total > 20", () => {
    render(<FeedsPagination page={1} totalPages={3} total={45} />);

    const nav = screen.getByLabelText("Feeds pagination");
    expect(within(nav).getByText(/Page 1 of 3 \(45 feeds\)/)).toBeInTheDocument();
  });
});
