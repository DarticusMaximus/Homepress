/**
 * Build a Home (`/`) href with a `page` param (only emitted when > 1, since
 * page 1 is the default). Used by the page-clamp redirect and Home pagination.
 */
export function buildHomeHref(opts: { page?: number }): string {
  if (opts.page && opts.page > 1) {
    return `/?page=${opts.page}`;
  }
  return "/";
}
