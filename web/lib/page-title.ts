import { APP_NAME } from "@newsletter/shared/client";

/** Longest-prefix first. `/` is exact-only so unknown paths fall back to APP_NAME. */
const TITLE_PREFIXES: readonly { prefix: string; title: string }[] = [
  { prefix: "/admin/feeds", title: "Feeds" },
  { prefix: "/admin/newsletters", title: "Newsletters" },
  { prefix: "/admin/issues", title: "Issues" },
  { prefix: "/admin/runs", title: "Runs" },
  { prefix: "/admin/schedules", title: "Schedules" },
  { prefix: "/admin/prompts", title: "Prompts" },
  { prefix: "/admin/delivery", title: "Delivery" },
  { prefix: "/admin/settings", title: "Settings" },
  { prefix: "/admin", title: "Admin" },
  { prefix: "/newsletters", title: "Newsletters" },
  { prefix: "/issues", title: "Issue" },
  { prefix: "/", title: "Home" },
];

/**
 * Route-map title for the sticky header. Matches the longest listed prefix
 * (`/admin/newsletters` before `/admin`) so factory edit URLs title Newsletters.
 */
export function pageTitleForPath(pathname: string): string {
  const ranked = [...TITLE_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, title } of ranked) {
    if (prefix === "/") {
      if (pathname === "/") return title;
      continue;
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return title;
    }
  }
  return APP_NAME;
}
