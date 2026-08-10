import type { ReactNode } from "react";
import {
  redactMessageForStorage,
  type SelectionCheckpoint,
  type SelectionFailureJson,
  type SuppressItem,
  type SuppressSummary,
} from "@newsletter/shared";
import { ResponsiveList } from "@/components/domain-list";
import {
  InspectScoredArticleList,
  sortScoredDescending,
} from "@/components/runs/inspect-article-list";
import { InspectExternalLink } from "@/components/runs/inspect-external-link";
import { PhaseSectionChrome } from "@/components/runs/inspect-phase-chrome";
import {
  PHASE_EMPTY_COPY,
  PHASE_ERROR_COPY,
  PHASE_MISSING_COPY,
  type PhaseLoadResult,
} from "@/components/runs/inspect-phase-section";
import {
  formatPriorIssueLabel,
  type RunLookup,
} from "@/components/runs/run-suppress-summary";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Locked copy — Feature 06 Selection drops / Suppressed. */
export const SELECTION_DROPS_LEGACY_COPY =
  "Selection drop details weren\u2019t saved for this run.";
export const SELECTION_DROPS_EMPTY_COPY = "No articles dropped by selection.";
export const SUPPRESS_EMPTY_COPY = "No cross-run suppressions.";

const DETAIL_EM_DASH = "\u2014";
/** Match execute-run persistence bound for legacy checkpoint display. */
const SELECTION_FAILURE_ERROR_MAX = 2000;

const SELECTION_FAILURE_REASON_LABELS: Record<SelectionFailureJson["reason"], string> = {
  "below-threshold": "Below score threshold",
  "not-selected": "Not selected by MMR",
  "embedding-failed": "Embedding failed",
};

export function formatSelectionFailureReason(
  reason: SelectionFailureJson["reason"],
): string {
  return SELECTION_FAILURE_REASON_LABELS[reason];
}

function formatSelectionFailureDetail(failure: SelectionFailureJson): string {
  if (!failure.error || failure.error.length === 0) return DETAIL_EM_DASH;
  const detail = redactMessageForStorage(failure.error, SELECTION_FAILURE_ERROR_MAX);
  return detail.length > 0 ? detail : DETAIL_EM_DASH;
}

/** Consistent similarity display for Suppressed rows. */
function formatSuppressSimilarity(similarity: number): string {
  return String(similarity);
}

function PhaseErrorAlert(): React.JSX.Element {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{PHASE_ERROR_COPY}</AlertDescription>
    </Alert>
  );
}

function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className ?? "block max-w-[240px] truncate"} title={text}>
      {text}
    </span>
  );
}

function selectionFailureRowKey(failure: SelectionFailureJson, index: number): string {
  return `${failure.articleLink}\0${index}`;
}

function suppressItemRowKey(item: SuppressItem, index: number): string {
  return `${item.link}\0${index}`;
}

type SelectionDropsListProps = {
  failures: SelectionFailureJson[];
};

