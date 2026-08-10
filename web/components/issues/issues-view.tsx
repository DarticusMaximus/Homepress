"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Newsletter, Run } from "@newsletter/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildIssuesHref } from "@/components/issues/issues-url";

const ALL_VALUE = "__all__";

type IssuesViewProps = {
  issues: Run[];
  newsletters: Newsletter[];
  currentNewsletterId: string;
  total: number;
  page: number;
  totalPages: number;
  loadError: string | null;
  /** Server-rendered ResponsiveList (table + cards); not wrapped when empty. */
  list: ReactNode;
};

export function IssuesView({
  issues,
  newsletters,
  currentNewsletterId,
  total,
  page,
  totalPages,
  loadError,
  list,
}: IssuesViewProps) {
  const router = useRouter();

  const onNewsletterChange = (value: string) => {
    router.push(
      buildIssuesHref({
        page: 1,
        newsletterId: value === ALL_VALUE ? undefined : value,
      }),
    );
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Issues</h1>
        <p className="text-sm text-muted-foreground">
          Completed drafts ready to read — filter by newsletter.
        </p>
      </div>

      <section aria-label="Issue filters" className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="issues-filter-newsletter">Newsletter</Label>
          <Select value={currentNewsletterId || ALL_VALUE} onValueChange={onNewsletterChange}>
            <SelectTrigger id="issues-filter-newsletter" className="w-60">
              <SelectValue placeholder="All newsletters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All newsletters</SelectItem>
              {newsletters.map((newsletter) => (
                <SelectItem key={newsletter.$id} value={newsletter.$id}>
                  {newsletter.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {loadError ? null : total === 0 ? (
        <section
          aria-label="Issues list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">
            No issues yet. Generate a newsletter from Newsletters — completed drafts appear here.
          </p>
        </section>
      ) : (
        <section aria-label="Issues list" className="mt-8">
          {list}

          <p className="mt-2 text-xs text-muted-foreground">
            Showing {issues.length} of {total} issue{total === 1 ? "" : "s"}
            {page > 1 || totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}.
          </p>
        </section>
      )}
    </>
  );
}
