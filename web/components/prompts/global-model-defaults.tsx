"use client";

import { useState, useTransition } from "react";
import { DEFAULT_MODELS } from "@newsletter/shared/client";
import { updateGlobalModelDefaultsAction } from "@/app/(protected)/prompts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

export type GlobalModelDefaultsProps = {
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  embedderModel: string;
};

const FIELDS = [
  {
    key: "taggerModel" as const,
    label: "Tagger",
    id: "global-model-tagger",
    placeholder: DEFAULT_MODELS.tagger,
  },
  {
    key: "scorerModel" as const,
    label: "Scorer",
    id: "global-model-scorer",
    placeholder: DEFAULT_MODELS.scorer,
  },
  {
    key: "drafterModel" as const,
    label: "Drafter",
    id: "global-model-drafter",
    placeholder: DEFAULT_MODELS.drafter,
  },
  {
    key: "embedderModel" as const,
    label: "Embedder",
    id: "global-model-embedder",
    placeholder: DEFAULT_MODELS.embedder,
  },
] as const;

export function GlobalModelDefaults({
  taggerModel,
  scorerModel,
  drafterModel,
  embedderModel,
}: GlobalModelDefaultsProps) {
  const [values, setValues] = useState({
    taggerModel,
    scorerModel,
    drafterModel,
    embedderModel,
  });
  const [isSaving, startSaveTransition] = useTransition();

  return (
    <section
      className="mb-6 rounded-lg border border-border bg-card p-4"
      aria-label="Default models"
      data-testid="global-model-defaults"
    >
      <h2 className="text-lg font-semibold">Default models</h2>

      <div className="mt-4 grid gap-4 max-w-2xl">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={field.id}>{field.label}</Label>
            <Input
              id={field.id}
              type="text"
              className="font-mono w-full"
              value={values[field.key]}
              placeholder={field.placeholder}
              disabled={isSaving}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [field.key]: e.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          onClick={() => {
            startSaveTransition(async () => {
              const result = await updateGlobalModelDefaultsAction(values);
              if (result.ok) {
                setValues({
                  taggerModel: result.settings.taggerModel,
                  scorerModel: result.settings.scorerModel,
                  drafterModel: result.settings.drafterModel,
                  embedderModel: result.settings.embedderModel,
                });
                toast.success("Default models saved");
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          {isSaving ? "Saving…" : "Save models"}
        </Button>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Leave blank to fall through to env (TAGGER_MODEL, SCORER_MODEL, DRAFTER_MODEL, EMBED_MODEL)
        then the built-in default. Changes apply on the next run.
      </p>
    </section>
  );
}
