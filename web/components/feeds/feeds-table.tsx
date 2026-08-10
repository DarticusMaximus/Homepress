"use client";

import { useState } from "react";
import type { Feed } from "@newsletter/shared";
import { Badge } from "@/components/ui/badge";
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
import { DeleteFeedDialog } from "@/components/feeds/delete-feed-dialog";
import { FeedFetchFailuresValue, FeedHealthBadge } from "@/components/feeds/feed-health";
import { FeedFormDialog } from "@/components/feeds/feed-form-dialog";
import { FeedListCard } from "@/components/feeds/feed-list-card";
import { STATUS_BADGE } from "@/components/feeds/feed-status-badge";
import { TestFeedButton } from "@/components/feeds/test-feed-button";
import { formatFeedStatusLabel } from "@/lib/status-labels";

type FeedRowActionsProps = {
  feed: Feed;
  onEdit: (feed: Feed) => void;
  onDelete: (feed: Feed) => void;
};

function FeedRowActions({ feed, onEdit, onDelete }: FeedRowActionsProps) {
  return (
    <div className="flex justify-end gap-2">
      <TestFeedButton feed={feed} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onEdit(feed)}
        aria-label={`Edit ${feed.name}`}
      >
        Edit
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onDelete(feed)}
        aria-label={`Delete ${feed.name}`}
      >
        Delete
      </Button>
    </div>
  );
}

type FeedsTableProps = {
  feeds: Feed[];
};

export function FeedsTable({ feeds }: FeedsTableProps) {
  const [editFeed, setEditFeed] = useState<Feed | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);

  const onEdit = (feed: Feed) => setEditFeed(feed);
  const onDelete = (feed: Feed) => setDeleteTarget(feed);

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>Fetch failures</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Notes</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {feeds.map((feed) => (
          <TableRow key={feed.$id}>
            <TableCell className="font-medium">{feed.name}</TableCell>
            <TableCell className="max-w-[240px]">
              <span className="block truncate" title={feed.url}>
                {feed.url}
              </span>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_BADGE[feed.status]}>
                {formatFeedStatusLabel(feed.status)}
              </Badge>
            </TableCell>
            <TableCell>
              <FeedHealthBadge feed={feed} />
            </TableCell>
            <TableCell>
              <FeedFetchFailuresValue feed={feed} />
            </TableCell>
            <TableCell className="max-w-[220px]">
              {feed.status === "failed" && feed.lastTestError ? (
                <span className="block truncate" title={feed.lastTestError}>
                  {feed.lastTestError}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="max-w-[200px]">
              {feed.notes ? (
                <span className="block truncate" title={feed.notes}>
                  {feed.notes}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>{formatUpdatedAt(feed.updatedAt)}</TableCell>
            <TableCell className="text-right">
              <FeedRowActions feed={feed} onEdit={onEdit} onDelete={onDelete} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const cards = (
    <>
      {feeds.map((feed) => (
        <FeedListCard key={feed.$id} feed={feed} actions={{ onEdit, onDelete }} />
      ))}
    </>
  );

  return (
    <>
      <ResponsiveList table={table} cards={cards} />

      {editFeed && (
        <FeedFormDialog
          key={editFeed.$id}
          mode="edit"
          feed={editFeed}
          open
          onOpenChange={(open) => {
            if (!open) setEditFeed(null);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteFeedDialog
          key={deleteTarget.$id}
          feed={deleteTarget}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      )}
    </>
  );
}
