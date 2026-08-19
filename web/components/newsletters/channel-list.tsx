import Link from "next/link";
import type { Newsletter } from "@newsletter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buildChannelHref } from "@/lib/channel-url";

export type ChannelListProps = {
  newsletters: Pick<Newsletter, "$id" | "name">[];
  loadError: string | null;
};

/**
 * Presentational reader channel directory: heading, load-error Alert, empty
 * copy, or full-row name links. The page owns data load, sort, and pagination.
 */
export function ChannelList({ newsletters, loadError }: ChannelListProps) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Newsletters</h1>

      {loadError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : newsletters.length === 0 ? (
        <section
          aria-label="Newsletters"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">No newsletters yet.</p>
        </section>
      ) : (
        <ul aria-label="Newsletters" className="flex flex-col">
          {newsletters.map((newsletter) => (
            <li key={newsletter.$id}>
              <Link
                href={buildChannelHref(newsletter.$id)}
                className="block rounded-md px-3 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {newsletter.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
