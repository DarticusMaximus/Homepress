export function isHealthFilter(value: string | undefined): value is "unhealthy" {
  return value === "unhealthy";
}

/**
 * Build an `/admin/feeds` href preserving the `health=unhealthy` filter (when set)
 * and a `page` param (only emitted when > 1, since page 1 is the default). Used by
 * both the page-clamp redirect and FeedsPagination Prev/Next links so the
 * dashboard `/admin/feeds?health=unhealthy` deep-link survives pagination.
 */
export function buildFeedsHref(opts: { health?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (isHealthFilter(opts.health)) {
    params.set("health", "unhealthy");
  }
  if (opts.page && opts.page > 1) {
    params.set("page", String(opts.page));
  }
  const qs = params.toString();
  return qs ? `/admin/feeds?${qs}` : "/admin/feeds";
}
