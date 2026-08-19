/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { SchedulesTable } from "@/components/schedules/schedules-table";

afterEach(() => {
  cleanup();
});

const NEXT_FIRE_AT = "2026-07-17T13:00:00.000Z";

function formatNextFireAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Fixture shape matching Schedules list rows (newsletter id/name + schedule view). */
const fixtures = [
  {
    $id: "nl-enabled",
    name: "Morning Digest",
    enabled: true,
    cron: "0 9 * * 1-5",
    timezone: "America/New_York",
    nextFireAt: NEXT_FIRE_AT,
  },
  {
    $id: "nl-disabled",
    name: "Weekend Wrap",
    enabled: false,
    cron: "",
    timezone: "UTC",
    nextFireAt: null,
  },
];

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("Schedules dual presentation (ResponsiveList)", () => {
  it("renders table and cards with field and action parity", () => {
    render(<SchedulesTable schedules={fixtures} />);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const table = within(tableSlot);
    const cards = within(cardsSlot);

    for (const row of fixtures) {
      expect(table.getByText(row.name)).toBeInTheDocument();
      expect(cards.getByText(row.name)).toBeInTheDocument();

      expect(table.getByText(row.timezone)).toBeInTheDocument();
      expect(cards.getByText(row.timezone)).toBeInTheDocument();
    }

    expect(table.getByText("Enabled")).toBeInTheDocument();
    expect(cards.getByText("Enabled")).toBeInTheDocument();
    expect(table.getByText("0 9 * * 1-5")).toBeInTheDocument();
    expect(cards.getByText("0 9 * * 1-5")).toBeInTheDocument();

    const nextFire = formatNextFireAt(NEXT_FIRE_AT);
    expect(table.getByText(nextFire)).toBeInTheDocument();
    expect(cards.getByText(nextFire)).toBeInTheDocument();

    for (const row of fixtures) {
      const editScheduleName = `Edit schedule ${row.name}`;
      const editNewsletterName = `Edit newsletter ${row.name}`;
      const href = `/admin/newsletters/${row.$id}`;

      expect(table.getByRole("button", { name: editScheduleName })).toBeInTheDocument();
      expect(cards.getByRole("button", { name: editScheduleName })).toBeInTheDocument();

      const editNewsletterTable = table.getByRole("link", { name: editNewsletterName });
      const editNewsletterCards = cards.getByRole("link", { name: editNewsletterName });
      expect(editNewsletterTable).toHaveAttribute("href", href);
      expect(editNewsletterCards).toHaveAttribute("href", href);
    }
  });

  it("disabled row shows Status Disabled and Next fire — in both presentations", () => {
    render(<SchedulesTable schedules={fixtures} />);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");

    const table = within(tableSlot);
    const cards = within(cardsSlot);

    expect(table.getByText("Disabled")).toBeInTheDocument();
    expect(cards.getByText("Disabled")).toBeInTheDocument();

    // Disabled next fire is em dash; enabled row also uses — for empty cron when applicable.
    const tableDashes = table.getAllByText("—");
    const cardsDashes = cards.getAllByText("—");
    expect(tableDashes.length).toBeGreaterThanOrEqual(1);
    expect(cardsDashes.length).toBeGreaterThanOrEqual(1);
  });
});
