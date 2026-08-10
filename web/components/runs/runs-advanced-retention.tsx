"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { RetentionControls } from "@/components/runs/retention-controls";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type RunsAdvancedRetentionProps = {
  retentionDays: number;
};

/**
 * Collapsed-by-default Advanced pocket wrapping run retention controls.
 * Content unmounts when closed (no forceMount) so controls stay out of the DOM.
 */
export function RunsAdvancedRetention({ retentionDays }: RunsAdvancedRetentionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        type="button"
        className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        Advanced
        <ChevronDownIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <RetentionControls retentionDays={retentionDays} />
      </CollapsibleContent>
    </Collapsible>
  );
}
