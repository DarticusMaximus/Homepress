import type { ReactNode } from "react";
import type {
  DraftCheckpointPayload,
  FetchCheckpoint,
  Run,
  ScrapeCheckpoint,
  ScoreCheckpoint,
  SelectionCheckpoint,
  SuppressSummary,
  TagCheckpoint,
} from "@newsletter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QuietNavLink } from "@/components/quiet-nav-link";
import { InspectDraftSection } from "@/components/runs/inspect-draft-section";
import { formatRunTriggerLabel, phaseFor } from "@/components/runs/run-display";
import { formatOperatorDate } from "@/lib/format-operator-datetime";
import { buildRunsHref } from "@/lib/runs-url";
import { formatRunStatusLabel } from "@/lib/status-labels";
import {
  InspectFetchedSection,
  InspectScrapedSection,
  InspectTaggedSection,
  InspectScoredSection,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";
import { InspectSelectionAuditSections } from "@/components/runs/inspect-selection-section";
import type { RunLookup } from "@/components/runs/run-suppress-summary";

/** Locked copy — Feature 04 Task 1 (curly apostrophe). */
export const INSPECT_NOT_AVAILABLE_COPY = "This run isn’t available.";
export const INSPECT_LOAD_ERROR_COPY =
  "Something went wrong while loading this run. Please try again.";

function formatInspectDate(iso: string): string {
  return formatOperatorDate(iso);
}

function BackToRunsLink({ className }: { className?: string }) {
  return (
    <QuietNavLink href={buildRunsHref({})} className={className}>
      Back to Runs
    </QuietNavLink>
  );
}

const shellColumnClassName = "mx-auto w-full max-w-3xl";

/** Missing run — no ops fields; do not surface repository error `.message`. */
export function InspectShellNotAvailable() {
  return (
    <div className={shellColumnClassName}>
      <p>{INSPECT_NOT_AVAILABLE_COPY}</p>
      <div className="mt-6">
        <BackToRunsLink />
      </div>
    </div>
  );
}

/** Load failure (Appwrite / unexpected) with safe Alert + Back to Runs. */
export function InspectShellLoadError({ message }: { message?: string }) {
  return (
    <div className={shellColumnClassName}>
      <BackToRunsLink />
      <Alert variant="destructive" className="mt-6" role="alert">
        <AlertDescription>{message ?? INSPECT_LOAD_ERROR_COPY}</AlertDescription>
      </Alert>
    </div>
  );
}

type InspectShellProps = {
  run: Run;
  fetchResult: PhaseLoadResult<FetchCheckpoint>;
  scrapeResult: PhaseLoadResult<ScrapeCheckpoint>;
  tagResult: PhaseLoadResult<TagCheckpoint>;
  scoreResult: PhaseLoadResult<ScoreCheckpoint>;
  /**
   * Selection checkpoint load (Feature 06). Loaded once on the page and shared
   * with Feature 07 Draft left pane — do not download selection twice.
   */
  selectionResult: PhaseLoadResult<SelectionCheckpoint>;
  /** Draft checkpoint load (Feature 07). */
  draftResult: PhaseLoadResult<DraftCheckpointPayload>;
  /** Parsed from `run.suppressSummary` — always present (may be empty). */
  suppressSummary: SuppressSummary;
  /** Prior-run dates for suppress Prior issue labels (best-effort). */
  runLookup: RunLookup;
  /** Optional Failed feeds sub-line under Fetched when non-empty. */
  failedFeedsSubline?: ReactNode;
};

/**
 * Inspect chrome + candidate phases (Feature 05) + selection/suppress audit
 * (Feature 06) + draft inspect (Feature 07). Order: Back → heading → meta →
 * phase hint → Fetched → Scraped → Tagged → Scored → Selected → Selection
 * drops → Suppressed → Draft.
 */
export function InspectShell({
  run,
  fetchResult,
  scrapeResult,
  tagResult,
  scoreResult,
  selectionResult,
  draftResult,
  suppressSummary,
  runLookup,
  failedFeedsSubline,
}: InspectShellProps) {
  const dateLabel = formatInspectDate(run.startedAt);
  const phase = phaseFor(run);
  const triggerLabel = formatRunTriggerLabel(run.trigger);

  return (
    <div className={shellColumnClassName}>
      <BackToRunsLink />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Inspect</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {run.newsletterName} · {formatRunStatusLabel(run.status)} · {triggerLabel} · {dateLabel}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{phase}</p>
      <InspectFetchedSection result={fetchResult} failedFeedsSubline={failedFeedsSubline} />
      <InspectScrapedSection result={scrapeResult} />
      <InspectTaggedSection result={tagResult} />
      <InspectScoredSection result={scoreResult} />
      <InspectSelectionAuditSections
        selection={selectionResult}
        suppressSummary={suppressSummary}
        runLookup={runLookup}
      />
      <InspectDraftSection selection={selectionResult} draft={draftResult} />
    </div>
  );
}
