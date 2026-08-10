"use client";

import { useState } from "react";
import Link from "next/link";
import type { Newsletter, NewsletterDateRange } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveList } from "@/components/domain-list";
import { formatUpdatedAt } from "@/components/domain-list/format-list-datetime";
import { DeleteNewsletterDialog } from "@/components/newsletters/delete-newsletter-dialog";
import {
  GenerateNewsletterButton,
  type ActiveRunState,
} from "@/components/newsletters/generate-newsletter-button";
import { NewsletterListCard } from "@/components/newsletters/newsletter-list-card";
import type { NewsletterFeedContext } from "@/components/newsletters/newsletter-feeds-section";

const DATE_RANGE_LABELS: Record<NewsletterDateRange, string> = {
  yesterday: "Yesterday",
  last_3_days: "Last 3 days",
  last_week: "Last week",
  all: "All",
};

function joinTopics(topics: string[]): string {
  return topics.join(", ");
}

type NewsletterRowActionsProps = {
  newsletter: Newsletter;
  activeRun?: ActiveRunState;
  onDelete: (newsletter: Newsletter) => void;
};

function NewsletterRowActions({
  newsletter,
  activeRun,
  onDelete,
}: NewsletterRowActionsProps) {
  return (
    <div className="flex justify-end gap-2">
      <GenerateNewsletterButton
        newsletterId={newsletter.$id}
        newsletterName={newsletter.name}
        activeRun={activeRun}
      />
      <Button variant="outline" size="sm" asChild>
        <Link href={`/newsletters/${newsletter.$id}`} aria-label={`Edit ${newsletter.name}`}>
          Edit
        </Link>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Delete ${newsletter.name}`}
        onClick={() => onDelete(newsletter)}
      >
        Delete
      </Button>
    </div>
  );
}

type NewslettersTableProps = {
  newsletters: Newsletter[];
  feedContextByNewsletter: Record<string, NewsletterFeedContext>;
  activeRunByNewsletterId: Record<string, ActiveRunState>;
};

export function NewslettersTable({
  newsletters,
  feedContextByNewsletter,
  activeRunByNewsletterId,
}: NewslettersTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<Newsletter | null>(null);

  const onDelete = (newsletter: Newsletter) => setDeleteTarget(newsletter);

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Topics</TableHead>
          <TableHead>Items</TableHead>
          <TableHead>Feeds</TableHead>
          <TableHead>Date range</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {newsletters.map((newsletter) => {
          const topicsLabel = joinTopics(newsletter.topics);
          const feedCount = feedContextByNewsletter[newsletter.$id]?.attached.length ?? 0;
          return (
            <TableRow key={newsletter.$id}>
              <TableCell className="font-medium">{newsletter.name}</TableCell>
              <TableCell className="max-w-[240px]">
                {topicsLabel ? (
                  <span className="block truncate" title={topicsLabel}>
                    {topicsLabel}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>{newsletter.newsItems}</TableCell>
              <TableCell>{feedCount}</TableCell>
              <TableCell>
                {DATE_RANGE_LABELS[newsletter.dateRange] ?? newsletter.dateRange}
              </TableCell>
              <TableCell>{formatUpdatedAt(newsletter.updatedAt)}</TableCell>
              <TableCell className="text-right">
                <NewsletterRowActions
                  newsletter={newsletter}
                  activeRun={activeRunByNewsletterId[newsletter.$id]}
                  onDelete={onDelete}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {newsletters.map((newsletter) => (
        <NewsletterListCard
          key={newsletter.$id}
          newsletter={newsletter}
          feedCount={feedContextByNewsletter[newsletter.$id]?.attached.length ?? 0}
          activeRun={activeRunByNewsletterId[newsletter.$id]}
          actions={{ onDelete }}
        />
      ))}
    </>
  );

  return (
    <>
      <ResponsiveList table={table} cards={cards} />

      {deleteTarget && (
        <DeleteNewsletterDialog
          key={deleteTarget.$id}
          newsletter={deleteTarget}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      )}
    </>
  );
}
