/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AppSidebar } from "@/components/app-sidebar";

const setOpenMobile = vi.fn();

const pathnameState = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    onClick,
    "aria-label": ariaLabel,
  }: {
    children?: ReactNode;
    href: string;
    className?: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
    "aria-label"?: string;
  }) => (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
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

const FACTORY_LINKS = [
  { name: "Feeds", href: "/admin/feeds" },
  { name: "Newsletters (Factory)", href: "/admin/newsletters" },
  { name: "Issues", href: "/admin/issues" },
  { name: "Runs", href: "/admin/runs" },
  { name: "Schedules", href: "/admin/schedules" },
  { name: "Prompts", href: "/admin/prompts" },
  { name: "Delivery", href: "/admin/delivery" },
  { name: "Settings", href: "/admin/settings" },
] as const;

const WEB_ROOT = path.resolve(__dirname, "../..");
const PROTECTED_APP = path.resolve(__dirname, "../../app/(protected)");

beforeEach(() => {
  setOpenMobile.mockClear();
  pathnameState.value = "/";
});

afterEach(() => {
  cleanup();
});

describe("AppSidebar Factory group", () => {
  it.each(["/", "/newsletters", "/newsletters/nl-1", "/issues/run-1"])(
    "hides the Factory group on reader path %s",
    (pathname) => {
      pathnameState.value = pathname;
      render(<AppSidebar userEmail="ops@example.com" />);

      expect(screen.queryByRole("group", { name: "Factory" })).not.toBeInTheDocument();
      expect(document.querySelector('a[href="/admin/feeds"]')).toBeNull();
    },
  );

  it.each(["/admin", "/admin/feeds"])("shows the Factory group on Admin path %s", (pathname) => {
    pathnameState.value = pathname;
    render(<AppSidebar userEmail="ops@example.com" />);

    const group = screen.getByRole("group", { name: "Factory" });
    const links = within(group).getAllByRole("link");
    expect(links.map((el) => el.getAttribute("href"))).toEqual(
      FACTORY_LINKS.map((item) => item.href),
    );
    for (const { name, href } of FACTORY_LINKS) {
      expect(within(group).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("keeps two Newsletters links on /admin/newsletters with distinct hrefs", () => {
    pathnameState.value = "/admin/newsletters";
    render(<AppSidebar userEmail="ops@example.com" />);

    const newsletters = screen.getAllByRole("link", { name: "Newsletters" });
    expect(newsletters).toHaveLength(1);
    expect(newsletters[0]).toHaveAttribute("href", "/newsletters");

    const group = screen.getByRole("group", { name: "Factory" });
    expect(within(group).getByText("Factory")).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: "Newsletters (Factory)" })).toHaveAttribute(
      "href",
      "/admin/newsletters",
    );
    expect(within(group).getByText("Newsletters")).toBeInTheDocument();

    const sidebarSource = readFileSync(path.join(WEB_ROOT, "components/app-sidebar.tsx"), "utf8");
    expect(sidebarSource).toMatch(/<span>\{item\.title\}<\/span>/);
  });

  it("marks Factory Runs active on nested inspect and none of the eight on /admin", () => {
    pathnameState.value = "/admin/runs/r/inspect";
    const { unmount } = render(<AppSidebar userEmail="ops@example.com" />);

    const group = screen.getByRole("group", { name: "Factory" });
    expect(within(group).getByRole("link", { name: "Runs" }).closest("[data-active]")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      within(group).getByRole("link", { name: "Feeds" }).closest("[data-active]"),
    ).toHaveAttribute("data-active", "false");

    unmount();
    cleanup();

    pathnameState.value = "/admin";
    render(<AppSidebar userEmail="ops@example.com" />);

    const hubGroup = screen.getByRole("group", { name: "Factory" });
    for (const { name } of FACTORY_LINKS) {
      expect(
        within(hubGroup).getByRole("link", { name }).closest("[data-active]"),
      ).toHaveAttribute("data-active", "false");
    }
    expect(screen.getByRole("link", { name: "Admin" }).closest("[data-active]")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("closes the mobile sheet when a Factory Feeds link is clicked", () => {
    pathnameState.value = "/admin";
    render(<AppSidebar userEmail="ops@example.com" />);

    const group = screen.getByRole("group", { name: "Factory" });
    fireEvent.click(within(group).getByRole("link", { name: "Feeds" }));
    expect(setOpenMobile).toHaveBeenCalledWith(false);
  });
});

describe("protected layout factory chrome (source-read)", () => {
  it("keeps a single SidebarTrigger, no header factory nav, no admin layout, no Collapsible", () => {
    const layoutPath = path.join(PROTECTED_APP, "layout.tsx");
    const layoutSource = readFileSync(layoutPath, "utf8");
    expect(layoutSource.match(/<SidebarTrigger\b/g)).toHaveLength(1);

    const headerBlock = layoutSource.match(/<header\b[\s\S]*?<\/header>/);
    expect(headerBlock, "expected a closed <header> block").toBeTruthy();
    expect(headerBlock![0]).not.toMatch(/<nav\b/);

    expect(existsSync(path.join(PROTECTED_APP, "admin/layout.tsx"))).toBe(false);

    const sidebarSource = readFileSync(path.join(WEB_ROOT, "components/app-sidebar.tsx"), "utf8");
    expect(sidebarSource).not.toMatch(/\bCollapsible\b/);
  });
});
