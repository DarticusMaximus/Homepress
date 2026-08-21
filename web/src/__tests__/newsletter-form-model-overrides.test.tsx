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
  taggerModel: "provider/tagger-override",
  scorerModel: "provider/scorer-override",
  drafterModel: "provider/drafter-override",
  titleDekModel: "provider/title-dek-override",
  embedderModel: "provider/embedder-override",
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

const emptyFeeds = { attached: [], eligible: [] };

function renderEditForm(newsletter: Newsletter = NEWSLETTER) {
  return render(
    <NewsletterEditForm newsletter={newsletter} feeds={emptyFeeds} appPublicUrl="https://example.com" />,
  );
}

function openAdvancedTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
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

describe("NewsletterEditForm — Model overrides", () => {
  it("Advanced tab renders five inputs with defaultValue from newsletter props", () => {
    renderEditForm();
    openAdvancedTab();

    expect(screen.getByLabelText("Tagger")).toHaveValue(NEWSLETTER.taggerModel);
    expect(screen.getByLabelText("Scorer")).toHaveValue(NEWSLETTER.scorerModel);
    expect(screen.getByLabelText("Drafter")).toHaveValue(NEWSLETTER.drafterModel);
    expect(screen.getByLabelText("Title & dek")).toHaveValue(NEWSLETTER.titleDekModel);
    expect(screen.getByLabelText("Embedder")).toHaveValue(NEWSLETTER.embedderModel);
  });

  it("empty field placeholder is exactly Use global default", () => {
    renderEditForm({
      ...NEWSLETTER,
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
      titleDekModel: "",
      drafterPrompt: "",
    });
    openAdvancedTab();

    for (const label of ["Tagger", "Scorer", "Drafter", "Title & dek", "Embedder"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("placeholder", "Use global default");
    }
  });

  it("helper copy mentions global defaults and next run", () => {
    renderEditForm();
    openAdvancedTab();

    expect(screen.getByText(/global default from the Prompts page/i)).toBeInTheDocument();
    expect(screen.getByText(/next run/i)).toBeInTheDocument();
  });

  it("form includes name attributes for all five model fields", () => {
    renderEditForm();
    openAdvancedTab();

    expect(screen.getByLabelText("Tagger")).toHaveAttribute("name", "taggerModel");
    expect(screen.getByLabelText("Scorer")).toHaveAttribute("name", "scorerModel");
    expect(screen.getByLabelText("Drafter")).toHaveAttribute("name", "drafterModel");
    expect(screen.getByLabelText("Title & dek")).toHaveAttribute("name", "titleDekModel");
    expect(screen.getByLabelText("Embedder")).toHaveAttribute("name", "embedderModel");
  });

  it("Title & dek override is named titleDekModel and sits after Drafter", () => {
    renderEditForm();
    openAdvancedTab();

    const drafter = screen.getByLabelText("Drafter");
    const titleDek = screen.getByLabelText("Title & dek");
    const embedder = screen.getByLabelText("Embedder");

    expect(titleDek).toHaveAttribute("name", "titleDekModel");
    expect(titleDek).toHaveAttribute("placeholder", "Use global default");
    expect(drafter.compareDocumentPosition(titleDek) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(titleDek.compareDocumentPosition(embedder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("NewsletterFormDialog — Model overrides (create)", () => {
  it("create mode has no model override fields", () => {
    renderCreate();

    expect(screen.queryByText("Model overrides")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tagger")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Scorer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Drafter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Title & dek")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Embedder")).not.toBeInTheDocument();
  });
});
