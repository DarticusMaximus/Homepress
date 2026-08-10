import type { SuppressItem, SuppressSummary } from "@newsletter/shared";
import { formatRunDateTime } from "@/components/runs/run-display";

/**
 * Compact run reference for resolving a suppressed item's matched prior run.
 * Keyed by run `$id`; `startedAt` is always present and `endedAt` may be null
 * for in-flight runs. Built on the server page from the full (pre-paginated)
 * run list and threaded down so the client never fetches runs itself.
 */
export type RunLookup = Record<string, { endedAt: string | null; startedAt: string }>;

/**
 * Human label for a suppress count. `1 suppressed` for a single item, otherwise
 * `N suppressed`.
 */
function formatSuppressCountLabel(count: number): string {
  return count === 1 ? "1 suppressed" : `${count} suppressed`;
}

/**
 * Resolve a suppressed item's matched prior run to a human label. When the
 * prior run is present in {@link RunLookup}, prefer its `endedAt` (falling back
 * to `startedAt`) formatted via {@link formatRunDateTime}. Otherwise degrade to
 * a short-id hint: `run …<last6>`.
 */
export function formatPriorIssueLabel(item: SuppressItem, runLookup: RunLookup): string {
  if (!item.matchedRunId) return "unknown prior";
  const entry = runLookup[item.matchedRunId];
  if (entry) {
    return formatRunDateTime(entry.endedAt ?? entry.startedAt);
  }
  return `run …${item.matchedRunId.slice(-6)}`;
}

/**
 * One human-readable line describing a single suppressed item. Always names the
 * suppressed candidate `title` and the matched prior `matchedTitle`, followed by
 * the resolved prior-issue label in parentheses. Used to populate the compact
 * control's title/hidden list and the card's visible item list.
 */
function formatSuppressItemLine(item: SuppressItem, runLookup: RunLookup): string {
  return `"${item.title}" matched prior "${item.matchedTitle}" (${formatPriorIssueLabel(item, runLookup)})`;
}

/**
 * Renders a run's Suppressed cell from an already-parsed {@link SuppressSummary}
 * (the server page runs `parseSuppressSummary` and passes the result down, so
 * the runtime shared import stays off the client bundle). Used by both the Runs
 * table and card so the two presentations stay in sync.
 *
 * Two variants share the parsed summary:
 *
 * - **Compact** (`expanded` omitted/false, default) — for the dense table cell.
 *   Shows a single-line label (the suppressed `title` for one item, or
 *   `N suppressed` for many). Each item line is exposed via the label's `title`
 *   attribute and a visually hidden list so the DOM `textContent` carries every
 *   line for assistive tech. The count is always findable via `aria-label`.
 *
 * - **Expanded** (`expanded` true) — for the card surface, which has vertical
 *   room and where the spec requires each item line to appear in *visible*
 *   text. Renders the count label followed by a visible list of every
 *   `formatSuppressItemLine`. Nothing is `sr-only` in this variant.
 *
 * Empty (count 0) → muted em-dash in both variants.
 */
export function RunSuppressSummaryValue({
  summary,
  runLookup,
  expanded = false,
}: {
  summary: SuppressSummary;
  runLookup: RunLookup;
  expanded?: boolean;
}) {
  const { count, items } = summary;

  if (count === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const lines = items.map((item) => formatSuppressItemLine(item, runLookup));

  if (expanded) {
    return (
      <span className="flex flex-col">
        <span>{formatSuppressCountLabel(count)}</span>
        <ul
          className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground"
          data-testid="suppress-item-lines"
        >
          {lines.map((line, index) => (
            <li key={index} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      </span>
    );
  }

  const titleText = lines.join("\n");
  const label = count === 1 ? items[0].title : formatSuppressCountLabel(count);

  return (
    <span className="flex flex-col">
      <span
        className="block max-w-[220px] truncate"
        title={titleText}
        aria-label={formatSuppressCountLabel(count)}
      >
        {label}
      </span>
      <span className="sr-only">
        {lines.map((line, index) => (
          <span key={index}>
            {line}
            {index < lines.length - 1 ? "; " : ""}
          </span>
        ))}
      </span>
    </span>
  );
}
