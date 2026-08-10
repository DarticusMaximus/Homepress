"use client";

import Link from "next/link";
import type { FeedFailure, Run, SuppressSummary } from "@newsletter/shared";
import { DomainListCard, DomainListField } from "@/components/domain-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RUN_STATUS_BADGE,
  formatRunDateTime,
  formatRunTriggerLabel,
  phaseFor,
} from "@/components/runs/run-display";
import { RunFailedFeedsValue, type FeedLookup } from "@/components/runs/run-failed-feeds";
import { RunSuppressSummaryValue, type RunLookup } from "@/components/runs/run-suppress-summary";
import { RetryRunButton } from "@/components/runs/retry-run-button";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { formatRunStatusLabel } from "@/lib/status-labels";

type RunListCardProps = {
  run: Run;
  feedLookup: FeedLookup;
  failures: FeedFailure[];
  suppressSummary: SuppressSummary;
  runLookup: RunLookup;
};

export function RunListCard({
  run,
  feedLookup,
  failures,
  suppressSummary,
  runLookup,
}: RunListCardProps) {
  return (
    <DomainListCard
      title={run.newsletterName}
      badges={
        <Badge variant={RUN_STATUS_BADGE[run.status]}>
          {formatRunStatusLabel(run.status)}
        </Badge>
      }
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={inspectRunHref(run.$id)}>Inspect</Link>
          </Button>
          {run.status === "failed" ? (
            <RetryRunButton runId={run.$id} newsletterName={run.newsletterName} />
          ) : null}
        </>
      }
    >
      <DomainListField label="Started">
        <span>{formatRunDateTime(run.startedAt)}</span>
      </DomainListField>
      <DomainListField label="Ended">
        {run.endedAt ? (
          <span>{formatRunDateTime(run.endedAt)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DomainListField>
      <DomainListField label="Trigger">
        <Badge variant="secondary">{formatRunTriggerLabel(run.trigger)}</Badge>
      </DomainListField>
      <DomainListField label="Phase">
        <span className="text-muted-foreground">{phaseFor(run)}</span>
      </DomainListField>
      <DomainListField label="Failure">
        {run.status === "failed" && run.failureMessage ? (
          <span className="break-words" title={run.failureMessage}>
            {run.failureMessage}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DomainListField>
      <DomainListField label="Failed feeds">
        <RunFailedFeedsValue failures={failures} feedLookup={feedLookup} />
      </DomainListField>
      <DomainListField label="Suppressed">
        <RunSuppressSummaryValue summary={suppressSummary} runLookup={runLookup} expanded />
      </DomainListField>
    </DomainListCard>
  );
}
