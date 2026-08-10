import type { DeliveryOutcomeFilter } from "@newsletter/shared";

import { DomainListPagination } from "@/components/domain-list";
import { buildDeliveryHref } from "@/components/delivery/delivery-url";

type DeliveryPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  newsletterId?: string;
  outcome?: DeliveryOutcomeFilter;
};

export function DeliveryPagination({
  page,
  totalPages,
  total,
  newsletterId,
  outcome,
}: DeliveryPaginationProps) {
  return (
    <DomainListPagination
      ariaLabel="Delivery pagination"
      page={page}
      totalPages={totalPages}
      total={total}
      noun="issues"
      buildPageHref={(p) => buildDeliveryHref({ page: p, newsletterId, outcome })}
    />
  );
}
