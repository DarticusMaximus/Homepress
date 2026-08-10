/**
 * Whether a sidebar/nav item should appear active for the current pathname.
 * Exact match, or a nested route under the href (e.g. `/newsletters/nl-1` for `/newsletters`).
 * Does not treat a prefix sibling as nested (`/newsletter` ≠ `/newsletters`).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  return pathname.startsWith(`${href}/`);
}
