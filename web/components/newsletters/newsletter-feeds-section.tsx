"use client";

import { useState, useTransition } from "react";
import type { AttachmentRecord, Feed, FeedStatus } from "@newsletter/shared";
import {
  attachFeedToNewsletter,
  detachFeedFromNewsletter,
} from "@/app/(protected)/newsletters/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { formatFeedStatusLabel } from "@/lib/status-labels";

const STATUS_BADGE: Record<FeedStatus, "default" | "secondary" | "destructive"> = {
  untested: "secondary",
  ok: "default",
  failed: "destructive",
};

export type NewsletterFeedContext = {
  attached: AttachmentRecord[];
  eligible: Feed[];
};

type NewsletterFeedsSectionProps = {
  newsletterId: string;
  attachedFeeds: AttachmentRecord[];
  eligibleFeeds: Feed[];
};

export function NewsletterFeedsSection({
  newsletterId,
  attachedFeeds,
  eligibleFeeds,
}: NewsletterFeedsSectionProps) {
  const [isPending, startTransition] = useTransition();
  const [overrideFeedId, setOverrideFeedId] = useState<string | null>(null);

  const selectedFeedId =
    overrideFeedId && eligibleFeeds.some((feed) => feed.$id === overrideFeedId)
      ? overrideFeedId
      : (eligibleFeeds[0]?.$id ?? "");

  const onAttach = () => {
    if (!selectedFeedId) return;
    const feedId = selectedFeedId;
    startTransition(async () => {
      const result = await attachFeedToNewsletter(newsletterId, feedId);
      if (result.ok) {
        toast.success("Feed attached");
      } else {
        toast.error(result.error);
      }
    });
  };

  const onDetach = (feedId: string) => {
    startTransition(async () => {
      const result = await detachFeedFromNewsletter(newsletterId, feedId);
      if (result.ok) {
        toast.success("Feed detached");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section aria-label="Feeds" className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Feeds</h3>
        <p className="text-xs text-muted-foreground">
          Attach ok feeds to this newsletter; detach anytime. Demoted feeds stay listed here until
          removed.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {attachedFeeds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No feeds attached yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachedFeeds.map((feed) => (
              <li
                key={feed.$id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{feed.feedName}</span>
                    <Badge variant={STATUS_BADGE[feed.feedStatus]}>
                      {formatFeedStatusLabel(feed.feedStatus)}
                    </Badge>
                  </div>
                  <span className="truncate text-xs text-muted-foreground" title={feed.feedUrl}>
                    {feed.feedUrl}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onDetach(feed.feedId)}
                >
                  {isPending ? "Working…" : "Detach"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {eligibleFeeds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No ok feeds available to attach. Qualify a feed on the Feeds page first.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="newsletter-feed-attach">Attach a feed</Label>
          <div className="flex gap-2">
            <Select value={selectedFeedId} onValueChange={setOverrideFeedId} disabled={isPending}>
              <SelectTrigger id="newsletter-feed-attach" className="w-full">
                <SelectValue placeholder="Select a feed" />
              </SelectTrigger>
              <SelectContent>
                {eligibleFeeds.map((feed) => (
                  <SelectItem key={feed.$id} value={feed.$id}>
                    {feed.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" disabled={isPending || !selectedFeedId} onClick={onAttach}>
              {isPending ? "Attaching…" : "Attach"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
