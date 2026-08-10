/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResponsiveList } from "@/components/domain-list/responsive-list";

afterEach(() => {
  cleanup();
});

describe("ResponsiveList", () => {
  it("mounts table and cards slots with md visibility classes", () => {
    render(<ResponsiveList table={<div>TABLE</div>} cards={<div>CARDS</div>} />);

    const tableSlot = document.querySelector('[data-slot="domain-list-table"]');
    const cardsSlot = document.querySelector('[data-slot="domain-list-cards"]');

    expect(tableSlot).toBeTruthy();
    expect(cardsSlot).toBeTruthy();

    expect(tableSlot).toHaveTextContent("TABLE");
    expect(cardsSlot).toHaveTextContent("CARDS");

    const tableClass = (tableSlot as HTMLElement).className;
    expect(tableClass).toMatch(/\bhidden\b/);
    expect(tableClass).toMatch(/\bmd:block\b/);

    const cardsClass = (cardsSlot as HTMLElement).className;
    expect(cardsClass).toMatch(/\bmd:hidden\b/);

    expect(screen.getByText("TABLE")).toBeInTheDocument();
    expect(screen.getByText("CARDS")).toBeInTheDocument();
  });
});
