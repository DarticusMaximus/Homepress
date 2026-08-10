import type { ReactNode } from "react";
import type {
  DraftCheckpointPayload,
  SelectionCheckpoint,
} from "@newsletter/shared";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import {
  InspectScoredArticleList,
  sortScoredDescending,
} from "@/components/runs/inspect-article-list";
import {
  PHASE_EMPTY_COPY,
  PHASE_ERROR_COPY,
  PHASE_MISSING_COPY,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Locked empty-draft reason copy — Feature 07. */
export const DRAFT_EMPTY_NO_ARTICLES =
  "Draft is empty \u2014 no articles were provided.";
export const DRAFT_EMPTY_AFTER_RETRY =
  "Draft is empty \u2014 the model returned no content after retry.";
export const DRAFT_EMPTY_GENERIC = "Draft is empty.";

export type InspectDraftSectionProps = {
  selection: PhaseLoadResult<SelectionCheckpoint>;
  draft: PhaseLoadResult<DraftCheckpointPayload>;
};

function PhaseErrorAlert(): React.JSX.Element {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{PHASE_ERROR_COPY}</AlertDescription>
    </Alert>
  );
}

function formatDraftMeta(payload: DraftCheckpointPayload): string {
  return `Articles fed: ${payload.articleCount} \u00b7 Attempts: ${payload.attempts}`;
}

function draftEmptyCopy(reason: DraftCheckpointPayload["reason"]): string {
  if (reason === "no-articles") return DRAFT_EMPTY_NO_ARTICLES;
  if (reason === "empty-after-retry") return DRAFT_EMPTY_AFTER_RETRY;
  return DRAFT_EMPTY_GENERIC;
}

function SelectedInputsPane({
  result,
}: {
  result: PhaseLoadResult<SelectionCheckpoint>;
}): React.JSX.Element {
  const count =
    result.status === "loaded" ? result.data.selectedArticles.length : null;
  const heading =
    count === null ? "Selected inputs" : `Selected inputs (${count})`;

  let body: ReactNode;
  if (result.status === "missing") {
    body = <p className="text-sm text-muted-foreground">{PHASE_MISSING_COPY}</p>;
  } else if (result.status === "error") {
    body = <PhaseErrorAlert />;
  } else if (result.data.selectedArticles.length === 0) {
    body = <p className="text-sm text-muted-foreground">{PHASE_EMPTY_COPY}</p>;
  } else {
    body = (
      <InspectScoredArticleList
        articles={sortScoredDescending(result.data.selectedArticles)}
      />
    );
  }

  return (
    <div data-slot="inspect-draft-selected" className="space-y-3 min-w-0">
      <h3 className="text-base font-semibold tracking-tight">{heading}</h3>
      {body}
    </div>
  );
}

function DraftOutputPane({
  result,
}: {
  result: PhaseLoadResult<DraftCheckpointPayload>;
}): React.JSX.Element {
  let body: ReactNode;
  if (result.status === "missing") {
    body = <p className="text-sm text-muted-foreground">{PHASE_MISSING_COPY}</p>;
  } else if (result.status === "error") {
    body = <PhaseErrorAlert />;
  } else if (result.data.empty === true) {
    body = (
      <p className="text-sm text-muted-foreground">
        {draftEmptyCopy(result.data.reason)}
      </p>
    );
  } else {
    body = (
      <IssueMarkdown markdown={result.data.markdown} className="max-w-none" />
    );
  }

  return (
    <div data-slot="inspect-draft-output" className="space-y-3 min-w-0">
      <h3 className="text-base font-semibold tracking-tight">Draft output</h3>
      {body}
    </div>
  );
}

/**
 * Read-only Draft inspect section: Selected inputs stacked above Draft output.
 * Accepts selection + draft PhaseLoadResult props for standalone testing;
 * Task 3 wires these from the Inspect page.
 */
export function InspectDraftSection({
  selection,
  draft,
}: InspectDraftSectionProps): React.JSX.Element {
  const meta =
    draft.status === "loaded" ? (
      <p className="text-sm text-muted-foreground">{formatDraftMeta(draft.data)}</p>
    ) : null;

  return (
    <section className="mt-8 space-y-3" aria-label="Draft">
      <h2 className="text-lg font-semibold tracking-tight">Draft</h2>
      {meta}
      <div className="flex flex-col gap-6">
        <SelectedInputsPane result={selection} />
        <DraftOutputPane result={draft} />
      </div>
    </section>
  );
}
