/**
 * Reader Newsletters (`/newsletters`) href with a `page` param (only emitted
 * when > 1, since page 1 is the default). Used by the page-clamp redirect and
 * channel-index pagination. Do not use `buildNewslettersHref` (Admin) here.
 */
export function buildReaderNewslettersHref(opts: { page?: number }): string {
  if (opts.page && opts.page > 1) {
    return `/newsletters?page=${opts.page}`;
  }
  return "/newsletters";
}

/**
 * Reader channel (`/newsletters/{id}`) href with a `page` param (only emitted
 * when > 1). Used by the channel-page clamp redirect and pagination.
 */
export function buildChannelHref(id: string, opts: { page?: number } = {}): string {
  if (opts.page && opts.page > 1) {
    return `/newsletters/${id}?page=${opts.page}`;
  }
  return `/newsletters/${id}`;
}
