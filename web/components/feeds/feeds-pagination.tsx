import { DomainListPagination } from "@/components/domain-list";
import { buildFeedsHref } from "@/components/feeds/feeds-url";

type FeedsPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  health?: string;
};

export function FeedsPagination({ page, totalPages, total, health }: FeedsPaginationProps) {
  return (
    <DomainListPagination
      ariaLabel="Feeds pagination"
      page={page}
      totalPages={totalPages}
      total={total}
      noun="feeds"
      buildPageHref={(p) => buildFeedsHref({ health, page: p })}
    />
  );
}
