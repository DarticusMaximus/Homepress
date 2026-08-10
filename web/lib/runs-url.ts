/**
 * Build a `/runs` href preserving newsletter + status filters and a `page`
 * param (only emitted when > 1). Used by filters, pagination, and dashboard
 * attention deep links.
 */
export function buildRunsHref(params: {
  page?: number;
  newsletterId?: string;
  status?: string;
}): string {
  const query = new URLSearchParams();
  if (params.page && params.page > 1) {
    query.set("page", String(params.page));
  }
  if (params.newsletterId) {
    query.set("newsletterId", params.newsletterId);
  }
  if (params.status) {
    query.set("status", params.status);
  }
  const qs = query.toString();
  return qs ? `/runs?${qs}` : "/runs";
}
