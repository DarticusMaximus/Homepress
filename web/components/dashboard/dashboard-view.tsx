import type { HealthCheckResult, Run } from "@newsletter/shared";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { RecentRuns } from "@/components/dashboard/recent-runs";
import { FeedsHealthCard } from "@/components/feeds-health-card/feeds-health-card";
import { HealthCard } from "@/components/health-card/health-card";
import { QuietNavLink } from "@/components/quiet-nav-link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DashboardAttentionItem } from "@/lib/dashboard-data";
import { buildRunsHref } from "@/lib/runs-url";

export type DashboardViewProps = {
  attentionItems: DashboardAttentionItem[];
  recentRuns: Run[];
  /** Safe section-level message when recent runs failed to load. */
  runsError?: string | null;
  healthResult: HealthCheckResult & { error?: string };
  feedsUnhealthyCount: number;
  feedsError?: string;
};

/**
 * Admin hub — section order pinned for composition tests.
 * Data loading and error isolation live in the page; this only renders props.
 */
export function DashboardView({
  attentionItems,
  recentRuns,
  runsError = null,
  healthResult,
  feedsUnhealthyCount,
  feedsError,
}: DashboardViewProps) {
  return (
    <main>
      <h1>Admin</h1>

      <div className="mt-8 space-y-8">
        <NeedsAttention items={attentionItems} />

        {runsError ? (
          <section aria-label="Recent runs" className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight">Recent runs</h2>
              <QuietNavLink href={buildRunsHref({})} className="min-h-0 px-0">
                View all
              </QuietNavLink>
            </div>
            <Alert variant="destructive" role="alert">
              <AlertDescription>{runsError}</AlertDescription>
            </Alert>
          </section>
        ) : (
          <RecentRuns runs={recentRuns} />
        )}

        <section aria-label="Health strip" className="grid gap-4 md:grid-cols-2">
          <HealthCard result={healthResult} />
          <FeedsHealthCard unhealthyCount={feedsUnhealthyCount} error={feedsError} />
        </section>
      </div>
    </main>
  );
}
