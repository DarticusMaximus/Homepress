import { resolveIssueDisplayTitle, type Run } from "@newsletter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";
import { IssueDownloadLinks } from "@/components/issues/issue-download-links";
import { IssueListenBar } from "@/components/issues/issue-listen-bar";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { PublishIssueButton } from "@/components/issues/publish-issue-button";
import { SendIssueButton } from "@/components/issues/send-issue-button";
import { QuietNavLink } from "@/components/quiet-nav-link";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { RegenerateDraftButton } from "@/components/runs/regenerate-draft-button";
import { formatOperatorDate } from "@/lib/format-operator-datetime";
import { ISSUE_READER_COLUMN_CLASS } from "@/lib/issue-reader-layout";

/** Locked copy — Feature 02 Task 3 (curly apostrophes). */
export const ISSUE_NOT_AVAILABLE_COPY = "This isn’t an available issue.";
export const ISSUE_LOAD_ERROR_COPY = "Couldn’t load this issue.";

/** Locked label — Feature 04 Task 3. */
export const INSPECT_PIPELINE_LABEL = "Inspect pipeline";

type IssueRunChrome = Pick<
  Run,
  | "newsletterName"
  | "endedAt"
  | "startedAt"
  | "emailDeliveryStatus"
  | "rssDeliveryStatus"
  | "issueTitle"
>;

function formatIssueDate(iso: string): string {
  return formatOperatorDate(iso);
}

function IssueBackLink({ showOps, className }: { showOps: boolean; className?: string }) {
  if (showOps) {
    return (
      <QuietNavLink href="/admin/issues" className={className}>
        Back to Issues
      </QuietNavLink>
    );
  }
  return (
    <QuietNavLink href="/" className={className}>
      Back to Home
    </QuietNavLink>
  );
}

function IssueChrome({
  run,
  markdown,
  inspectHref,
  sendRunId,
  showOps,
}: {
  run: IssueRunChrome;
  /** Draft markdown when loaded; omit/undefined on load-error → fallback title. */
  markdown?: string;
  /** Present only on eligible-issue success path with factory chrome. */
  inspectHref?: string;
  /** Present only on eligible-issue success path — enables Send + Publish + regenerate + downloads + badges. */
  sendRunId?: string;
  showOps: boolean;
}) {
  const dateIso = run.endedAt ?? run.startedAt;
  const dateLabel = formatIssueDate(dateIso);
  const title = resolveIssueDisplayTitle({
    markdown,
    newsletterName: run.newsletterName,
    dateIso,
    issueTitle: run.issueTitle,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <IssueBackLink showOps={showOps} />
        {inspectHref ? (
          <QuietNavLink href={inspectHref}>{INSPECT_PIPELINE_LABEL}</QuietNavLink>
        ) : null}
        {sendRunId ? <IssueDownloadLinks runId={sendRunId} /> : null}
        {sendRunId ? <SendIssueButton runId={sendRunId} /> : null}
        {sendRunId ? <PublishIssueButton runId={sendRunId} /> : null}
        {sendRunId ? (
          <RegenerateDraftButton
            runId={sendRunId}
            newsletterName={run.newsletterName}
            emailDeliveryStatus={run.emailDeliveryStatus}
            rssDeliveryStatus={run.rssDeliveryStatus}
          />
        ) : null}
        {sendRunId ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Email</span>
            <DeliveryStatusBadge channel="email" status={run.emailDeliveryStatus} />
            <span className="text-muted-foreground">RSS</span>
            <DeliveryStatusBadge channel="rss" status={run.rssDeliveryStatus} />
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {run.newsletterName} · {dateLabel}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
    </>
  );
}

/** Missing or ineligible run — no ops fields. */
export function IssueReaderNotAvailable({ showOps = false }: { showOps?: boolean } = {}) {
  return (
    <div className={ISSUE_READER_COLUMN_CLASS}>
      <p>{ISSUE_NOT_AVAILABLE_COPY}</p>
      <div className="mt-6">
        <IssueBackLink showOps={showOps} />
      </div>
    </div>
  );
}

type IssueReaderProps = {
  run: IssueRunChrome;
  /** Run id for Inspect pipeline link (success path only). */
  runId: string;
  markdown?: string;
  /** Eligible run but draft checkpoint failed to load. */
  loadError?: boolean;
  /** Factory chrome (Inspect / downloads / Send / Publish / regenerate / badges). Default off. */
  showOps?: boolean;
};

/**
 * Issue reader chrome + body (or load-error Alert).
 * Order: Back → meta → resolved display title → markdown / Alert.
 * Chrome title prefers stored issueTitle, then first draft heading; body still
 * renders the heading in place.
 * Inspect pipeline + downloads + Send + Publish + regenerate appear only on the
 * eligible-issue success path when `showOps` is true (Admin factory route).
 */
export function IssueReader({
  run,
  runId,
  markdown,
  loadError = false,
  showOps = false,
}: IssueReaderProps) {
  const inspectHref = showOps && !loadError ? inspectRunHref(runId) : undefined;
  const sendRunId = showOps && !loadError ? runId : undefined;

  return (
    <div className={ISSUE_READER_COLUMN_CLASS}>
      <IssueChrome
        run={run}
        markdown={loadError ? undefined : markdown}
        inspectHref={inspectHref}
        sendRunId={sendRunId}
        showOps={showOps}
      />
      {loadError ? (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertDescription>{ISSUE_LOAD_ERROR_COPY}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="mt-6 min-w-0">
            <IssueMarkdown markdown={markdown ?? ""} className="max-w-none" />
          </div>
          <IssueListenBar markdown={markdown ?? ""} />
        </>
      )}
    </div>
  );
}

/** Draft load failed and run metadata is unavailable. */
export function IssueReaderLoadErrorBare({ showOps = false }: { showOps?: boolean } = {}) {
  return (
    <div className={ISSUE_READER_COLUMN_CLASS}>
      <IssueBackLink showOps={showOps} />
      <Alert variant="destructive" className="mt-6" role="alert">
        <AlertDescription>{ISSUE_LOAD_ERROR_COPY}</AlertDescription>
      </Alert>
    </div>
  );
}
