/// <reference types="@testing-library/jest-dom" />

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TimezoneCombobox } from "@/components/schedules/timezone-combobox";
import {
  COMMON_TIMEZONES,
  listIanaTimezones,
  listTimezoneGroups,
} from "@/lib/timezones";

/** Base UI Combobox needs a few layout/pointer stubs under jsdom. */
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("listTimezoneGroups", () => {
  it("puts common zones first, then the remaining IANA list", () => {
    const groups = listTimezoneGroups();
    expect(groups.map((g) => g.value)).toEqual(["Common", "All timezones"]);
    expect(groups[0].items).toEqual([...COMMON_TIMEZONES]);

    const all = listIanaTimezones();
    const commonSet = new Set<string>(COMMON_TIMEZONES);
    expect(groups[1].items).toEqual(all.filter((z) => !commonSet.has(z)));
  });

  it("prepends an unknown selected timezone into Common", () => {
    const groups = listTimezoneGroups("Etc/Unknown_Zone");
    expect(groups[0].items[0]).toBe("Etc/Unknown_Zone");
    expect(groups[0].items.slice(1)).toEqual([...COMMON_TIMEZONES]);
  });
});

function ControlledTimezoneCombobox({
  initial = "UTC",
}: {
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimezoneCombobox
      id="tz-test"
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("TimezoneCombobox (production)", () => {
  it("filters IANA ids by substring so non-matches disappear", async () => {
    render(<ControlledTimezoneCombobox initial="UTC" />);

    const input = screen.getByPlaceholderText("Search timezone");
    expect(input).toBeInTheDocument();

    // Open the popup so list items mount (Base UI portals content when open).
    fireEvent.focus(input);
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox).getByRole("option", { name: "Asia/Singapore" }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole("option", { name: "America/New_York" }),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Singapore" } });

    const filtered = await screen.findByRole("listbox");
    expect(
      within(filtered).getByRole("option", { name: "Asia/Singapore" }),
    ).toBeInTheDocument();
    expect(
      within(filtered).queryByRole("option", { name: "America/New_York" }),
    ).toBeNull();
  });
});
