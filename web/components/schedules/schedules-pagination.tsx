import { DomainListPagination } from "@/components/domain-list";

type SchedulesPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
};

function buildSchedulesHref(page: number): string {
  return page === 1 ? "/admin/schedules" : `/admin/schedules?page=${page}`;
}

export function SchedulesPagination({ page, totalPages, total }: SchedulesPaginationProps) {
  return (
    <DomainListPagination
      ariaLabel="Schedules pagination"
      page={page}
      totalPages={totalPages}
      total={total}
      noun="newsletters"
      buildPageHref={buildSchedulesHref}
    />
  );
}
