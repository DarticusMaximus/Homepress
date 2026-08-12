import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarClock,
  History,
  LayoutDashboard,
  Newspaper,
  Rss,
  ScrollText,
  Send,
  Settings,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export const navItems: readonly NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Feeds", href: "/feeds", icon: Rss },
  { title: "Newsletters", href: "/newsletters", icon: Newspaper },
  { title: "Issues", href: "/issues", icon: BookOpen },
  { title: "Runs", href: "/runs", icon: History },
  { title: "Schedules", href: "/schedules", icon: CalendarClock },
  { title: "Prompts", href: "/prompts", icon: ScrollText },
  { title: "Delivery", href: "/delivery", icon: Send },
  { title: "Settings", href: "/settings", icon: Settings },
] as const;
