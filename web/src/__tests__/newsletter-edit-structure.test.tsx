/// <reference types="@testing-library/jest-dom" />

/**
 * Task 1 (TDD): failing tests for newsletter edit page structure + create redirect.
 * Edit-form / nav-active modules are imported dynamically so create + list cases
 * still execute against the current dialog-only UI.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import type { Newsletter } from "@newsletter/shared";
import { NewsletterFormDialog } from "@/components/newsletters/newsletter-form-dialog";
import { NewslettersTable } from "@/components/newsletters/newsletters-table";

const mockPush = vi.fn();

const mocks = vi.hoisted(() => ({
  createNewsletterAction: vi.fn(async () => ({
    ok: true as const,
    newsletterId: "nl-created",
  })),
  updateNewsletterAction: vi.fn(async () => ({ ok: true as const })),
  deleteNewsletterAction: vi.fn(async () => ({ ok: true as const })),
  startNewsletterRun: vi.fn(async () => ({ ok: true as const, runId: "run-1" })),
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

vi.mock("@/app/(protected)/newsletters/actions", () => ({
  createNewsletterAction: mocks.createNewsletterAction,
  updateNewsletterAction: mocks.updateNewsletterAction,
  deleteNewsletterAction: mocks.deleteNewsletterAction,
  startNewsletterRun: mocks.startNewsletterRun,
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
  scheduleEnabled: true,
  scheduleCron: "0 9 * * 1-5",
  scheduleTimezone: "America/New_York",
  scheduleLastFiredAt: null,
  recipientEmails: ["alice@example.com"],
  autoEmail: false,
  autoRss: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const emptyFeeds = { attached: [], eligible: [] };

async function loadEditForm() {
  const path = "@/components/newsletters/newsletter-edit-form";
  const mod = (await import(/* @vite-ignore */ path)) as {
    NewsletterEditForm: ComponentType<{
      newsletter: Newsletter;
      feeds: { attached: unknown[]; eligible: unknown[] };
      appPublicUrl?: string | null;
    }>;
  };
  return mod.NewsletterEditForm;
}

async function renderEditForm(newsletter: Newsletter = NEWSLETTER) {
  const NewsletterEditForm = await loadEditForm();
  return render(
    <NewsletterEditForm
      newsletter={newsletter}
      feeds={emptyFeeds}
      appPublicUrl="https://example.com"
    />,
  );
}

beforeEach(() => {
  mockPush.mockReset();
});

afterEach(() => {
  cleanup();
  mocks.createNewsletterAction.mockReset();
  mocks.createNewsletterAction.mockResolvedValue({
    ok: true as const,
    newsletterId: "nl-created",
  });
  mocks.updateNewsletterAction.mockReset();
  mocks.updateNewsletterAction.mockResolvedValue({ ok: true as const });
  mocks.deleteNewsletterAction.mockReset();
  mocks.startNewsletterRun.mockReset();
  mocks.computeNextFireAt.mockClear();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("NewsletterEditForm — tabs", () => {
  it("renders five tab triggers; default selected is Basics", async () => {
    await renderEditForm();

    const tabs = ["Basics", "Advanced", "Schedule", "Delivery", "Feeds"] as const;
    for (const label of tabs) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }

    expect(screen.getByRole("tab", { name: "Basics" })).toHaveAttribute("data-state", "active");
    for (const label of tabs.slice(1)) {
      expect(screen.getByRole("tab", { name: label })).not.toHaveAttribute(
        "data-state",
        "active",
      );
    }
  });

  it("switching tabs shows that panel’s landmark content", async () => {
    await renderEditForm();

    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByRole("heading", { name: "Model overrides" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.getByLabelText("Enable schedule")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Delivery" }));
    expect(screen.getByLabelText("Recipients")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Feeds" }));
    expect(screen.getByRole("region", { name: "Feeds" })).toBeInTheDocument();
  });

  it("cross-tab Save includes Basics name and schedule fields while Schedule tab is active", async () => {
    await renderEditForm();

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Renamed Digest" } });

    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute("data-state", "active");

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(mocks.updateNewsletterAction).toHaveBeenCalled();
    });

    const formData = (mocks.updateNewsletterAction.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(formData.get("name")).toBe("Renamed Digest");
    expect(formData.get("scheduleTimezone")).toBe("America/New_York");
    expect(formData.get("scheduleCron")).toBe("0 9 * * 1-5");
  });

  it("Cancel navigates to /newsletters without saving", async () => {
    await renderEditForm();

    const cancel = screen.getByRole("link", { name: /^Cancel$/i });
    expect(cancel).toHaveAttribute("href", "/newsletters");

    expect(mocks.updateNewsletterAction).not.toHaveBeenCalled();
  });
});

describe("NewsletterFormDialog — create Basics-only + redirect", () => {
  it("create dialog has no model overrides, Schedule, Delivery, or Feeds", () => {
    render(<NewsletterFormDialog open onOpenChange={() => {}} />);

    expect(screen.queryByText("Model overrides")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tagger")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Schedule" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Delivery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Feeds" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Enable schedule")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Recipients")).not.toBeInTheDocument();
  });

  it("on successful create with newsletterId, router.push goes to /newsletters/<id>", async () => {
    mocks.createNewsletterAction.mockResolvedValue({
      ok: true as const,
      newsletterId: "nl-created",
    });

    render(<NewsletterFormDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: /Add newsletter/i }));

    await waitFor(() => {
      expect(mocks.createNewsletterAction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/newsletters/nl-created");
    });
  });
});

describe("NewslettersTable — Edit links to page", () => {
  it("Edit control is a link to /newsletters/<id> with no edit-mode NewsletterFormDialog", () => {
    render(
      <NewslettersTable
        newsletters={[NEWSLETTER]}
        feedContextByNewsletter={{ [NEWSLETTER.$id]: emptyFeeds }}
        activeRunByNewsletterId={{}}
      />,
    );

    const tableSlot = document.querySelector('[data-slot="domain-list-table"]') as HTMLElement;
    expect(tableSlot).toBeTruthy();
    const edit = within(tableSlot).getByRole("link", { name: `Edit ${NEWSLETTER.name}` });
    expect(edit).toHaveAttribute("href", `/newsletters/${NEWSLETTER.$id}`);

    expect(screen.queryByRole("heading", { name: "Edit newsletter" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("newsletter-form-dialog-content")).not.toBeInTheDocument();
  });
});

describe("isNavItemActive — Newsletters nested routes", () => {
  it("marks Newsletters active for /newsletters and /newsletters/nl-1", async () => {
    const navPath = "@/lib/nav-active";
    const { isNavItemActive } = await import(/* @vite-ignore */ navPath);

    expect(isNavItemActive("/newsletters", "/newsletters")).toBe(true);
    expect(isNavItemActive("/newsletters/nl-1", "/newsletters")).toBe(true);
    expect(isNavItemActive("/feeds", "/newsletters")).toBe(false);
    expect(isNavItemActive("/newsletter", "/newsletters")).toBe(false);
  });
});
