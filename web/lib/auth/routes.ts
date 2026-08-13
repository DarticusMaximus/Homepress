export const PUBLIC_ROUTES = ["/login", "/health", "/build-id"] as const;

export function isPublicRoute(pathname: string): boolean {
  let normalized = pathname;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if ((PUBLIC_ROUTES as readonly string[]).includes(normalized)) {
    return true;
  }
  // Public RSS feed handler (rewrite target without .xml; matcher already skips *.xml)
  return normalized.startsWith("/rss/");
}
