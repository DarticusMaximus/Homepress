"use client";

import { DomainListPagination } from "@/components/domain-list";
import { buildRunsHref } from "@/lib/runs-url";

type RunsPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  newsletterId?: string;
  status?: string;
};

export function RunsPagination({
  page,
  totalPages,
  total,
  newsletterId,
  status,
}: RunsPaginationProps) {
  return (
    <DomainListPagination
      ariaLabel="Runs pagination"
      page={page}
      totalPages={totalPages}
      total={total}
      noun="runs"
      buildPageHref={(p) => buildRunsHref({ page: p, newsletterId, status })}
    />
  );
}
