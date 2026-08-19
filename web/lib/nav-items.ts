import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarClock,
  History,
  House,
  MessageSquareText,
  Newspaper,
  PenLine,
  Rss,
  Send,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const navItems: readonly NavItem[] = [
  { title: "Home", href: "/", icon: House },
  { title: "Newsletters", href: "/newsletters", icon: Newspaper },
  { title: "Admin", href: "/admin", icon: Settings },
] as const;

/** Factory destinations for Admin chrome. */
export const factoryNavItems: readonly NavItem[] = [
  { title: "Feeds", href: "/admin/feeds", icon: Rss },
  { title: "Newsletters", href: "/admin/newsletters", icon: PenLine },
  { title: "Issues", href: "/admin/issues", icon: BookOpen },
  { title: "Runs", href: "/admin/runs", icon: History },
  { title: "Schedules", href: "/admin/schedules", icon: CalendarClock },
  { title: "Prompts", href: "/admin/prompts", icon: MessageSquareText },
  { title: "Delivery", href: "/admin/delivery", icon: Send },
  { title: "Settings", href: "/admin/settings", icon: SlidersHorizontal },
] as const;
