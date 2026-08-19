import type { DeliveryOutcomeFilter } from "@newsletter/shared";

/**
 * Build an `/admin/delivery` href preserving newsletter + outcome filters and a
 * `page` param (only emitted when > 1). Used by page-clamp redirect, filters, and pagination.
 */
export function buildDeliveryHref(opts: {
  page?: number;
  newsletterId?: string;
  outcome?: DeliveryOutcomeFilter | "";
}): string {
  const params = new URLSearchParams();
  if (opts.newsletterId) {
    params.set("newsletterId", opts.newsletterId);
  }
  if (opts.outcome && opts.outcome !== "all") {
    params.set("outcome", opts.outcome);
  }
  if (opts.page && opts.page > 1) {
    params.set("page", String(opts.page));
  }
  const qs = params.toString();
  return qs ? `/admin/delivery?${qs}` : "/admin/delivery";
}
