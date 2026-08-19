/**
 * Build an `/admin/issues` href preserving the `newsletterId` filter (when set)
 * and a `page` param (only emitted when > 1, since page 1 is the default). Used by
 * both the page-clamp redirect and IssuesPagination Prev/Next links.
 */
export function buildIssuesHref(opts: { page?: number; newsletterId?: string }): string {
  const params = new URLSearchParams();
  if (opts.newsletterId) {
    params.set("newsletterId", opts.newsletterId);
  }
  if (opts.page && opts.page > 1) {
    params.set("page", String(opts.page));
  }
  const qs = params.toString();
  return qs ? `/admin/issues?${qs}` : "/admin/issues";
}
