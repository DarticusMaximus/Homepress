"use client";

import type { Newsletter } from "@newsletter/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MODEL_OVERRIDE_FIELDS = [
  { key: "taggerModel", label: "Tagger" },
  { key: "scorerModel", label: "Scorer" },
  { key: "drafterModel", label: "Drafter" },
  { key: "embedderModel", label: "Embedder" },
] as const;

export type NewsletterModelOverrideFieldsProps = {
  idPrefix: string;
  disabled?: boolean;
  /** When omitted (create), all fields default to blank. */
  newsletter?: Pick<
    Newsletter,
    "taggerModel" | "scorerModel" | "drafterModel" | "embedderModel"
  > | null;
};

/**
 * Per-newsletter model ID overrides. Blank = use global defaults from Prompts.
 * Does not include Drafter prompt UI (Feature 03).
 */
export function NewsletterModelOverrideFields({
  idPrefix,
  disabled = false,
  newsletter,
}: NewsletterModelOverrideFieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Model overrides</h3>
      {MODEL_OVERRIDE_FIELDS.map((field) => (
        <div key={field.key} className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
          <Input
            id={`${idPrefix}-${field.key}`}
            name={field.key}
            type="text"
            className="font-mono"
            defaultValue={newsletter?.[field.key] ?? ""}
            placeholder="Use global default"
            disabled={disabled}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Leave blank to use the global default from the Prompts page. Changes apply on the next
        run.
      </p>
    </div>
  );
}
