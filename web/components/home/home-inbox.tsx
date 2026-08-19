import { formatIssueFallbackTitle, type IssueCardMeta, type Run } from "@newsletter/shared";
import { HomeIssueCard } from "@/components/home/home-issue-card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type HomeInboxProps = {
  issues: Run[];
  metaByRunId: ReadonlyMap<string, IssueCardMeta>;
  loadError: string | null;
  heading?: string;
};

/**
 * Presentational Home inbox: heading, load-error Alert, empty copy, or card
 * stack. The page owns data load and pagination. Channel pages pass `heading`
 * as the newsletter name; Home omits it (defaults to "Home").
 */
export function HomeInbox({
  issues,
  metaByRunId,
  loadError,
  heading = "Home",
}: HomeInboxProps) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{heading}</h1>

      {loadError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : issues.length === 0 ? (
        <section
          aria-label="Issues"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">No issues yet.</p>
        </section>
      ) : (
        <ul aria-label="Issues" className="flex flex-col gap-4">
          {issues.map((issue) => {
            const meta = metaByRunId.get(issue.$id);
            const dateIso = issue.endedAt ?? issue.startedAt;
            const title = meta?.title ?? formatIssueFallbackTitle(issue.newsletterName, dateIso);
            const dek = meta?.dek ?? null;
            return (
              <li key={issue.$id}>
                <HomeIssueCard issue={issue} title={title} dek={dek} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