/** Selection drops — Title, Reason, Detail, Link. */
function InspectSelectionDropsList({ failures }: SelectionDropsListProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {failures.map((failure, index) => {
          const reason = formatSelectionFailureReason(failure.reason);
          const detail = formatSelectionFailureDetail(failure);
          return (
            <TableRow key={selectionFailureRowKey(failure, index)}>
              <TableCell className="font-medium">
                <TruncatedText text={failure.articleTitle} />
              </TableCell>
              <TableCell>{reason}</TableCell>
              <TableCell>
                <TruncatedText text={detail} className="block max-w-[220px] truncate" />
              </TableCell>
              <TableCell>
                <InspectExternalLink href={failure.articleLink} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {failures.map((failure, index) => {
        const reason = formatSelectionFailureReason(failure.reason);
        const detail = formatSelectionFailureDetail(failure);
        return (
          <Card key={selectionFailureRowKey(failure, index)}>
            <CardHeader className="gap-2">
              <CardTitle className="text-base break-words" title={failure.articleTitle}>
                {failure.articleTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Reason: </span>
                <span>{reason}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Detail: </span>
                <span className="break-words" title={detail}>
                  {detail}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Link: </span>
                <InspectExternalLink href={failure.articleLink} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}

type SuppressedListProps = {
  items: SuppressItem[];
  runLookup: RunLookup;
};

/** Suppressed — Title, Matched prior, Prior issue, Similarity, Link. */
function InspectSuppressedList({ items, runLookup }: SuppressedListProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Matched prior</TableHead>
          <TableHead>Prior issue</TableHead>
          <TableHead>Similarity</TableHead>
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => {
          const priorLabel = formatPriorIssueLabel(item, runLookup);
          const similarity = formatSuppressSimilarity(item.similarity);
          return (
            <TableRow key={suppressItemRowKey(item, index)}>
              <TableCell className="font-medium">
                <TruncatedText text={item.title} />
              </TableCell>
              <TableCell>
                <TruncatedText text={item.matchedTitle} />
              </TableCell>
              <TableCell>{priorLabel}</TableCell>
              <TableCell>{similarity}</TableCell>
              <TableCell>
                <InspectExternalLink href={item.link} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {items.map((item, index) => {
        const priorLabel = formatPriorIssueLabel(item, runLookup);
        const similarity = formatSuppressSimilarity(item.similarity);
        return (
          <Card key={suppressItemRowKey(item, index)}>
            <CardHeader className="gap-2">
              <CardTitle className="text-base break-words" title={item.title}>
                {item.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Matched prior: </span>
                <span className="break-words" title={item.matchedTitle}>
                  {item.matchedTitle}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Prior issue: </span>
                <span>{priorLabel}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Similarity: </span>
                <span>{similarity}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Link: </span>
                <InspectExternalLink href={item.link} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </>
  );

  return <ResponsiveList table={table} cards={cards} />;
}

type SelectedSectionProps = {
  result: PhaseLoadResult<SelectionCheckpoint>;
  /** When true, skip the destructive Alert (shared above Selected + drops). */
  hideErrorAlert?: boolean;
};

export function InspectSelectedSection({
  result,
  hideErrorAlert = false,
}: SelectedSectionProps): React.JSX.Element {
  const count = result.status === "loaded" ? result.data.selectedArticles.length : null;
  const emptyList =
    result.status === "loaded" && result.data.selectedArticles.length === 0;

  return (
    <PhaseSectionChrome label="Selected" count={count}>
      {result.status === "missing" ? (
        <p className="text-sm text-muted-foreground">{PHASE_MISSING_COPY}</p>
      ) : result.status === "error" ? (
        hideErrorAlert ? null : (
          <PhaseErrorAlert />
        )
      ) : emptyList ? (
        <p className="text-sm text-muted-foreground">{PHASE_EMPTY_COPY}</p>
      ) : (
        <InspectScoredArticleList
          articles={sortScoredDescending(result.data.selectedArticles)}
        />
      )}
    </PhaseSectionChrome>
  );
}

type SelectionDropsSectionProps = {
  result: PhaseLoadResult<SelectionCheckpoint>;
  /** When true, skip the destructive Alert (shared above Selected + drops). */
  hideErrorAlert?: boolean;
};

/**
 * Selection drops body rules (locked):
 * - missing → same checkpoint missing copy
 * - loaded + `failures` undefined (legacy) + selected > 0 → weren’t saved
 * - loaded + failures present (incl. []) + length 0 → no articles dropped
 * - loaded + failures.length > 0 → list
 * - error → Alert (unless shared)
 */
export function InspectSelectionDropsSection({
  result,
  hideErrorAlert = false,
}: SelectionDropsSectionProps): React.JSX.Element {
  const count =
    result.status === "loaded"
      ? (result.data.failures !== undefined ? result.data.failures.length : null)
      : null;

  let body: ReactNode;
  if (result.status === "missing") {
    body = <p className="text-sm text-muted-foreground">{PHASE_MISSING_COPY}</p>;
  } else if (result.status === "error") {
    body = hideErrorAlert ? null : <PhaseErrorAlert />;
  } else {
    const { selectedArticles, failures } = result.data;
    if (failures === undefined) {
      // Legacy: key absent. Show “weren’t saved” when there were selected articles.
      body =
        selectedArticles.length > 0 ? (
          <p className="text-sm text-muted-foreground">{SELECTION_DROPS_LEGACY_COPY}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{SELECTION_DROPS_EMPTY_COPY}</p>
        );
    } else if (failures.length === 0) {
      body = <p className="text-sm text-muted-foreground">{SELECTION_DROPS_EMPTY_COPY}</p>;
    } else {
      body = <InspectSelectionDropsList failures={failures} />;
    }
  }

  return (
    <PhaseSectionChrome label="Selection drops" count={count}>
      {body}
    </PhaseSectionChrome>
  );
}

type SuppressedSectionProps = {
  summary: SuppressSummary;
  runLookup: RunLookup;
};

export function InspectSuppressedSection({
  summary,
  runLookup,
}: SuppressedSectionProps): React.JSX.Element {
  const { count, items } = summary;

  return (
    <PhaseSectionChrome label="Suppressed" count={count}>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">{SUPPRESS_EMPTY_COPY}</p>
      ) : (
        <InspectSuppressedList items={items} runLookup={runLookup} />
      )}
    </PhaseSectionChrome>
  );
}

type SelectionAuditSectionsProps = {
  selection: PhaseLoadResult<SelectionCheckpoint>;
  suppressSummary: SuppressSummary;
  runLookup: RunLookup;
};

/**
 * Composite for Task 3 wiring: one shared error Alert above Selected + Selection
 * drops, then Suppressed. Independently testable with fixtures (no Appwrite).
 */
export function InspectSelectionAuditSections({
  selection,
  suppressSummary,
  runLookup,
}: SelectionAuditSectionsProps): React.JSX.Element {
  const sharedError = selection.status === "error";

  return (
    <>
      {sharedError ? <PhaseErrorAlert /> : null}
      <InspectSelectedSection result={selection} hideErrorAlert={sharedError} />
      <InspectSelectionDropsSection result={selection} hideErrorAlert={sharedError} />
      <InspectSuppressedSection summary={suppressSummary} runLookup={runLookup} />
    </>
  );
}
