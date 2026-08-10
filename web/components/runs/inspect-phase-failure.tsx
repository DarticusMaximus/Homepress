import {
  PHASE_FAILURE_ERROR_MAX,
  redactMessageForStorage,
  type PhaseArticleFailureJson,
  type PhaseFailureSummaryJson,
} from "@newsletter/shared";
import { ResponsiveList } from "@/components/domain-list";
import { InspectExternalLink } from "@/components/runs/inspect-external-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DETAIL_EM_DASH = "\u2014";

const SCORE_FAILURE_REASON_LABELS: Record<"exception" | "parse", string> = {
  exception: "Exception",
  parse: "Parse",
};

/** Defense-in-depth: re-redact before Inspect display (same bound as persist). */
function displayPhaseFailureText(raw: string): string {
  return redactMessageForStorage(raw, PHASE_FAILURE_ERROR_MAX);
}

/** Summary line for a tag/score halt `phaseFailure` block. */
export function formatPhaseFailureSummaryLine(summary: PhaseFailureSummaryJson): string {
  const halt =
    summary.haltReason != null && summary.haltReason.length > 0
      ? displayPhaseFailureText(summary.haltReason)
      : DETAIL_EM_DASH;
  return `Halt reason: ${halt} · Consecutive errors: ${summary.consecutiveErrors} · Failures: ${summary.failureCount}`;
}

export function formatPhaseArticleFailureReason(
  reason: NonNullable<PhaseArticleFailureJson["reason"]>,
): string {
  return SCORE_FAILURE_REASON_LABELS[reason];
}

function phaseArticleFailureRowKey(failure: PhaseArticleFailureJson, index: number): string {
  return `${failure.articleLink}\0${index}`;
}

function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className ?? "block max-w-[240px] truncate"} title={text}>
      {text}
    </span>
  );
}

type PhaseFailureListProps = {
  failures: PhaseArticleFailureJson[];
  /** When true, show Reason column (score halt sample). */
  showReason: boolean;
};

/** Phase article failures — Title, Error, Attempts, Link (+ Reason when score). */
function InspectPhaseFailureList({ failures, showReason }: PhaseFailureListProps) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Error</TableHead>
          <TableHead>Attempts</TableHead>
          {showReason ? <TableHead>Reason</TableHead> : null}
          <TableHead>Link</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {failures.map((failure, index) => {
          const errorText = displayPhaseFailureText(failure.error);
          return (
            <TableRow key={phaseArticleFailureRowKey(failure, index)}>
              <TableCell className="font-medium">
                <TruncatedText text={failure.articleTitle} />
              </TableCell>
              <TableCell>
                <TruncatedText text={errorText} className="block max-w-[220px] truncate" />
              </TableCell>
              <TableCell>{failure.attempts}</TableCell>
              {showReason ? (
                <TableCell>
                  {failure.reason != null
                    ? formatPhaseArticleFailureReason(failure.reason)
                    : DETAIL_EM_DASH}
                </TableCell>
              ) : null}
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
        const errorText = displayPhaseFailureText(failure.error);
        return (
          <Card key={phaseArticleFailureRowKey(failure, index)}>
            <CardHeader className="gap-2">
              <CardTitle className="text-base break-words" title={failure.articleTitle}>
                {failure.articleTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Error: </span>
                <span className="break-words" title={errorText}>
                  {errorText}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Attempts: </span>
                <span>{failure.attempts}</span>
              </div>
              {showReason ? (
                <div>
                  <span className="text-muted-foreground">Reason: </span>
                  <span>
                    {failure.reason != null
                      ? formatPhaseArticleFailureReason(failure.reason)
                      : DETAIL_EM_DASH}
                  </span>
                </div>
              ) : null}
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

type InspectPhaseFailureBlockProps = {
  phaseFailure: PhaseFailureSummaryJson;
};

/**
 * Halt diagnostic block for Tagged / Scored Inspect sections.
 * Always renders when parent passes `phaseFailure` — summary + failure list.
 */
export function InspectPhaseFailureBlock({
  phaseFailure,
}: InspectPhaseFailureBlockProps): React.JSX.Element {
  const summaryLine = formatPhaseFailureSummaryLine(phaseFailure);
  const showReason = phaseFailure.failures.some((f) => f.reason != null);

  return (
    <div className="space-y-3" data-slot="phase-failure-block">
      <p className="text-sm text-muted-foreground">{summaryLine}</p>
      {phaseFailure.failures.length > 0 ? (
        <InspectPhaseFailureList failures={phaseFailure.failures} showReason={showReason} />
      ) : null}
    </div>
  );
}
