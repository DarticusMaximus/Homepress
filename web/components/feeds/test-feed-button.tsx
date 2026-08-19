"use client";

import { useTransition } from "react";
import type { Feed } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import { testFeed } from "@/app/(protected)/admin/feeds/actions";
import { toast } from "@/lib/toast";

type TestFeedButtonProps = {
  feed: Feed;
};

export function TestFeedButton({ feed }: TestFeedButtonProps) {
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const result = await testFeed(feed.$id);
      if (result.ok) {
        toast.success("Feed looks good");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      aria-label={`Test ${feed.name}`}
    >
      {isPending ? "Testing…" : "Test"}
    </Button>
  );
}
