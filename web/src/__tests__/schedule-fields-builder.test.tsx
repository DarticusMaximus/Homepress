/// <reference types="@testing-library/jest-dom" />

import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ScheduleFields } from "@/components/schedules/schedule-fields";
import { COMMON_TIMEZONES, listTimezoneGroups } from "@/lib/timezones";

const NEXT_A = "2026-07-21T13:00:00.000Z";
const NEXT_B = "2026-07-21T14:00:00.000Z";

const mocks = vi.hoisted(() => ({
  computeNextFireAt: vi.fn((cron: string): Date | null => {
    const hour = cron.trim().split(/\s+/)[1];
    if (hour === "10") {
      return new Date(NEXT_B);
    }
    if (cron.trim().length === 0) {
      return null;
    }
    return new Date(NEXT_A);
  }),
}));

vi.mock("@newsletter/shared/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared/client")>();
  return {
    ...actual,
    computeNextFireAt: mocks.computeNextFireAt,
  };
});

/** Native select stand-in — Radix Select needs scrollIntoView in jsdom. */
vi.mock("@/components/ui/select", () => {
  type ChildProps = {
    id?: string;
    value?: string;
    children?: ReactNode;
    onValueChange?: unknown;
  };

  function propsOf(el: ReactElement): ChildProps {
    return el.props as ChildProps;
  }

  function walk(node: ReactNode, visit: (el: ReactElement) => void) {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      visit(child);
      const nested = propsOf(child).children;
      if (nested != null) {
        walk(nested, visit);
      }
    });
  }

  function Select({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) {
    let triggerId: string | undefined;
    const options: ReactElement[] = [];

    walk(children, (el) => {
      const p = propsOf(el);
      if (typeof p.id === "string") {
        triggerId = p.id;
      }
    });

    walk(children, (el) => {
      const p = propsOf(el);
      // SelectItem carries value + label; skip Root/Trigger-shaped nodes.
      if (
        typeof p.value === "string" &&
        p.children != null &&
        p.onValueChange === undefined &&
        p.id === undefined
      ) {
        options.push(
          <option key={p.value} value={p.value}>
            {p.children}
          </option>,
        );
      }
    });

    const seen = new Set<string>();
    const uniqueOptions = options.filter((opt) => {
      const v = String(propsOf(opt).value ?? "");
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });

    return (
      <select
        id={triggerId}
        data-testid="mock-select"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {(value === "" || value === undefined) && <option value="">—</option>}
        {uniqueOptions}
      </select>
    );
  }

  function SelectTrigger({ id, children }: { id?: string; children?: ReactNode; className?: string }) {
    return <span data-select-trigger-id={id}>{children}</span>;
  }

  function SelectValue() {
    return null;
  }

  function SelectContent({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }

  function SelectItem({ value, children }: { value: string; children?: ReactNode }) {
    return <option value={value}>{children}</option>;
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

/**
 * Searchable timezone stand-in — Base UI Combobox is awkward in jsdom.
 * Still uses listTimezoneGroups so common-zone / unknown-tz behavior is real.
 */
vi.mock("@/components/schedules/timezone-combobox", () => ({
  TimezoneCombobox({
    id,
    value,
    onValueChange,
    disabled,
  }: {
    id: string;
    value: string;
    onValueChange: (timezone: string) => void;
    disabled?: boolean;
  }) {
    const [query, setQuery] = useState("");
    const groups = listTimezoneGroups(value);
    const zones = groups
      .flatMap((g) => g.items)
      .filter((zone) => zone.toLowerCase().includes(query.toLowerCase()));

    return (
      <div data-testid="timezone-combobox">
        <input
          id={id}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-listbox`}
          placeholder="Search timezone"
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul id={`${id}-listbox`} role="listbox">
          {zones.map((zone) => (
            <li key={zone} role="option" aria-selected={zone === value}>
              <button type="button" onClick={() => onValueChange(zone)}>
                {zone}
              </button>
            </li>
          ))}
        </ul>
        <span data-testid="timezone-selected">{value}</span>
      </div>
    );
  },
}));

function cronInput(): HTMLInputElement {
  const el = document.querySelector('input[name="scheduleCron"]');
  expect(el).toBeInstanceOf(HTMLInputElement);
  return el as HTMLInputElement;
}

function timezoneHidden(): HTMLInputElement {
  const el = document.querySelector('input[name="scheduleTimezone"]');
  expect(el).toBeInstanceOf(HTMLInputElement);
  return el as HTMLInputElement;
}

function renderSchedule(
  overrides: Partial<{
    idPrefix: string;
    defaultEnabled: boolean;
    defaultCron: string;
    defaultTimezone: string;
  }> = {},
) {
  return render(
    <form>
      <ScheduleFields
        idPrefix={overrides.idPrefix ?? "test"}
        defaultEnabled={overrides.defaultEnabled ?? true}
        defaultCron={overrides.defaultCron ?? ""}
        defaultTimezone={overrides.defaultTimezone ?? "UTC"}
      />
    </form>,
  );
}

beforeEach(() => {
  mocks.computeNextFireAt.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ScheduleFields guided builder", () => {
  it("blank defaultCron seeds Weekdays 09:00 and submits cron while Advanced is collapsed", () => {
    renderSchedule({ defaultCron: "" });

    expect(screen.getByLabelText("Frequency")).toHaveValue("weekdays");
    expect(screen.getByLabelText("Hour")).toHaveValue("9");
    expect(screen.getByLabelText("Minute")).toHaveValue("0");

    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "data-state",
      "closed",
    );
    expect(cronInput()).toHaveValue("0 9 * * 1-5");
  });

  it("prefills guided Weekdays + timezone from cron and IANA id", () => {
    renderSchedule({
      defaultCron: "0 9 * * 1-5",
      defaultTimezone: "America/New_York",
    });

    expect(screen.getByLabelText("Frequency")).toHaveValue("weekdays");
    expect(screen.getByLabelText("Hour")).toHaveValue("9");
    expect(screen.getByLabelText("Minute")).toHaveValue("0");
    expect(screen.getByTestId("timezone-selected")).toHaveTextContent("America/New_York");
    expect(timezoneHidden()).toHaveValue("America/New_York");
  });

  it("non-guided cron opens Custom expression with Advanced open and dimmed controls", () => {
    renderSchedule({ defaultCron: "0 0 1 * *" });

    expect(screen.getByText("Custom expression")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.getByLabelText("Cron expression")).toHaveValue("0 0 1 * *");
    expect(screen.getByLabelText("Hour")).toBeDisabled();
    expect(screen.getByLabelText("Minute")).toBeDisabled();
  });

  it("choosing Daily from Custom overwrites cron to a daily pattern", () => {
    renderSchedule({ defaultCron: "0 0 1 * *" });

    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "daily" } });

    expect(screen.queryByText("Custom expression")).not.toBeInTheDocument();
    expect(cronInput().value).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("editing Advanced cron away from guided encode enters Custom", () => {
    renderSchedule({ defaultCron: "0 9 * * 1-5" });

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), {
      target: { value: "0 9 1 * *" },
    });

    expect(screen.getByText("Custom expression")).toBeInTheDocument();
    expect(screen.getByLabelText("Hour")).toBeDisabled();
  });

  it("live next fire is non-dash when enabled and updates when hour changes", () => {
    renderSchedule({
      defaultEnabled: true,
      defaultCron: "0 9 * * 1-5",
      defaultTimezone: "UTC",
    });

    const nextFire = screen.getByText(/^Next fire:/);
    expect(nextFire.textContent).not.toMatch(/Next fire: —$/);
    const before = nextFire.textContent!;

    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "10" } });

    const after = screen.getByText(/^Next fire:/).textContent!;
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/Next fire: —$/);
  });

  it("unchecked enable shows Next fire: —", () => {
    renderSchedule({
      defaultEnabled: false,
      defaultCron: "0 9 * * 1-5",
    });

    expect(screen.getByText("Next fire: —")).toBeInTheDocument();
  });

  it("timezone combobox lists common zones, supports search, and updates scheduleTimezone", () => {
    renderSchedule({ defaultTimezone: "UTC" });

    const list = screen.getByRole("listbox");
    for (const zone of COMMON_TIMEZONES) {
      expect(within(list).getByRole("button", { name: zone })).toBeInTheDocument();
    }

    fireEvent.change(screen.getByPlaceholderText("Search timezone"), {
      target: { value: "Singapore" },
    });
    expect(within(list).getByRole("button", { name: "Asia/Singapore" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "America/New_York" })).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: "Asia/Singapore" }));
    expect(timezoneHidden()).toHaveValue("Asia/Singapore");
  });

  it("unknown stored timezone still appears as the current value", () => {
    renderSchedule({ defaultTimezone: "Etc/Unknown_Zone" });

    expect(screen.getByTestId("timezone-selected")).toHaveTextContent("Etc/Unknown_Zone");
    expect(timezoneHidden()).toHaveValue("Etc/Unknown_Zone");
    expect(
      within(screen.getByRole("listbox")).getByRole("button", { name: "Etc/Unknown_Zone" }),
    ).toBeInTheDocument();
  });

  it("deselecting the last Custom weekday keeps the previous cron", () => {
    renderSchedule({ defaultCron: "0 9 * * 1" });

    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "custom" } });
    expect(cronInput()).toHaveValue("0 9 * * 1");

    const mon = screen.getByRole("button", { name: "Mon" });
    expect(mon).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(mon);

    expect(cronInput()).toHaveValue("0 9 * * 1");
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "false");
  });
});
