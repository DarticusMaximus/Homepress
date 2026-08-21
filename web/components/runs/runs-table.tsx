"use client";

import Link from "next/link";
import type { FeedFailure, Run, SuppressSummary } from "@newsletter/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveList } from "@/components/domain-list";
import {
  RUN_STATUS_BADGE,
  formatRunDateTime,
  formatRunTriggerLabel,
  phaseFor,
} from "@/components/runs/run-display";
import { RunFailedFeedsValue, type FeedLookup } from "@/components/runs/run-failed-feeds";
import { RunSuppressSummaryValue, type RunLookup } from "@/components/runs/run-suppress-summary";
import { RunListCard } from "@/components/runs/run-list-card";
import { RetryRunButton } from "@/components/runs/retry-run-button";
import { RegenerateDraftButton } from "@/components/runs/regenerate-draft-button";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { formatRunStatusLabel } from "@/lib/status-labels";

const EMPTY_SUPPRESS: SuppressSummary = { count: 0, items: [] };

type RunsTableProps = {
  runs: Run[];
  feedLookup: FeedLookup;
  failedFeedsByRun: Record<string, FeedFailure[]>;
  suppressSummaryByRun: Record<string, SuppressSummary>;
  runLookup: RunLookup;
};

export function RunsTable({
  runs,
  feedLookup,
  failedFeedsByRun,
  suppressSummaryByRun,
  runLookup,
}: RunsTableProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Newsletter</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Ended</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead>Failure</TableHead>
          <TableHead>Failed feeds</TableHead>
          <TableHead>Suppressed</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const failures = failedFeedsByRun[run.$id] ?? [];
          return (
            <TableRow key={run.$id}>
              <TableCell className="font-medium">{run.newsletterName}</TableCell>
              <TableCell>{formatRunDateTime(run.startedAt)}</TableCell>
              <TableCell>
                {run.endedAt ? (
                  formatRunDateTime(run.endedAt)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={RUN_STATUS_BADGE[run.status]}>
                  {formatRunStatusLabel(run.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{formatRunTriggerLabel(run.trigger)}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{phaseFor(run)}</TableCell>
              <TableCell className="max-w-[280px]">
                {run.status === "failed" && run.failureMessage ? (
                  <span className="block truncate" title={run.failureMessage}>
                    {run.failureMessage}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="max-w-[260px]">
                <RunFailedFeedsValue failures={failures} feedLookup={feedLookup} />
              </TableCell>
              <TableCell className="max-w-[260px]">
                <RunSuppressSummaryValue
                  summary={suppressSummaryByRun[run.$id] ?? EMPTY_SUPPRESS}
                  runLookup={runLookup}
                />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={inspectRunHref(run.$id)}>Inspect</Link>
                  </Button>
                  {run.status === "failed" ? (
                    <RetryRunButton runId={run.$id} newsletterName={run.newsletterName} />
                  ) : run.status === "completed" ? (
                    <RegenerateDraftButton
                      runId={run.$id}
                      newsletterName={run.newsletterName}
                      emailDeliveryStatus={run.emailDeliveryStatus}
                      rssDeliveryStatus={run.rssDeliveryStatus}
                    />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {runs.map((run) => (
        <RunListCard
          key={run.$id}
          run={run}
          feedLookup={feedLookup}
          failures={failedFeedsByRun[run.$id] ?? []}
          suppressSummary={suppressSummaryByRun[run.$id] ?? EMPTY_SUPPRESS}
          runLookup={runLookup}
        />
      ))}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}
