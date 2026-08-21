/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Newsletter } from "@newsletter/shared";
import { PROMPT_PLACEHOLDERS } from "@newsletter/shared/client";
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

const OVERRIDE_BODY =
  "Custom drafter {newsletter_name} {topics} {audience} {articles_json} {count}";

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
  titleDekModel: "",
  drafterPrompt: OVERRIDE_BODY,
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

const emptyFeeds = { attached: [], eligible: [] };

function renderEditForm(newsletter: Newsletter = NEWSLETTER) {
  return render(
    <NewsletterEditForm newsletter={newsletter} feeds={emptyFeeds} appPublicUrl="https://example.com" />,
  );
}

function openAdvancedTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
}

function getDrafterPromptTextarea() {
  return document.querySelector('textarea[name="drafterPrompt"]') as HTMLTextAreaElement | null;
}

afterEach(() => {
  cleanup();
  mocks.createNewsletterAction.mockReset();
  mocks.updateNewsletterAction.mockReset();
  mocks.attachFeedToNewsletter.mockReset();
  mocks.detachFeedFromNewsletter.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe("NewsletterEditForm — Drafter prompt", () => {
  it("Advanced tab renders Drafter prompt heading and textarea prefilled from newsletter", () => {
    renderEditForm();
    openAdvancedTab();

    expect(screen.getByRole("heading", { name: "Drafter prompt" })).toBeInTheDocument();
    const textarea = getDrafterPromptTextarea();
    expect(textarea).not.toBeNull();
    expect(textarea).toHaveAttribute("name", "drafterPrompt");
    expect(textarea).toHaveValue(OVERRIDE_BODY);
  });

  it("shows drafter placeholder badges including {audience}", () => {
    renderEditForm();
    openAdvancedTab();

    for (const name of PROMPT_PLACEHOLDERS.drafter) {
      expect(screen.getByText(`{${name}}`)).toBeInTheDocument();
    }
    expect(screen.getByText("{audience}")).toBeInTheDocument();
  });

  it("helper copy mentions global Drafter template and placeholders", () => {
    renderEditForm();
    openAdvancedTab();

    expect(
      screen.getByText(
        /Leave blank to use the global Drafter template on Prompts\. Placeholders:.*\{audience\}/i,
      ),
    ).toBeInTheDocument();
  });

  it("forceMount: Save from Basics tab still submits drafterPrompt value", async () => {
    renderEditForm();
    // Stay on Basics (default) — Advanced is inactive but force-mounted.
    expect(screen.getByRole("tab", { name: "Basics" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Advanced" })).not.toHaveAttribute(
      "data-state",
      "active",
    );

    const textarea = getDrafterPromptTextarea();
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, {
      target: {
        value: "Updated override {newsletter_name} {topics} {articles_json} {count}",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      expect(mocks.updateNewsletterAction).toHaveBeenCalled();
    });

    const formData = (mocks.updateNewsletterAction.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(formData.get("drafterPrompt")).toBe(
      "Updated override {newsletter_name} {topics} {articles_json} {count}",
    );
  });
});

describe("NewsletterFormDialog — Drafter prompt (create)", () => {
  it("create mode has no Drafter prompt field", () => {
    render(<NewsletterFormDialog open onOpenChange={() => {}} />);

    expect(screen.queryByRole("heading", { name: "Drafter prompt" })).not.toBeInTheDocument();
    expect(getDrafterPromptTextarea()).toBeNull();
  });
});
