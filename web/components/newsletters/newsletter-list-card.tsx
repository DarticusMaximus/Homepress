"use client";

import Link from "next/link";
import type { Newsletter, NewsletterDateRange } from "@newsletter/shared";
import { DomainListCard, DomainListField } from "@/components/domain-list";
import { formatUpdatedAt } from "@/components/domain-list/format-list-datetime";
import { Button } from "@/components/ui/button";
import type { ActiveRunState } from "@/components/newsletters/generate-newsletter-button";
import { GenerateNewsletterButton } from "@/components/newsletters/generate-newsletter-button";

const DATE_RANGE_LABELS: Record<NewsletterDateRange, string> = {
  yesterday: "Yesterday",
  last_3_days: "Last 3 days",
  last_week: "Last week",
  all: "All",
};

export type NewsletterListCardActions = {
  onDelete: (newsletter: Newsletter) => void;
};

type NewsletterListCardProps = {
  newsletter: Newsletter;
  feedCount: number;
  activeRun?: ActiveRunState;
  actions: NewsletterListCardActions;
};

export function NewsletterListCard({
  newsletter,
  feedCount,
  activeRun,
  actions,
}: NewsletterListCardProps) {
  const topicsLabel = newsletter.topics.join(", ");
  return (
    <DomainListCard
      title={newsletter.name}
      actions={
        <>
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
            onClick={() => actions.onDelete(newsletter)}
          >
            Delete
          </Button>
        </>
      }
    >
      <DomainListField label="Topics">
        {topicsLabel ? (
          <span className="break-words">{topicsLabel}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DomainListField>
      <DomainListField label="Items">
        <span>{newsletter.newsItems}</span>
      </DomainListField>
      <DomainListField label="Feeds">
        <span>{feedCount}</span>
      </DomainListField>
      <DomainListField label="Date range">
        <span>{DATE_RANGE_LABELS[newsletter.dateRange] ?? newsletter.dateRange}</span>
      </DomainListField>
      <DomainListField label="Updated">
        <span>{formatUpdatedAt(newsletter.updatedAt)}</span>
      </DomainListField>
    </DomainListCard>
  );
}
