/** Short date+time for operator-facing timestamps. */
export function formatOperatorDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

/** Short date-only for operator-facing dates. */
export function formatOperatorDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
}
