"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOOKBACK } from "@newsletter/shared/client";
import {
  createNewsletterAction,
  type NewsletterActionResult,
} from "@/app/(protected)/admin/newsletters/actions";
import {
  DEFAULT_NEWSLETTER_DATE_RANGE,
  DEFAULT_NEWSLETTER_NEWS_ITEMS,
  NewsletterBasicsFields,
} from "@/components/newsletters/newsletter-basics-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

type NewsletterFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Create-only dialog — Basics fields, then redirect to the edit page. */
export function NewsletterFormDialog({ open, onOpenChange }: NewsletterFormDialogProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<NewsletterActionResult | null, FormData>(
    createNewsletterAction,
    null,
  );

  useEffect(() => {
    if (!open || !state) return;
    if (state.ok) {
      toast.success("Newsletter created");
      onOpenChange(false);
      if (state.newsletterId) {
        router.push(`/admin/newsletters/${state.newsletterId}`);
      }
    } else {
      toast.error(state.error);
    }
  }, [state, open, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,calc(100dvh-2rem))] flex-col gap-4 overflow-y-auto"
        data-testid="newsletter-form-dialog-content"
      >
        <DialogHeader>
          <DialogTitle>Add newsletter</DialogTitle>
          <DialogDescription>
            Define what to generate — name, topics, disliked topics, audience, news items, date
            range, and lookback.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <NewsletterBasicsFields
            idPrefix="create"
            disabled={isPending}
            defaultName=""
            defaultTopics={[]}
            defaultDislikedTopics={[]}
            defaultAudience=""
            defaultNewsItems={String(DEFAULT_NEWSLETTER_NEWS_ITEMS)}
            defaultDateRange={DEFAULT_NEWSLETTER_DATE_RANGE}
            defaultLookback={String(DEFAULT_LOOKBACK)}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Add newsletter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
