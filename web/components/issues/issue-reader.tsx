import { resolveIssueDisplayTitle, type Run } from "@newsletter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeliveryStatusBadge } from "@/components/delivery/delivery-status-badge";
import { IssueDownloadLinks } from "@/components/issues/issue-download-links";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { PublishIssueButton } from "@/components/issues/publish-issue-button";
import { SendIssueButton } from "@/components/issues/send-issue-button";
import { QuietNavLink } from "@/components/quiet-nav-link";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

/** Locked copy — Feature 02 Task 3 (curly apostrophes). */
export const ISSUE_NOT_AVAILABLE_COPY = "This isn’t an available issue.";
export const ISSUE_LOAD_ERROR_COPY = "Couldn’t load this issue.";

/** Locked label — Feature 04 Task 3. */
export const INSPECT_PIPELINE_LABEL = "Inspect pipeline";

type IssueRunChrome = Pick<
  Run,
  "newsletterName" | "endedAt" | "startedAt" | "emailDeliveryStatus" | "rssDeliveryStatus"
>;

function formatIssueDate(iso: string): string {
  return formatOperatorDate(iso);
}

function BackToIssuesLink({ className }: { className?: string }) {
  return (
    <QuietNavLink href="/issues" className={className}>
      Back to Issues
    </QuietNavLink>
  );
}

function IssueChrome({
  run,
  markdown,
  inspectHref,
  sendRunId,
}: {
  run: IssueRunChrome;
  /** Draft markdown when loaded; omit/undefined on load-error → fallback title. */
  markdown?: string;
  /** Present only on eligible-issue success path. */
  inspectHref?: string;
  /** Present only on eligible-issue success path — enables Send + Publish + downloads + badges. */
  sendRunId?: string;
}) {
  const dateIso = run.endedAt ?? run.startedAt;
  const dateLabel = formatIssueDate(dateIso);
  const title = resolveIssueDisplayTitle({
    markdown,
    newsletterName: run.newsletterName,
    dateIso,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BackToIssuesLink />
        {inspectHref ? (
          <QuietNavLink href={inspectHref}>{INSPECT_PIPELINE_LABEL}</QuietNavLink>
        ) : null}
        {sendRunId ? <IssueDownloadLinks runId={sendRunId} /> : null}
        {sendRunId ? <SendIssueButton runId={sendRunId} /> : null}
        {sendRunId ? <PublishIssueButton runId={sendRunId} /> : null}
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

/** Shared reader column: Typography measure (65ch), centered — no widen. */
const readerColumnClassName = "mx-auto w-full max-w-prose";

/** Missing or ineligible run — no ops fields. */
export function IssueReaderNotAvailable() {
  return (
    <div className={readerColumnClassName}>
      <p>{ISSUE_NOT_AVAILABLE_COPY}</p>
      <div className="mt-6">
        <BackToIssuesLink />
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
};

/**
 * Issue reader chrome + body (or load-error Alert).
 * Order: Back → meta → resolved display title → markdown / Alert.
 * Chrome title prefers first draft heading; body still renders the heading in place.
 * Inspect pipeline + downloads + Send + Publish appear only on the eligible-issue success path.
 */
export function IssueReader({ run, runId, markdown, loadError = false }: IssueReaderProps) {
  const inspectHref = loadError ? undefined : inspectRunHref(runId);
  const sendRunId = loadError ? undefined : runId;

  return (
    <div className={readerColumnClassName}>
      <IssueChrome
        run={run}
        markdown={loadError ? undefined : markdown}
        inspectHref={inspectHref}
        sendRunId={sendRunId}
      />
      {loadError ? (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertDescription>{ISSUE_LOAD_ERROR_COPY}</AlertDescription>
        </Alert>
      ) : (
        <div className="mt-6 min-w-0">
          <IssueMarkdown markdown={markdown ?? ""} />
        </div>
      )}
    </div>
  );
}

/** Draft load failed and run metadata is unavailable. */
export function IssueReaderLoadErrorBare() {
  return (
    <div className={readerColumnClassName}>
      <BackToIssuesLink />
      <Alert variant="destructive" className="mt-6" role="alert">
        <AlertDescription>{ISSUE_LOAD_ERROR_COPY}</AlertDescription>
      </Alert>
    </div>
  );
}
