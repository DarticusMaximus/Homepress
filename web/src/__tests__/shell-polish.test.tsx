/// <reference types="@testing-library/jest-dom" />

import { existsSync } from "node:fs";
import path from "node:path";
import type { HTMLAttributes, ReactNode } from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import { AppSidebar } from "@/components/app-sidebar";
import {
  INSPECT_PIPELINE_LABEL,
  IssueReader,
  IssueReaderLoadErrorBare,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";
import { quietNavLinkClassName } from "@/components/quiet-nav-link";
import {
  InspectShell,
  InspectShellLoadError,
  InspectShellNotAvailable,
} from "@/components/runs/inspect-shell";
import { navItems } from "@/lib/nav-items";

const setOpenMobile = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    onClick,
  }: {
    children?: ReactNode;
    href: string;
    className?: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/components/LogoutButton", () => ({
  default: () => <button type="button">Log out</button>,
}));

vi.mock("@/components/ui/sidebar", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    useSidebar: () => ({
      isMobile: true,
      setOpenMobile,
      state: "expanded",
      open: true,
      setOpen: vi.fn(),
      openMobile: true,
      toggleSidebar: vi.fn(),
    }),
    Sidebar: Passthrough,
    SidebarContent: Passthrough,
    SidebarFooter: Passthrough,
    SidebarHeader: Passthrough,
    SidebarMenu: Passthrough,
    SidebarMenuItem: Passthrough,
    SidebarMenuButton: ({
      children,
      isActive,
    }: {
      children?: ReactNode;
      isActive?: boolean;
      asChild?: boolean;
      tooltip?: string;
    }) => <div data-active={isActive ? "true" : "false"}>{children}</div>,
    SidebarGroup: ({
      children,
      ...props
    }: { children?: ReactNode } & HTMLAttributes<HTMLElement>) => (
      <div {...props}>{children}</div>
    ),
    SidebarGroupLabel: ({
      children,
      ...props
    }: { children?: ReactNode } & HTMLAttributes<HTMLElement>) => (
      <div {...props}>{children}</div>
    ),
  };
});

beforeEach(() => {
  setOpenMobile.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("AppSidebar mobile close-on-nav", () => {
  it("calls setOpenMobile(false) when a nav link is clicked while mobile", () => {
    render(<AppSidebar userEmail="ops@example.com" />);

    const newsletters = navItems.find((item) => item.href === "/newsletters");
    expect(newsletters).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: newsletters!.title }));
    expect(setOpenMobile).toHaveBeenCalledWith(false);
  });

  it("closes on Home (/) nav click too", () => {
    render(<AppSidebar userEmail="ops@example.com" />);

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(setOpenMobile).toHaveBeenCalledWith(false);
  });
});

function expectHitTarget(link: HTMLElement) {
  expect(link.className).toContain("min-h-11");
  expect(link.className).toContain("px-3");
  // Shared class documents the ≥44px pin for Issue + Inspect.
  expect(quietNavLinkClassName).toContain("min-h-11");
  expect(quietNavLinkClassName).toContain("px-3");
}

const missingPhase = { status: "missing" as const };

function makeRun(overrides: Partial<Run> = {}): Run {
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
    startedAt: "2026-03-15T14:30:00.000Z",
    endedAt: "2026-03-15T14:35:00.000Z",
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "draft-1",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    ...overrides,
  };
}

describe("design-system removal", () => {
  it("has no design-system page module and keeps three reader nav items", () => {
    const pagePath = path.resolve(
      __dirname,
      "../../app/(protected)/design-system/page.tsx",
    );
    expect(existsSync(pagePath)).toBe(false);
    expect(navItems).toHaveLength(3);
  });
});

describe("Back / Inspect hit targets", () => {
  it("Back to Home meets ≥44px min height on reader success chrome", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." />);

    expectHitTarget(screen.getByRole("link", { name: "Back to Home" }));
  });

  it("Back to Issues and Inspect pipeline meet ≥44px min height on factory success chrome", () => {
    const run = makeRun();
    render(<IssueReader run={run} runId={run.$id} markdown="## Hello\n\nBody." showOps />);

    expectHitTarget(screen.getByRole("link", { name: "Back to Issues" }));
    expectHitTarget(screen.getByRole("link", { name: INSPECT_PIPELINE_LABEL }));
  });

  it("Back to Home meets hit target on not-available and bare load-error", () => {
    const { unmount } = render(<IssueReaderNotAvailable />);
    expectHitTarget(screen.getByRole("link", { name: "Back to Home" }));
    unmount();
    cleanup();

    render(<IssueReaderLoadErrorBare />);
    expectHitTarget(screen.getByRole("link", { name: "Back to Home" }));
  });

  it("Back to Runs meets ≥44px min height on all Inspect shell paths", () => {
    const run = makeRun();

    const { unmount: unmountOk } = render(
      <InspectShell
        run={run}
        fetchResult={missingPhase}
        scrapeResult={missingPhase}
        tagResult={missingPhase}
        scoreResult={missingPhase}
        selectionResult={missingPhase}
        draftResult={missingPhase}
        suppressSummary={{ count: 0, items: [] }}
        runLookup={{}}
      />,
    );
    expectHitTarget(screen.getByRole("link", { name: "Back to Runs" }));
    unmountOk();
    cleanup();

    const { unmount: unmountMissing } = render(<InspectShellNotAvailable />);
    expectHitTarget(screen.getByRole("link", { name: "Back to Runs" }));
    unmountMissing();
    cleanup();

    render(<InspectShellLoadError />);
    expectHitTarget(screen.getByRole("link", { name: "Back to Runs" }));
  });
});
