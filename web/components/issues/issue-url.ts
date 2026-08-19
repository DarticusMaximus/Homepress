/** Reader issue href — Feature 04. */
export function buildIssueHref(runId: string): string {
  return `/issues/${runId}`;
}

/** Factory issue href (ops chrome) — Feature 04. */
export function buildAdminIssueHref(runId: string): string {
  return `/admin/issues/${runId}`;
}
