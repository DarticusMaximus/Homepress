"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type PhaseSectionChromeProps = {
  label: string;
  /** When null/unknown, heading is just `label`; when known, `label (n)`. */
  count: number | null;
  children: ReactNode;
  /** Optional subline under the heading (inside the expanded region). */
  subline?: ReactNode;
};

function phaseHeadingText(label: string, count: number | null): string {
  return count === null ? label : `${label} (${count})`;
}

/**
 * Shared Inspect phase/section chrome: independent collapsible, default closed.
 * Selection sections import this in Feature 04 Task 3.
 */
export function PhaseSectionChrome({
  label,
  count,
  children,
  subline,
}: PhaseSectionChromeProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const heading = phaseHeadingText(label, count);

  return (
    <section className="mt-8 space-y-3" aria-label={label}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-md text-left hover:bg-accent/50"
        >
          <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          {subline}
          {children}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
