import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export type DomainListPaginationProps = {
  ariaLabel: string;
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  buildPageHref: (page: number) => string;
  pageSizeThreshold?: number;
};

export function DomainListPagination({
  ariaLabel,
  page,
  totalPages,
  total,
  noun,
  buildPageHref,
  pageSizeThreshold = 20,
}: DomainListPaginationProps) {
  if (total <= pageSizeThreshold) {
    return null;
  }

  const prevPage = page > 1 ? page - 1 : null;
  const nextPage = page < totalPages ? page + 1 : null;

  return (
    <nav aria-label={ariaLabel} className="mt-4 flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} ({total} {noun})
      </p>
      <div className="flex items-center gap-2">
        {prevPage ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={buildPageHref(prevPage)}>
              <ChevronLeft />
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft />
            Previous
          </Button>
        )}
        {nextPage ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={buildPageHref(nextPage)}>
              Next
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRight />
          </Button>
        )}
      </div>
    </nav>
  );
}
