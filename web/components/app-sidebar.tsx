"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@newsletter/shared/client";
import { isAdminPath, isNavItemActive } from "@/lib/nav-active";
import { factoryNavItems, navItems } from "@/lib/nav-items";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import LogoutButton from "@/components/LogoutButton";

export function AppSidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-lg font-semibold">{APP_NAME}</span>
          <ThemeToggle />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isNavItemActive(pathname, item.href)}
                tooltip={item.title}
              >
                <Link href={item.href} onClick={closeMobileNav}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {isAdminPath(pathname) ? (
          <SidebarGroup role="group" aria-label="Factory">
            <SidebarGroupLabel>Factory</SidebarGroupLabel>
            <SidebarMenu>
              {factoryNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isNavItemActive(pathname, item.href)}
                    tooltip={item.title}
                  >
                    <Link
                      href={item.href}
                      onClick={closeMobileNav}
                      {...(item.href === "/admin/newsletters"
                        ? { "aria-label": "Newsletters (Factory)" }
                        : {})}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="truncate text-sm text-muted-foreground">{userEmail ?? ""}</span>
          <LogoutButton />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
