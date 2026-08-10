"use client";

import type { Feed } from "@newsletter/shared";
import { DomainListCard, DomainListField } from "@/components/domain-list";
import { formatUpdatedAt } from "@/components/domain-list/format-list-datetime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TestFeedButton } from "@/components/feeds/test-feed-button";
import { FeedFetchFailuresValue, FeedHealthBadge } from "@/components/feeds/feed-health";
import { STATUS_BADGE } from "@/components/feeds/feed-status-badge";
import { formatFeedStatusLabel } from "@/lib/status-labels";

export type FeedListCardActions = {
  onEdit: (feed: Feed) => void;
  onDelete: (feed: Feed) => void;
};

type FeedListCardProps = {
  feed: Feed;
  actions: FeedListCardActions;
};

export function FeedListCard({ feed, actions }: FeedListCardProps) {
  return (
    <DomainListCard
      title={feed.name}
      badges={
        <>
          <Badge variant={STATUS_BADGE[feed.status]}>
            {formatFeedStatusLabel(feed.status)}
          </Badge>
          <FeedHealthBadge feed={feed} />
        </>
      }
      description={feed.url}
      actions={
        <>
          <TestFeedButton feed={feed} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.onEdit(feed)}
            aria-label={`Edit ${feed.name}`}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.onDelete(feed)}
            aria-label={`Delete ${feed.name}`}
          >
            Delete
          </Button>
        </>
      }
    >
      <DomainListField label="Notes">
        {feed.notes ? (
          <span className="break-words">{feed.notes}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DomainListField>
      <DomainListField label="Fetch failures">
        <FeedFetchFailuresValue feed={feed} />
      </DomainListField>
      <DomainListField label="Reason">
        {feed.status === "failed" && feed.lastTestError ? (
          <span className="break-words" title={feed.lastTestError}>
            {feed.lastTestError}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </DomainListField>
      <DomainListField label="Updated">
        <span>{formatUpdatedAt(feed.updatedAt)}</span>
      </DomainListField>
    </DomainListCard>
  );
}
