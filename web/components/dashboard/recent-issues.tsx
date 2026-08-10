import Link from "next/link";
import { formatIssueFallbackTitle, type Run } from "@newsletter/shared";
import { QuietNavLink } from "@/components/quiet-nav-link";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

function formatIssueDate(iso: string): string {
  return formatOperatorDate(iso);
}

export type RecentIssuesProps = {
  issues: Run[];
  /** Resolved display titles keyed by run id (page-scoped enrichment). */
  titleByRunId?: ReadonlyMap<string, string>;
};

/**
 * Dashboard “Recent issues” list — title, newsletter, date; row → issue reader.
 */
export function RecentIssues({ issues, titleByRunId }: RecentIssuesProps) {
  return (
    <section aria-label="Recent issues" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent issues</h2>
        <QuietNavLink href="/issues" className="min-h-0 px-0">
          View all
        </QuietNavLink>
      </div>

      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues yet.{" "}
          <Link href="/newsletters" className="text-primary underline-offset-4 hover:underline">
            Newsletters
          </Link>
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {issues.map((issue) => {
            const dateIso = issue.endedAt ?? issue.startedAt;
            const title =
              titleByRunId?.get(issue.$id) ??
              formatIssueFallbackTitle(issue.newsletterName, dateIso);
            const href = `/issues/${issue.$id}`;
            return (
              <li key={issue.$id}>
                <Link
                  href={href}
                  className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <span className="font-medium">{title}</span>
                  <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <span>{issue.newsletterName}</span>
                    <span>{formatIssueDate(dateIso)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
