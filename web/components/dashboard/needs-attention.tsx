import Link from "next/link";
import type { DashboardAttentionItem } from "@/lib/dashboard-data";

function attentionLabel(item: DashboardAttentionItem): string {
  const { kind, count } = item;
  switch (kind) {
    case "unhealthy_feeds":
      return count === 1 ? "1 unhealthy feed" : `${count} unhealthy feeds`;
    case "failed_runs":
      return count === 1 ? "1 failed run" : `${count} failed runs`;
    case "failed_delivery":
      return count === 1 ? "1 delivery failure" : `${count} delivery failures`;
  }
}

export type NeedsAttentionProps = {
  /** Pre-filtered attention rows (counts > 0 only). Empty → render nothing. */
  items: DashboardAttentionItem[];
};

/**
 * Dashboard “Needs attention” badges — only positive counts, each a deep link.
 * Renders null when `items` is empty so the section can be omitted entirely.
 */
export function NeedsAttention({ items }: NeedsAttentionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-label="Needs attention" className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Needs attention</h2>
      <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {items.map((item) => (
          <li key={item.kind}>
            <Link
              href={item.href}
              className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              {attentionLabel(item)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
