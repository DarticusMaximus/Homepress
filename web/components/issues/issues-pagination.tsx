import { DomainListPagination } from "@/components/domain-list";
import { buildIssuesHref } from "@/components/issues/issues-url";

type IssuesPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  newsletterId?: string;
};

export function IssuesPagination({
  page,
  totalPages,
  total,
  newsletterId,
}: IssuesPaginationProps) {
  return (
    <DomainListPagination
      ariaLabel="Issues pagination"
      page={page}
      totalPages={totalPages}
      total={total}
      noun="issues"
      buildPageHref={(p) => buildIssuesHref({ page: p, newsletterId })}
    />
  );
}
