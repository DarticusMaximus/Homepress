"use client";

import { useState, useTransition } from "react";
import { savePipelineKnobsSettingsAction } from "@/app/(protected)/settings/actions";
import { SettingsSourceLabel } from "@/components/settings/settings-source-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsPanelData } from "@/lib/settings-panel";
import { toast } from "@/lib/toast";

const UNSET = "__unset__";

export type PipelineKnobsSettingsProps = {
  data: SettingsPanelData;
};

function numberInputValue(gui: number | null): string {
  return gui === null ? "" : String(gui);
}

/** Empty → clear; finite → value; non-empty non-finite → invalid (block Save). */
type OptionalNumberParse =
  | { kind: "empty" }
  | { kind: "value"; value: number }
  | { kind: "invalid" };

function parseOptionalNumber(raw: string): OptionalNumberParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { kind: "invalid" };
  return { kind: "value", value: n };
}

function parseOptionalInteger(raw: string): OptionalNumberParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return { kind: "invalid" };
  return { kind: "value", value: n };
}

function parsedOrNull(parsed: OptionalNumberParse): number | null {
  return parsed.kind === "value" ? parsed.value : null;
}

/**
 * Pipeline & delivery knobs — score, similarity, RSS last-N, drafter effort/tokens.
 */
export function PipelineKnobsSettings({ data }: PipelineKnobsSettingsProps) {
  const [scoreThreshold, setScoreThreshold] = useState(numberInputValue(data.scoreThreshold));
  const [crossRunSimilarityThreshold, setCrossRunSimilarityThreshold] = useState(
    numberInputValue(data.crossRunSimilarityThreshold),
  );
  const [rssFeedMaxItems, setRssFeedMaxItems] = useState(
    numberInputValue(data.rssFeedMaxItems),
  );
  const [drafterReasoningEffort, setDrafterReasoningEffort] = useState(
    data.drafterReasoningEffort,
  );
  const [drafterMaxCompletionTokens, setDrafterMaxCompletionTokens] = useState(
    numberInputValue(data.drafterMaxCompletionTokens),
  );

  const [isSaving, startSaveTransition] = useTransition();

  return (
    <section
      className="mb-6 rounded-lg border border-border bg-card p-4"
      aria-label="Pipeline & delivery knobs"
      data-testid="pipeline-knobs-settings"
    >
      <h2 className="text-lg font-semibold">Pipeline & delivery knobs</h2>

      <div className="mt-4 grid gap-4 max-w-2xl">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-score-threshold">Score threshold</Label>
          <Input
            id="settings-score-threshold"
            type="text"
            inputMode="decimal"
            className="w-full max-w-40"
            value={scoreThreshold}
            placeholder={String(data.resolved.scoreThreshold.value)}
            disabled={isSaving}
            onChange={(e) => setScoreThreshold(e.target.value)}
          />
          <SettingsSourceLabel source={data.resolved.scoreThreshold.source} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-cross-run-similarity">Cross-run similarity</Label>
          <Input
            id="settings-cross-run-similarity"
            type="text"
            inputMode="decimal"
            className="w-full max-w-40"
            value={crossRunSimilarityThreshold}
            placeholder={String(data.resolved.crossRunSimilarityThreshold.value)}
            disabled={isSaving}
            onChange={(e) => setCrossRunSimilarityThreshold(e.target.value)}
          />
          <SettingsSourceLabel source={data.resolved.crossRunSimilarityThreshold.source} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-rss-feed-max-items">RSS last-N items</Label>
          <Input
            id="settings-rss-feed-max-items"
            type="text"
            inputMode="numeric"
            className="w-full max-w-40"
            value={rssFeedMaxItems}
            placeholder={String(data.resolved.rssFeedMaxItems.value)}
            disabled={isSaving}
            onChange={(e) => setRssFeedMaxItems(e.target.value)}
          />
          <SettingsSourceLabel source={data.resolved.rssFeedMaxItems.source} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-drafter-reasoning-effort">Drafter reasoning effort</Label>
          <Select
            value={drafterReasoningEffort === "" ? UNSET : drafterReasoningEffort}
            disabled={isSaving}
            onValueChange={(value) =>
              setDrafterReasoningEffort(value === UNSET ? "" : value)
            }
          >
            <SelectTrigger id="settings-drafter-reasoning-effort" className="w-44">
              <SelectValue placeholder="Use fallback" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Use fallback</SelectItem>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
            </SelectContent>
          </Select>
          <SettingsSourceLabel source={data.resolved.drafterReasoningEffort.source} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-drafter-max-completion-tokens">
            Drafter max completion tokens
          </Label>
          <Input
            id="settings-drafter-max-completion-tokens"
            type="text"
            inputMode="numeric"
            className="w-full max-w-40"
            value={drafterMaxCompletionTokens}
            placeholder={String(data.resolved.drafterMaxCompletionTokens.value)}
            disabled={isSaving}
            onChange={(e) => setDrafterMaxCompletionTokens(e.target.value)}
          />
          <SettingsSourceLabel source={data.resolved.drafterMaxCompletionTokens.source} />
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          onClick={() => {
            startSaveTransition(async () => {
              const scoreParsed = parseOptionalNumber(scoreThreshold);
              const similarityParsed = parseOptionalNumber(crossRunSimilarityThreshold);
              const rssParsed = parseOptionalInteger(rssFeedMaxItems);
              const tokensParsed = parseOptionalInteger(drafterMaxCompletionTokens);

              const invalidFields: string[] = [];
              if (scoreParsed.kind === "invalid") invalidFields.push("Score threshold");
              if (similarityParsed.kind === "invalid") {
                invalidFields.push("Cross-run similarity");
              }
              if (rssParsed.kind === "invalid") invalidFields.push("RSS last-N items");
              if (tokensParsed.kind === "invalid") {
                invalidFields.push("Drafter max completion tokens");
              }
              if (invalidFields.length > 0) {
                toast.error(
                  `${invalidFields.join(", ")} must be a valid number, or blank to clear`,
                );
                return;
              }

              const result = await savePipelineKnobsSettingsAction({
                scoreThreshold: parsedOrNull(scoreParsed),
                crossRunSimilarityThreshold: parsedOrNull(similarityParsed),
                rssFeedMaxItems: parsedOrNull(rssParsed),
                drafterReasoningEffort,
                drafterMaxCompletionTokens: parsedOrNull(tokensParsed),
              });
              if (result.ok) {
                toast.success("Pipeline knobs saved");
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Changes apply on the next run / send / request.
      </p>
    </section>
  );
}
