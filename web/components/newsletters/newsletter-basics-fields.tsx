"use client";

import { useState } from "react";
import type { NewsletterDateRange } from "@newsletter/shared";
import { ChipInput } from "@/components/newsletters/chip-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NEWSLETTER_DATE_RANGE_OPTIONS: { value: NewsletterDateRange; label: string }[] = [
  { value: "yesterday", label: "Yesterday" },
  { value: "last_3_days", label: "Last 3 days" },
  { value: "last_week", label: "Last week" },
  { value: "all", label: "All" },
];

export const DEFAULT_NEWSLETTER_NEWS_ITEMS = 16;
export const DEFAULT_NEWSLETTER_DATE_RANGE: NewsletterDateRange = "yesterday";

export type NewsletterBasicsFieldsProps = {
  /** Prefix for control ids (e.g. `create`, `edit`, or a newsletter id). */
  idPrefix: string;
  disabled?: boolean;
  defaultName?: string;
  defaultTopics?: string[];
  defaultDislikedTopics?: string[];
  defaultAudience?: string;
  defaultNewsItems?: string;
  defaultDateRange?: NewsletterDateRange;
  defaultLookback?: string;
};

/**
 * Shared Basics field group — name, topics, disliked topics, audience, item count,
 * date range, lookback. Owns chip state and emits `topicsJson` / `dislikedTopicsJson`.
 */
export function NewsletterBasicsFields({
  idPrefix,
  disabled = false,
  defaultName = "",
  defaultTopics = [],
  defaultDislikedTopics = [],
  defaultAudience = "",
  defaultNewsItems = String(DEFAULT_NEWSLETTER_NEWS_ITEMS),
  defaultDateRange = DEFAULT_NEWSLETTER_DATE_RANGE,
  defaultLookback,
}: NewsletterBasicsFieldsProps) {
  const [topics, setTopics] = useState<string[]>(defaultTopics);
  const [dislikedTopics, setDislikedTopics] = useState<string[]>(defaultDislikedTopics);

  return (
    <>
      <input type="hidden" name="topicsJson" value={JSON.stringify(topics)} />
      <input type="hidden" name="dislikedTopicsJson" value={JSON.stringify(dislikedTopics)} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          defaultValue={defaultName}
          required
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-topics`}>Topics</Label>
        <ChipInput
          id={`${idPrefix}-topics`}
          value={topics}
          onChange={setTopics}
          placeholder="Add a topic and press Enter"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-disliked`}>Disliked topics</Label>
        <ChipInput
          id={`${idPrefix}-disliked`}
          value={dislikedTopics}
          onChange={setDislikedTopics}
          placeholder="Add a disliked topic and press Enter"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-audience`}>Audience</Label>
        <Textarea
          id={`${idPrefix}-audience`}
          name="audience"
          defaultValue={defaultAudience}
          disabled={disabled}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Short free-text for voice / reader needs (not a subscriber list; no presets).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-items`}>Item count</Label>
        <Input
          id={`${idPrefix}-items`}
          name="newsItems"
          type="number"
          min={1}
          max={100}
          defaultValue={defaultNewsItems}
          required
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-range`}>Date range</Label>
        <Select name="dateRange" defaultValue={defaultDateRange} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-range`} className="w-full">
            <SelectValue placeholder="Select a date range" />
          </SelectTrigger>
          <SelectContent>
            {NEWSLETTER_DATE_RANGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-lookback`}>Lookback</Label>
        <Input
          id={`${idPrefix}-lookback`}
          name="lookback"
          type="number"
          min={0}
          max={10}
          defaultValue={defaultLookback}
          required
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          How many recent completed issues to suppress similar topics against. Set to 0 to turn
          cross-run suppression off.
        </p>
      </div>
    </>
  );
}
