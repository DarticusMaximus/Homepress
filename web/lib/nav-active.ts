/**
 * Whether a sidebar/nav item should appear active for the current pathname.
 * Exact match, or a nested route under the href (e.g. `/admin/feeds` for `/admin`).
 * `/` is exact-only. Does not treat a prefix sibling as nested (`/newsletter` ≠ `/newsletters`).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  return pathname.startsWith(`${href}/`);
}

/** Whether chrome should show factory destinations. */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
