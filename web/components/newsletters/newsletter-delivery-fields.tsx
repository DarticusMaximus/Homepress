"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import type { Newsletter } from "@newsletter/shared";
import { ChipInput } from "@/components/newsletters/chip-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

export type NewsletterDeliveryFieldsProps = {
  idPrefix: string;
  newsletter: Pick<Newsletter, "$id" | "recipientEmails" | "autoEmail" | "autoRss">;
  disabled?: boolean;
  /** Public app base URL from server (`APP_PUBLIC_URL`). Null/undefined → guidance copy. */
  appPublicUrl?: string | null;
};

/**
 * Delivery field group — recipients, auto-email / auto-RSS toggles, RSS URL copy.
 */
export function NewsletterDeliveryFields({
  idPrefix,
  newsletter,
  disabled = false,
  appPublicUrl,
}: NewsletterDeliveryFieldsProps) {
  const [recipientEmails, setRecipientEmails] = useState<string[]>(
    newsletter.recipientEmails ?? [],
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Delivery</h3>

      <input
        type="hidden"
        name="recipientEmailsJson"
        value={JSON.stringify(recipientEmails)}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-recipients`}>Recipients</Label>
        <ChipInput
          id={`${idPrefix}-recipients`}
          value={recipientEmails}
          onChange={setRecipientEmails}
          placeholder="Add an email and press Enter"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Email addresses for this newsletter’s family inbox list. Not a public signup — no
          unsubscribe flow.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={`auto-email-${newsletter.$id}`}
          type="checkbox"
          name="autoEmail"
          value="true"
          className="size-4 rounded border"
          defaultChecked={newsletter.autoEmail}
          disabled={disabled}
        />
        <Label htmlFor={`auto-email-${newsletter.$id}`}>Auto-email</Label>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={`auto-rss-${newsletter.$id}`}
          type="checkbox"
          name="autoRss"
          value="true"
          className="size-4 rounded border"
          defaultChecked={newsletter.autoRss}
          disabled={disabled}
        />
        <Label htmlFor={`auto-rss-${newsletter.$id}`}>Auto-RSS</Label>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-rss-feed-url`}>RSS feed URL</Label>
        {appPublicUrl ? (
          <>
            <div className="flex gap-2">
              <Input
                id={`${idPrefix}-rss-feed-url`}
                className="font-mono"
                readOnly
                value={`${appPublicUrl}/rss/${newsletter.$id}.xml`}
                onFocus={(event) => event.target.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Copy RSS feed URL"
                onClick={() => {
                  const feedUrl = `${appPublicUrl}/rss/${newsletter.$id}.xml`;
                  void navigator.clipboard.writeText(feedUrl).then(
                    () => toast.success("Feed URL copied"),
                    () => toast.error("Could not copy feed URL"),
                  );
                }}
              >
                <Copy />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stable public feed URL. Returns 404 until the first issue is published.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Set APP_PUBLIC_URL to show the public RSS feed URL.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Defaults off while tuning. Auto-email and auto-RSS are independent; when enabled, they
        run after a successful generate.
      </p>
    </div>
  );
}
