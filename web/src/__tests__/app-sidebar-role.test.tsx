/// <reference types="@testing-library/jest-dom" />

import { readFileSync } from "node:fs";
import path from "node:path";
import type { HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppSidebar } from "@/components/app-sidebar";
import { readerNavItems } from "@/lib/nav-items";

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
      setOpenMobile: vi.fn(),
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

const WEB_ROOT = path.resolve(__dirname, "../..");
const PROTECTED_APP = path.resolve(__dirname, "../../app/(protected)");

beforeEach(() => {
  pathnameState.value = "/";
});

afterEach(() => {
  cleanup();
});

describe("readerNavItems", () => {
  it("is Home + Newsletters only", () => {
    expect(readerNavItems.map((item) => item.title)).toEqual(["Home", "Newsletters"]);
    expect(readerNavItems.map((item) => item.href)).toEqual(["/", "/newsletters"]);
  });
});

describe("AppSidebar role-conditional nav", () => {
  it("hides Admin and Factory when isOperator is false", () => {
    pathnameState.value = "/";
    render(<AppSidebar userEmail="reader@example.com" isOperator={false} />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Newsletters" })).toHaveAttribute(
      "href",
      "/newsletters",
    );
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Factory" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin"]')).toBeNull();
    expect(document.querySelector('a[href="/admin/feeds"]')).toBeNull();
  });

  it("hides Admin and Factory for readers even on an Admin path", () => {
    pathnameState.value = "/admin";
    render(<AppSidebar userEmail="reader@example.com" isOperator={false} />);

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Factory" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/feeds"]')).toBeNull();
  });

  it("shows the Admin link for operators and keeps Factory off reader paths", () => {
    pathnameState.value = "/";
    render(<AppSidebar userEmail="ops@example.com" isOperator={true} />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Newsletters" })).toHaveAttribute(
      "href",
      "/newsletters",
    );
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("group", { name: "Factory" })).not.toBeInTheDocument();
  });

  it("shows the Factory group for operators on Admin paths", () => {
    pathnameState.value = "/admin";
    render(<AppSidebar userEmail="ops@example.com" isOperator={true} />);

    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("group", { name: "Factory" })).toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/feeds"]')).not.toBeNull();
  });
});

describe("protected layout role wiring (source-read)", () => {
  it("computes isOperator(user) and passes it to AppSidebar", () => {
    const layoutSource = readFileSync(path.join(PROTECTED_APP, "layout.tsx"), "utf8");
    expect(layoutSource).toMatch(/isOperator\(user\)/);
    expect(layoutSource).toMatch(/<AppSidebar\b[\s\S]*isOperator=/);

    const sidebarSource = readFileSync(path.join(WEB_ROOT, "components/app-sidebar.tsx"), "utf8");
    expect(sidebarSource).toMatch(/isOperator:\s*boolean/);
  });
});
