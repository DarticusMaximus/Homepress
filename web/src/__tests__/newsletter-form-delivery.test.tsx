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

const CONFIGURED_NEWSLETTER: Newsletter = {
  ...NEWSLETTER,
  recipientEmails: ["alice@example.com", "bob@example.com"],
  autoEmail: true,
  autoRss: false,
};

const emptyFeeds = { attached: [], eligible: [] };

function renderEditForm(
  newsletter: Newsletter = NEWSLETTER,
  options: { appPublicUrl?: string | null } = {},
) {
  return render(
    <NewsletterEditForm
      newsletter={newsletter}
      feeds={emptyFeeds}
      appPublicUrl={options.appPublicUrl}
    />,
  );
}

function openDeliveryTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Delivery" }));
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
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("NewsletterEditForm — Delivery", () => {
  it("Delivery tab shows recipients and auto toggles reflecting defaults", () => {
    renderEditForm();
    openDeliveryTab();

    expect(screen.getByRole("heading", { name: "Delivery" })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipients")).toBeInTheDocument();
    expect(screen.getByLabelText("Auto-email")).toHaveAttribute("name", "autoEmail");
    expect(screen.getByLabelText("Auto-RSS")).toHaveAttribute("name", "autoRss");
    expect(screen.getByLabelText("Auto-email")).not.toBeChecked();
    expect(screen.getByLabelText("Auto-RSS")).not.toBeChecked();
    expect(
      screen.getByText(
        "Email addresses for this newsletter’s family inbox list. Not a public signup — no unsubscribe flow.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Defaults off while tuning. Auto-email and auto-RSS are independent; when enabled, they run after a successful generate.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/later feature/i)).not.toBeInTheDocument();
  });

  it("prefills recipients chips and Auto-email from newsletter", () => {
    renderEditForm(CONFIGURED_NEWSLETTER);
    openDeliveryTab();

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Auto-email")).toBeChecked();
    expect(screen.getByLabelText("Auto-RSS")).not.toBeChecked();

    const hidden = document.querySelector(
      'input[name="recipientEmailsJson"]',
    ) as HTMLInputElement | null;
    expect(hidden).not.toBeNull();
    expect(JSON.parse(hidden!.value)).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("19. with APP_PUBLIC_URL shows absolute /rss/{id}.xml feed URL in Delivery", () => {
    renderEditForm(NEWSLETTER, { appPublicUrl: "https://news.example.test" });
    openDeliveryTab();

    const feedUrl = "https://news.example.test/rss/nl-1.xml";
    expect(screen.getByLabelText("RSS feed URL")).toHaveValue(feedUrl);
    expect(screen.getByRole("button", { name: "Copy RSS feed URL" })).toBeInTheDocument();
    expect(
      screen.queryByText("Set APP_PUBLIC_URL to show the public RSS feed URL."),
    ).not.toBeInTheDocument();
  });

  it("19. without APP_PUBLIC_URL shows guidance copy and no fake host", () => {
    renderEditForm(NEWSLETTER, { appPublicUrl: null });
    openDeliveryTab();

    expect(
      screen.getByText("Set APP_PUBLIC_URL to show the public RSS feed URL."),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/\/rss\//)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/localhost/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy RSS feed URL" })).not.toBeInTheDocument();
  });
});

describe("NewsletterFormDialog — Delivery (create)", () => {
  it("create mode hides Delivery section and auto-email checkbox", () => {
    renderCreate();

    expect(screen.queryByRole("heading", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Auto-email")).not.toBeInTheDocument();
    expect(document.querySelector('[name="autoEmail"]')).toBeNull();
    expect(document.querySelector('[name="recipientEmailsJson"]')).toBeNull();
  });
});
