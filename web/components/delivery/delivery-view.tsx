"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DeliveryOutcomeFilter, Newsletter, Run } from "@newsletter/shared";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildDeliveryHref } from "@/components/delivery/delivery-url";

const ALL_VALUE = "__all__";

const OUTCOME_OPTIONS: { value: DeliveryOutcomeFilter; label: string }[] = [
  { value: "all", label: "All outcomes" },
  { value: "any_failure", label: "Any failure" },
  { value: "email_failed", label: "Email failed" },
  { value: "rss_failed", label: "RSS failed" },
];

type DeliveryViewProps = {
  issues: Run[];
  newsletters: Newsletter[];
  currentNewsletterId: string;
  currentOutcome: DeliveryOutcomeFilter | "";
  total: number;
  page: number;
  totalPages: number;
  loadError: string | null;
  /** Server-rendered ResponsiveList (table + cards); not wrapped when empty. */
  list: ReactNode;
};

export function DeliveryView({
  issues,
  newsletters,
  currentNewsletterId,
  currentOutcome,
  total,
  page,
  totalPages,
  loadError,
  list,
}: DeliveryViewProps) {
  const router = useRouter();
  const outcome: DeliveryOutcomeFilter = currentOutcome || "all";

  const onNewsletterChange = (value: string) => {
    router.push(
      buildDeliveryHref({
        page: 1,
        newsletterId: value === ALL_VALUE ? undefined : value,
        outcome,
      }),
    );
  };

  const onOutcomeChange = (value: string) => {
    router.push(
      buildDeliveryHref({
        page: 1,
        newsletterId: currentNewsletterId || undefined,
        outcome: value === ALL_VALUE ? "all" : (value as DeliveryOutcomeFilter),
      }),
    );
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Delivery</h1>
        <p className="text-sm text-muted-foreground">
          Email and RSS outcomes for issues that have been sent or published — diagnose delivery
          failures here.
        </p>
      </div>

      <section aria-label="Delivery filters" className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delivery-filter-newsletter">Newsletter</Label>
          <Select value={currentNewsletterId || ALL_VALUE} onValueChange={onNewsletterChange}>
            <SelectTrigger id="delivery-filter-newsletter" className="w-60">
              <SelectValue placeholder="All newsletters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All newsletters</SelectItem>
              {newsletters.map((newsletter) => (
                <SelectItem key={newsletter.$id} value={newsletter.$id}>
                  {newsletter.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delivery-filter-outcome">Outcome</Label>
          <Select
            value={outcome === "all" ? ALL_VALUE : outcome}
            onValueChange={onOutcomeChange}
          >
            <SelectTrigger id="delivery-filter-outcome" className="w-44">
              <SelectValue placeholder="All outcomes" />
            </SelectTrigger>
            <SelectContent>
              {OUTCOME_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value === "all" ? ALL_VALUE : opt.value}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {loadError ? null : total === 0 ? (
        <section
          aria-label="Delivery list"
          className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center"
        >
          <p className="text-sm text-muted-foreground">
            Delivery rows appear after you Send, Publish, or auto-deliver an issue. Use Issues to
            send or publish, or enable Delivery toggles on a newsletter.
          </p>
        </section>
      ) : (
        <section aria-label="Delivery list" className="mt-8">
          {list}

          <p className="mt-2 text-xs text-muted-foreground">
            Showing {issues.length} of {total} issue{total === 1 ? "" : "s"}
            {page > 1 || totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}.
          </p>
        </section>
      )}
    </>
  );
}
