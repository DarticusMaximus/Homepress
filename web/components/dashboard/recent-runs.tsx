import Link from "next/link";
import type { Run } from "@newsletter/shared";
import { QuietNavLink } from "@/components/quiet-nav-link";
import { formatRunDateTime } from "@/components/runs/run-display";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { buildRunsHref } from "@/lib/runs-url";
import { formatRunStatusLabel } from "@/lib/status-labels";

function runRowHref(run: Pick<Run, "$id" | "status">): string {
  if (run.status === "completed" || run.status === "failed") {
    return inspectRunHref(run.$id);
  }
  return buildRunsHref({});
}

export type RecentRunsProps = {
  runs: Run[];
};

/**
 * Dashboard “Recent runs” snapshot — newsletter, humanized status, started/ended;
 * completed/failed → inspect; pending/running → `/admin/runs`.
 */
export function RecentRuns({ runs }: RecentRunsProps) {
  const runsHref = buildRunsHref({});
  return (
    <section aria-label="Recent runs" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent runs</h2>
        <QuietNavLink href={runsHref} className="min-h-0 px-0">
          View all
        </QuietNavLink>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No runs in the last 7 days.{" "}
          <Link href={runsHref} className="text-primary underline-offset-4 hover:underline">
            Runs
          </Link>
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {runs.map((run) => {
            const href = runRowHref(run);
            return (
              <li key={run.$id}>
                <Link
                  href={href}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <span className="font-medium">{run.newsletterName}</span>
                  <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <span>{formatRunStatusLabel(run.status)}</span>
                    <span>{formatRunDateTime(run.startedAt)}</span>
                    {run.endedAt ? <span>{formatRunDateTime(run.endedAt)}</span> : null}
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
