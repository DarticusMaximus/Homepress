"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import type { Newsletter } from "@newsletter/shared";
import { PROMPT_PLACEHOLDERS } from "@newsletter/shared/client";
import {
  updateNewsletterAction,
  type NewsletterActionResult,
} from "@/app/(protected)/newsletters/actions";
import { NewsletterBasicsFields } from "@/components/newsletters/newsletter-basics-fields";
import { NewsletterDeliveryFields } from "@/components/newsletters/newsletter-delivery-fields";
import {
  NewsletterFeedsSection,
  type NewsletterFeedContext,
} from "@/components/newsletters/newsletter-feeds-section";
import { NewsletterModelOverrideFields } from "@/components/newsletters/newsletter-model-override-fields";
import { ScheduleFields } from "@/components/schedules/schedule-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";

export type NewsletterEditFormProps = {
  newsletter: Newsletter;
  feeds: NewsletterFeedContext;
  /** Public app base URL from server (`APP_PUBLIC_URL`). Null/undefined → guidance copy. */
  appPublicUrl?: string | null;
};

const TAB_PANEL_CLASS = "mt-4 space-y-4 data-[state=inactive]:hidden";

type EditTab = "basics" | "advanced" | "schedule" | "delivery" | "feeds";

/**
 * Dedicated newsletter edit page form — tabbed field groups + force-mounted panels + Cancel/Save.
 * Inactive tabs stay in the DOM so a single Save submits the full definition FormData.
 */
export function NewsletterEditForm({
  newsletter,
  feeds,
  appPublicUrl,
}: NewsletterEditFormProps) {
  const [activeTab, setActiveTab] = useState<EditTab>("basics");
  const [state, formAction, isPending] = useActionState<NewsletterActionResult | null, FormData>(
    updateNewsletterAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Newsletter updated");
    } else {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/newsletters"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Back to Newsletters
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit {newsletter.name}</h1>
        <p className="text-sm text-muted-foreground">
          Update the definition, schedule, delivery, and feeds for this newsletter.
        </p>
      </div>

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="newsletterId" value={newsletter.$id} />

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as EditTab)}
        >
          <div className="w-full overflow-x-auto">
            <TabsList className="w-full min-w-max justify-start">
              <TabsTrigger value="basics" onClick={() => setActiveTab("basics")}>
                Basics
              </TabsTrigger>
              <TabsTrigger value="advanced" onClick={() => setActiveTab("advanced")}>
                Advanced
              </TabsTrigger>
              <TabsTrigger value="schedule" onClick={() => setActiveTab("schedule")}>
                Schedule
              </TabsTrigger>
              <TabsTrigger value="delivery" onClick={() => setActiveTab("delivery")}>
                Delivery
              </TabsTrigger>
              <TabsTrigger value="feeds" onClick={() => setActiveTab("feeds")}>
                Feeds
              </TabsTrigger>
            </TabsList>
          </div>

          {/* forceMount keeps inactive panels in the DOM so cross-tab FormData Submit works. */}
          <TabsContent value="basics" forceMount className={TAB_PANEL_CLASS}>
            <NewsletterBasicsFields
              idPrefix="edit"
              disabled={isPending}
              defaultName={newsletter.name}
              defaultTopics={newsletter.topics}
              defaultDislikedTopics={newsletter.dislikedTopics}
              defaultAudience={newsletter.audience}
              defaultNewsItems={String(newsletter.newsItems)}
              defaultDateRange={newsletter.dateRange}
              defaultLookback={String(newsletter.lookback)}
            />
          </TabsContent>

          <TabsContent value="advanced" forceMount className={TAB_PANEL_CLASS}>
            <NewsletterModelOverrideFields
              idPrefix="edit"
              newsletter={newsletter}
              disabled={isPending}
            />

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Drafter prompt</h3>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PLACEHOLDERS.drafter.map((name) => (
                  <Badge key={name} variant="secondary">
                    {`{${name}}`}
                  </Badge>
                ))}
              </div>
              <Label htmlFor="edit-drafterPrompt">Override template</Label>
              <Textarea
                id="edit-drafterPrompt"
                name="drafterPrompt"
                className="min-h-32 font-mono text-sm"
                rows={10}
                defaultValue={newsletter.drafterPrompt}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the global Drafter template on Prompts. Placeholders:{" "}
                {"{newsletter_name}"}, {"{topics}"}, {"{audience}"}, {"{articles_json}"},{" "}
                {"{count}"}.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="schedule" forceMount className={TAB_PANEL_CLASS}>
            <h3 className="text-sm font-semibold">Schedule</h3>
            <ScheduleFields
              idPrefix={newsletter.$id}
              defaultEnabled={newsletter.scheduleEnabled}
              defaultCron={newsletter.scheduleCron}
              defaultTimezone={newsletter.scheduleTimezone}
              disabled={isPending}
            />
          </TabsContent>

          <TabsContent value="delivery" forceMount className={TAB_PANEL_CLASS}>
            <NewsletterDeliveryFields
              idPrefix="edit"
              newsletter={newsletter}
              disabled={isPending}
              appPublicUrl={appPublicUrl}
            />
          </TabsContent>

          <TabsContent value="feeds" forceMount className={TAB_PANEL_CLASS}>
            {/* Attach/detach are immediate actions (type=button); not part of definition Save. */}
            <NewsletterFeedsSection
              newsletterId={newsletter.$id}
              attachedFeeds={feeds.attached}
              eligibleFeeds={feeds.eligible}
            />
          </TabsContent>
        </Tabs>

        {/* Footer stays in normal document flow — always visible across tabs. */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" asChild disabled={isPending}>
            <Link href="/newsletters">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
