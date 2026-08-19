import { DomainListPagination } from "@/components/domain-list";

type NewslettersPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
};

export function buildNewslettersHref(page: number): string {
  return page === 1 ? "/admin/newsletters" : `/admin/newsletters?page=${page}`;
}

export function NewslettersPagination({ page, totalPages, total }: NewslettersPaginationProps) {
  return (
    <DomainListPagination
      ariaLabel="Newsletters pagination"
      page={page}
      totalPages={totalPages}
      total={total}
      noun="newsletters"
      buildPageHref={buildNewslettersHref}
    />
  );
}
