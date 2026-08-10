"use client";

import { useState, useTransition } from "react";
import {
  PROMPT_PLACEHOLDERS,
  PROMPT_ROLES,
  type PromptRole,
  type PromptTemplate,
} from "@newsletter/shared/client";
import {
  resetPromptTemplateAction,
  updatePromptTemplateAction,
} from "@/app/(protected)/prompts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ResetPromptDialog } from "@/components/prompts/reset-prompt-dialog";
import { formatOperatorDateTime } from "@/lib/format-operator-datetime";
import { toast } from "@/lib/toast";

export type PromptsEditorProps = {
  templates: PromptTemplate[];
};

const ROLE_LABELS: Record<PromptRole, string> = {
  tagger: "Tagger",
  scorer: "Scorer",
  drafter: "Drafter",
};

function templatesToDraftMap(templates: PromptTemplate[]): Record<PromptRole, string> {
  const map = {} as Record<PromptRole, string>;
  for (const role of PROMPT_ROLES) {
    map[role] = templates.find((t) => t.role === role)?.body ?? "";
  }
  return map;
}

function templatesToUpdatedAtMap(templates: PromptTemplate[]): Record<PromptRole, string> {
  const map = {} as Record<PromptRole, string>;
  for (const role of PROMPT_ROLES) {
    map[role] = templates.find((t) => t.role === role)?.updatedAt ?? "";
  }
  return map;
}

function formatUpdatedAt(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatOperatorDateTime(iso);
}

export function PromptsEditor({ templates }: PromptsEditorProps) {
  const [activeRole, setActiveRole] = useState<PromptRole>("tagger");
  const [drafts, setDrafts] = useState<Record<PromptRole, string>>(() =>
    templatesToDraftMap(templates),
  );
  const [updatedAtByRole, setUpdatedAtByRole] = useState<Record<PromptRole, string>>(() =>
    templatesToUpdatedAtMap(templates),
  );
  const [isSaving, startSaveTransition] = useTransition();
  const [isResetting, startResetTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);

  const busy = isSaving || isResetting;

  return (
    <div data-testid="prompts-editor" className="space-y-4">
      <Tabs
        value={activeRole}
        onValueChange={(value) => setActiveRole(value as PromptRole)}
      >
        <TabsList>
          {PROMPT_ROLES.map((role) => (
            <TabsTrigger
              key={role}
              value={role}
              onClick={() => setActiveRole(role)}
            >
              {ROLE_LABELS[role]}
            </TabsTrigger>
          ))}
        </TabsList>

        {PROMPT_ROLES.map((role) => (
          <TabsContent key={role} value={role} className="mt-4 space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                These tokens are substituted at run time with per-run data — do not paste live
                article text into the stored template.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PLACEHOLDERS[role].map((name) => (
                  <Badge key={name} variant="secondary">
                    {`{${name}}`}
                  </Badge>
                ))}
              </div>
            </div>

            <Textarea
              className="min-h-64 font-mono text-sm"
              rows={18}
              value={drafts[role]}
              aria-label={`${ROLE_LABELS[role]} prompt template`}
              onChange={(e) =>
                setDrafts((prev) => ({
                  ...prev,
                  [role]: e.target.value,
                }))
              }
            />

            <p className="text-sm text-muted-foreground">
              Last saved: {formatUpdatedAt(updatedAtByRole[role])}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  const body = drafts[role];
                  startSaveTransition(async () => {
                    const result = await updatePromptTemplateAction(role, body);
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    setDrafts((prev) => ({
                      ...prev,
                      [role]: result.template.body,
                    }));
                    setUpdatedAtByRole((prev) => ({
                      ...prev,
                      [role]: result.template.updatedAt,
                    }));
                    toast.success(`${ROLE_LABELS[role]} prompt saved`);
                    if (result.warnings.length > 0) {
                      toast.warning(
                        `Unknown placeholders kept as literal text: ${result.warnings.join(", ")}`,
                      );
                    }
                  });
                }}
              >
                {isSaving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setResetOpen(true)}
              >
                Reset to default
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <p className="text-sm text-muted-foreground">
        Changes apply to the next run. Runs already in progress keep the values they started with.
      </p>

      <ResetPromptDialog
        role={activeRole}
        open={resetOpen}
        onOpenChange={setResetOpen}
        isPending={isResetting}
        onConfirm={() => {
          const role = activeRole;
          startResetTransition(async () => {
            const result = await resetPromptTemplateAction(role);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setDrafts((prev) => ({
              ...prev,
              [role]: result.template.body,
            }));
            setUpdatedAtByRole((prev) => ({
              ...prev,
              [role]: result.template.updatedAt,
            }));
            toast.success(`${ROLE_LABELS[role]} prompt reset to default`);
            if (result.warnings.length > 0) {
              toast.warning(
                `Unknown placeholders kept as literal text: ${result.warnings.join(", ")}`,
              );
            }
            setResetOpen(false);
          });
        }}
      />
    </div>
  );
}
