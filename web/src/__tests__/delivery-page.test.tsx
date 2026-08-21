/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { formatIssueFallbackTitle, type Newsletter, type Run } from "@newsletter/shared";
import { DeliveryView } from "@/components/delivery/delivery-view";
import { DeliveryTable } from "@/components/delivery/delivery-table";
import { DeliveryPagination } from "@/components/delivery/delivery-pagination";
import { buildDeliveryHref } from "@/components/delivery/delivery-url";

const DELIVERY_PAGE = path.resolve(
  __dirname,
  "../../app/(protected)/admin/delivery/page.tsx",
);

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

/** Native select stand-in — Radix Select needs scrollIntoView in jsdom. */
vi.mock("@/components/ui/select", () => {
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) {
    return (
      <select
        data-testid="mock-select"
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {children}
      </select>
    );
  }
  function SelectTrigger({
    id,
    children,
  }: {
    id?: string;
    children?: ReactNode;
    className?: string;
  }) {
    return <span id={id}>{children}</span>;
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

afterEach(() => {
  cleanup();
  mockPush.mockReset();
});

const STARTED_AT = "2026-03-15T14:30:00.000Z";
const ENDED_AT = "2026-03-15T14:35:00.000Z";

function makeIssue(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Weekly Tech",
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "draft-1",
    emailDeliveryStatus: "sent",
    emailDeliveryAt: ENDED_AT,
    emailDeliveryError: "",
    rssDeliveryStatus: "published",
    rssDeliveryAt: ENDED_AT,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    ...overrides,
  };
}

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    $id: "nl-1",
    name: "Weekly Tech",
    topics: [],
    dislikedTopics: [],
    audience: "",
    newsItems: 5,
    dateRange: "yesterday",
    lookback: 0,
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    titleDekModel: "",
    drafterPrompt: "",
    scheduleEnabled: false,
    scheduleCron: "",
    scheduleTimezone: "UTC",
    scheduleLastFiredAt: null,
    recipientEmails: [],
    autoEmail: false,
    autoRss: false,
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
    ...overrides,
  };
}

function formatIssueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
}

