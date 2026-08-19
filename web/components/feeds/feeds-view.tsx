"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Feed } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FeedFormDialog } from "@/components/feeds/feed-form-dialog";
import { FeedsTable } from "@/components/feeds/feeds-table";
import { buildFeedsHref } from "@/components/feeds/feeds-url";

type FeedsViewProps = {
  feeds: Feed[];
  total: number;
  health?: string;
};

export function FeedsView({ feeds, total, health }: FeedsViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const isFiltered = health === "unhealthy";

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Feeds</h1>
        <p className="text-sm text-muted-foreground">
          Shared RSS sources you qualify before attaching to newsletters.
        </p>
      </div>
      <Button type="button" onClick={() => setCreateOpen(true)}>
        <Plus />
        Add feed
      </Button>
    </div>
  );

  const filterIndicator = isFiltered ? (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Badge variant="secondary" data-testid="feeds-filter-indicator">
        Showing: unhealthy only
      </Badge>
      <Link
        href={buildFeedsHref({})}
        data-testid="feeds-clear-filter"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Clear filter
      </Link>
    </div>
  ) : null;

  if (total === 0) {
    return (
      <>
        {header}
        {filterIndicator}

        <section
          aria-label="Feeds list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          {isFiltered ? (
            <>
              <p className="text-sm text-muted-foreground">
                No unhealthy feeds. All feeds are operationally healthy.
              </p>
              <Button type="button" variant="outline" className="mt-4" asChild>
                <Link href={buildFeedsHref({})}>View all feeds</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No feeds yet. Add your first RSS source to get started.
              </p>
              <Button type="button" className="mt-4" onClick={() => setCreateOpen(true)}>
                <Plus />
                Add feed
              </Button>
            </>
          )}
        </section>

        {createOpen && <FeedFormDialog mode="create" open onOpenChange={setCreateOpen} />}
      </>
    );
  }

  return (
    <>
      {header}
      {filterIndicator}

      <section aria-label="Feeds list" className="mt-8">
        <FeedsTable feeds={feeds} />
      </section>

      {createOpen && <FeedFormDialog mode="create" open onOpenChange={setCreateOpen} />}
    </>
  );
}
