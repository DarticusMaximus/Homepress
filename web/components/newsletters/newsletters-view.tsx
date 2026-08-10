"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Newsletter } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import type { ActiveRunState } from "@/components/newsletters/generate-newsletter-button";
import type { NewsletterFeedContext } from "@/components/newsletters/newsletter-feeds-section";
import { NewsletterFormDialog } from "@/components/newsletters/newsletter-form-dialog";
import { NewslettersTable } from "@/components/newsletters/newsletters-table";

type NewslettersViewProps = {
  newsletters: Newsletter[];
  total: number;
  feedContextByNewsletter: Record<string, NewsletterFeedContext>;
  activeRunByNewsletterId: Record<string, ActiveRunState>;
};

export function NewslettersView({
  newsletters,
  total,
  feedContextByNewsletter,
  activeRunByNewsletterId,
}: NewslettersViewProps) {
  const [createOpen, setCreateOpen] = useState(false);

  if (total === 0) {
    return (
      <>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Newsletters</h1>
            <p className="text-sm text-muted-foreground">
              Definitions for what to generate — feeds attach next.
            </p>
          </div>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            Add newsletter
          </Button>
        </div>

        <section
          aria-label="Newsletters list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">
            No newsletters yet. Add your first definition to get started.
          </p>
          <Button type="button" className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus />
            Add newsletter
          </Button>
        </section>

        {createOpen && <NewsletterFormDialog open onOpenChange={setCreateOpen} />}
      </>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Newsletters</h1>
          <p className="text-sm text-muted-foreground">
            Definitions for what to generate — feeds attach next.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus />
          Add newsletter
        </Button>
      </div>

      <section aria-label="Newsletters list" className="mt-8">
        <NewslettersTable
          newsletters={newsletters}
          feedContextByNewsletter={feedContextByNewsletter}
          activeRunByNewsletterId={activeRunByNewsletterId}
        />
      </section>

      {createOpen && <NewsletterFormDialog open onOpenChange={setCreateOpen} />}
    </>
  );
}