function getSlot(name: "domain-list-table" | "domain-list-cards"): HTMLElement {
  const el = document.querySelector(`[data-slot="${name}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

describe("buildDeliveryHref", () => {
  it("omits query string for defaults", () => {
    expect(buildDeliveryHref({})).toBe("/admin/delivery");
    expect(buildDeliveryHref({ page: 1 })).toBe("/admin/delivery");
    expect(buildDeliveryHref({ outcome: "all" })).toBe("/admin/delivery");
  });

  it("emits newsletter, outcome, and page params", () => {
    expect(buildDeliveryHref({ newsletterId: "nl-1" })).toBe(
      "/admin/delivery?newsletterId=nl-1",
    );
    expect(buildDeliveryHref({ outcome: "any_failure" })).toBe(
      "/admin/delivery?outcome=any_failure",
    );
    expect(buildDeliveryHref({ page: 2 })).toBe("/admin/delivery?page=2");
    expect(
      buildDeliveryHref({
        newsletterId: "nl-1",
        outcome: "email_failed",
        page: 3,
      }),
    ).toBe("/admin/delivery?newsletterId=nl-1&outcome=email_failed&page=3");
  });
});

describe("Delivery empty state (case 14)", () => {
  it("shows empty-state copy, not under construction", () => {
    render(
      <DeliveryView
        issues={[]}
        newsletters={[makeNewsletter()]}
        currentNewsletterId=""
        currentOutcome="all"
        total={0}
        page={1}
        totalPages={1}
        loadError={null}
        list={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Delivery" })).toBeInTheDocument();
    expect(screen.queryByText(/under construction/i)).toBeNull();
    expect(
      screen.getByText(/appear after you Send, Publish, or auto-deliver/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Use Issues to/i)).toBeInTheDocument();
  });
});

describe("Delivery row (case 15)", () => {
  it("renders badges, failure text, and Open href to /admin/issues/{id}", () => {
    const issue = makeIssue({
      $id: "issue-fail",
      emailDeliveryStatus: "failed",
      emailDeliveryError: "SMTP connection refused",
      rssDeliveryStatus: "failed",
      rssDeliveryError: "Storage write failed",
    });
    const dateIso = issue.endedAt ?? issue.startedAt;
    const title = formatIssueFallbackTitle(issue.newsletterName, dateIso);

    render(<DeliveryTable issues={[issue]} />);

    const tableSlot = getSlot("domain-list-table");
    const table = within(tableSlot);

    expect(table.getByText(title)).toBeInTheDocument();
    expect(table.getAllByText("Failed")).toHaveLength(2);
    expect(
      table.getByText("Email: SMTP connection refused · RSS: Storage write failed"),
    ).toBeInTheDocument();

    const open = table.getByRole("link", { name: "Open" });
    expect(open).toHaveAttribute("href", "/admin/issues/issue-fail");
  });

  it("shows — for success-only failure column", () => {
    const issue = makeIssue({
      emailDeliveryStatus: "sent",
      rssDeliveryStatus: "published",
    });
    render(<DeliveryTable issues={[issue]} />);
    const table = within(getSlot("domain-list-table"));
    expect(table.getByText("Sent")).toBeInTheDocument();
    expect(table.getByText("Published")).toBeInTheDocument();
    // Failure column uses muted — when neither channel failed (plus none-status badges).
    expect(table.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});

describe("Delivery filters (case 16)", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("changing newsletter updates URL search params via router.push", () => {
    render(
      <DeliveryView
        issues={[makeIssue()]}
        newsletters={[makeNewsletter({ $id: "nl-1", name: "Weekly Tech" })]}
        currentNewsletterId=""
        currentOutcome="all"
        total={1}
        page={1}
        totalPages={1}
        loadError={null}
        list={<DeliveryTable issues={[makeIssue()]} />}
      />,
    );

    const selects = screen.getAllByTestId("mock-select");
    fireEvent.change(selects[0]!, { target: { value: "nl-1" } });

    expect(mockPush).toHaveBeenCalledWith("/admin/delivery?newsletterId=nl-1");
  });

  it("changing outcome updates URL search params via router.push", () => {
    render(
      <DeliveryView
        issues={[makeIssue()]}
        newsletters={[makeNewsletter()]}
        currentNewsletterId="nl-1"
        currentOutcome="all"
        total={1}
        page={1}
        totalPages={1}
        loadError={null}
        list={<DeliveryTable issues={[makeIssue()]} />}
      />,
    );

    const selects = screen.getAllByTestId("mock-select");
    fireEvent.change(selects[1]!, { target: { value: "any_failure" } });

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/delivery?newsletterId=nl-1&outcome=any_failure",
    );
  });

  it("pagination preserves newsletter and outcome filters", () => {
    const { container } = render(
      <DeliveryPagination
        page={2}
        totalPages={3}
        total={60}
        newsletterId="nl-1"
        outcome="rss_failed"
      />,
    );
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a.getAttribute("href")).toContain("newsletterId=nl-1");
      expect(a.getAttribute("href")).toContain("outcome=rss_failed");
    }
    const next = links.find((a) => /Next/.test(a.textContent ?? ""));
    expect(next?.getAttribute("href")).toBe(
      "/admin/delivery?newsletterId=nl-1&outcome=rss_failed&page=3",
    );
  });
});

describe("Delivery dual presentation (case 18)", () => {
  it("renders table and cards with field and Open href parity", () => {
    const fixtures: Run[] = [
      makeIssue({
        $id: "issue-alpha",
        newsletterName: "Weekly Tech",
        emailDeliveryStatus: "sent",
        rssDeliveryStatus: "none",
      }),
      makeIssue({
        $id: "issue-beta",
        newsletterName: "Daily News",
        newsletterId: "nl-2",
        endedAt: "2026-04-01T09:02:00.000Z",
        startedAt: "2026-04-01T09:00:00.000Z",
        emailDeliveryStatus: "failed",
        emailDeliveryError: "No recipients",
        rssDeliveryStatus: "published",
        checkpointDraftId: "draft-2",
      }),
    ];

    render(<DeliveryTable issues={fixtures} />);

    const tableSlot = getSlot("domain-list-table");
    const cardsSlot = getSlot("domain-list-cards");
    const table = within(tableSlot);
    const cards = within(cardsSlot);

    for (const issue of fixtures) {
      const dateIso = issue.endedAt ?? issue.startedAt;
      const title = formatIssueFallbackTitle(issue.newsletterName, dateIso);
      const dateLabel = formatIssueDate(dateIso);
      const href = `/admin/issues/${issue.$id}`;

      expect(table.getByText(title)).toBeInTheDocument();
      expect(cards.getByText(title)).toBeInTheDocument();

      expect(table.getByText(issue.newsletterName)).toBeInTheDocument();
      expect(cards.getByText(issue.newsletterName)).toBeInTheDocument();

      expect(table.getByText(dateLabel)).toBeInTheDocument();
      expect(cards.getByText(dateLabel)).toBeInTheDocument();

      expect(
        table.getAllByRole("link", { name: "Open" }).some((a) => a.getAttribute("href") === href),
      ).toBe(true);
      expect(
        cards.getAllByRole("link", { name: "Open" }).some((a) => a.getAttribute("href") === href),
      ).toBe(true);
    }

    expect(table.getByText("Sent")).toBeInTheDocument();
    expect(cards.getByText("Sent")).toBeInTheDocument();
    expect(table.getByText("Published")).toBeInTheDocument();
    expect(cards.getByText("Published")).toBeInTheDocument();
    expect(table.getByText("No recipients")).toBeInTheDocument();
    expect(cards.getByText("No recipients")).toBeInTheDocument();

    expect(table.getAllByRole("link", { name: "Open" })).toHaveLength(fixtures.length);
    expect(cards.getAllByRole("link", { name: "Open" })).toHaveLength(fixtures.length);
  });
});

describe("admin delivery page (source-read)", () => {
  it("still calls resolveIssueDisplayTitlesForRuns without a local extract path", () => {
    expect(existsSync(DELIVERY_PAGE)).toBe(true);
    const source = readFileSync(DELIVERY_PAGE, "utf8");

    expect(source).toContain("resolveIssueDisplayTitlesForRuns");
    expect(source).not.toContain("extractFirstMarkdownHeading");
    expect(source).not.toContain("extractIssueDek");
    expect(source).not.toContain("resolveIssueCardMetaForRuns");
    expect(source).not.toContain("storedIssueTitle");
    expect(source).not.toContain("storedIssueDek");
  });
});
