"use client";

import { useRouter } from "next/navigation";
import type { FeedFailure, Newsletter, Run, RunStatus, SuppressSummary } from "@newsletter/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RunsTable } from "@/components/runs/runs-table";
import type { FeedLookup } from "@/components/runs/run-failed-feeds";
import type { RunLookup } from "@/components/runs/run-suppress-summary";
import { buildRunsHref } from "@/lib/runs-url";
import { formatRunStatusLabel } from "@/lib/status-labels";

const ALL_VALUE = "__all__";

const RUN_STATUSES: RunStatus[] = ["pending", "running", "completed", "failed"];

type RunsViewProps = {
  runs: Run[];
  newsletters: Newsletter[];
  currentNewsletterId: string;
  currentStatus: RunStatus | "";
  total: number;
  page: number;
  totalPages: number;
  loadError: string | null;
  feedLookup: FeedLookup;
  failedFeedsByRun: Record<string, FeedFailure[]>;
  suppressSummaryByRun: Record<string, SuppressSummary>;
  runLookup: RunLookup;
};

export function RunsView({
  runs,
  newsletters,
  currentNewsletterId,
  currentStatus,
  total,
  page,
  totalPages,
  loadError,
  feedLookup,
  failedFeedsByRun,
  suppressSummaryByRun,
  runLookup,
}: RunsViewProps) {
  const router = useRouter();

  const onNewsletterChange = (value: string) => {
    router.push(
      buildRunsHref({
        page: 1,
        newsletterId: value === ALL_VALUE ? undefined : value,
        status: currentStatus || undefined,
      }),
    );
  };

  const onStatusChange = (value: string) => {
    router.push(
      buildRunsHref({
        page: 1,
        newsletterId: currentNewsletterId || undefined,
        status: value === ALL_VALUE ? undefined : value,
      }),
    );
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <p className="text-sm text-muted-foreground">
          Outcomes of newsletter generation — diagnose failures and retry from here.
        </p>
      </div>

      <section aria-label="Run filters" className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="runs-filter-newsletter">Newsletter</Label>
          <Select value={currentNewsletterId || ALL_VALUE} onValueChange={onNewsletterChange}>
            <SelectTrigger id="runs-filter-newsletter" className="w-60">
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="runs-filter-status">Status</Label>
          <Select value={currentStatus || ALL_VALUE} onValueChange={onStatusChange}>
            <SelectTrigger id="runs-filter-status" className="w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
              {RUN_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {formatRunStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {loadError ? null : total === 0 ? (
        <section
          aria-label="Runs list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">
            Runs appear after you generate a newsletter. Start one from the Newsletters page.
          </p>
        </section>
      ) : (
        <section aria-label="Runs list" className="mt-8">
          <RunsTable
            runs={runs}
            feedLookup={feedLookup}
            failedFeedsByRun={failedFeedsByRun}
            suppressSummaryByRun={suppressSummaryByRun}
            runLookup={runLookup}
          />

          <p className="mt-2 text-xs text-muted-foreground">
            Showing {runs.length} of {total} run{total === 1 ? "" : "s"}
            {page > 1 || totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}.
          </p>
        </section>
      )}
    </>
  );
}
