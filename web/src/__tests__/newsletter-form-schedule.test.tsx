/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Newsletter } from "@newsletter/shared";
import { NewsletterEditForm } from "@/components/newsletters/newsletter-edit-form";
import { NewsletterFormDialog } from "@/components/newsletters/newsletter-form-dialog";

const mockPush = vi.fn();

const mocks = vi.hoisted(() => ({
  createNewsletterAction: vi.fn(async () => ({ ok: true as const })),
  updateNewsletterAction: vi.fn(async () => ({ ok: true as const })),
  attachFeedToNewsletter: vi.fn(async () => ({ ok: true as const })),
  detachFeedFromNewsletter: vi.fn(async () => ({ ok: true as const })),
  computeNextFireAt: vi.fn(() => new Date("2026-07-17T13:00:00.000Z")),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/newsletters",
}));

vi.mock("@/app/(protected)/admin/newsletters/actions", () => ({
  createNewsletterAction: mocks.createNewsletterAction,
  updateNewsletterAction: mocks.updateNewsletterAction,
  attachFeedToNewsletter: mocks.attachFeedToNewsletter,
  detachFeedFromNewsletter: mocks.detachFeedFromNewsletter,
}));

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
}));

vi.mock("@newsletter/shared/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared/client")>();
  return {
    ...actual,
    computeNextFireAt: mocks.computeNextFireAt,
  };
});

/** Native select stand-in — Radix Select needs scrollIntoView in jsdom. */
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { Children, isValidElement } = React;
  type ReactNode = React.ReactNode;
  type ReactElement = React.ReactElement;

  type ChildProps = {
    id?: string;
    value?: string;
    children?: ReactNode;
    onValueChange?: unknown;
    name?: string;
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
    defaultValue,
    onValueChange,
    disabled,
    name,
    children,
  }: {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    name?: string;
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
      if (
        typeof p.value === "string" &&
        p.children != null &&
        p.onValueChange === undefined &&
        p.id === undefined &&
        p.name === undefined
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

    const resolved = value ?? defaultValue ?? "";

    return (
      <select
        id={triggerId}
        name={name}
        data-testid="mock-select"
        defaultValue={value === undefined ? resolved : undefined}
        value={value !== undefined ? value : undefined}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
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
    return (
      <input
        id={id}
        role="combobox"
        aria-expanded="false"
        aria-controls={`${id}-listbox`}
        placeholder="Search timezone"
        disabled={disabled}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      />
    );
  },
}));

const NEWSLETTER: Newsletter = {
  $id: "nl-1",
  name: "Daily AI",
  topics: ["ai"],
  dislikedTopics: [],
  audience: "engineers",
  newsItems: 16,
  dateRange: "yesterday",
  lookback: 3,
  taggerModel: "",
  scorerModel: "",
  drafterModel: "",
  embedderModel: "",
  drafterPrompt: "",
  scheduleEnabled: false,
  scheduleCron: "",
  scheduleTimezone: "UTC",
  scheduleLastFiredAt: null,
  recipientEmails: [],
  autoEmail: false,
  autoRss: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const SCHEDULED_NEWSLETTER: Newsletter = {
  ...NEWSLETTER,
  scheduleEnabled: true,
  scheduleCron: "0 9 * * 1-5",
  scheduleTimezone: "America/New_York",
};

const emptyFeeds = { attached: [], eligible: [] };

function renderEditForm(newsletter: Newsletter = NEWSLETTER) {
  return render(
    <NewsletterEditForm newsletter={newsletter} feeds={emptyFeeds} appPublicUrl="https://example.com" />,
  );
}

function openScheduleTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
}

function renderCreate() {
  return render(<NewsletterFormDialog open onOpenChange={() => {}} />);
}

afterEach(() => {
  cleanup();
  mocks.createNewsletterAction.mockReset();
  mocks.updateNewsletterAction.mockReset();
  mocks.attachFeedToNewsletter.mockReset();
  mocks.detachFeedFromNewsletter.mockReset();
  mocks.computeNextFireAt.mockClear();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("NewsletterEditForm — Schedule", () => {
  it("Schedule tab shows enable, guided builder, Advanced cron, and timezone", () => {
    renderEditForm();
    openScheduleTab();

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByLabelText("Enable schedule")).toHaveAttribute("name", "scheduleEnabled");
    expect(screen.getByLabelText("Frequency")).toBeInTheDocument();
    expect(screen.getByLabelText("Timezone")).toBeInTheDocument();
    expect(document.querySelector('input[name="scheduleTimezone"]')).toHaveValue("UTC");

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("Cron expression")).toHaveAttribute("name", "scheduleCron");
    expect(
      screen.getByText(
        "Five fields: minute hour day-of-month month day-of-week. Example: 0 9 * * 1-5",
      ),
    ).toBeInTheDocument();
  });

  it("prefills guided schedule and shows a live next-fire line", () => {
    renderEditForm(SCHEDULED_NEWSLETTER);
    openScheduleTab();

    expect(screen.getByLabelText("Enable schedule")).toBeChecked();
    expect(screen.getByLabelText("Frequency")).toHaveValue("weekdays");
    expect(screen.getByLabelText("Hour")).toHaveValue("9");
    expect(screen.getByLabelText("Minute")).toHaveValue("0");
    expect(document.querySelector('input[name="scheduleCron"]')).toHaveValue("0 9 * * 1-5");
    expect(document.querySelector('input[name="scheduleTimezone"]')).toHaveValue(
      "America/New_York",
    );

    const nextFire = screen.getByText(/^Next fire:/);
    expect(nextFire.textContent).not.toMatch(/Next fire: —$/);
  });
});

describe("NewsletterFormDialog — Schedule (create)", () => {
  it("create mode hides Schedule section and scheduleCron input", () => {
    renderCreate();

    expect(screen.queryByRole("heading", { name: "Schedule" })).not.toBeInTheDocument();
    expect(document.querySelector('[name="scheduleCron"]')).toBeNull();
  });
});
