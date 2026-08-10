import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ResponsiveListProps = {
  table: ReactNode;
  cards: ReactNode;
  className?: string;
};

export function ResponsiveList({
  table,
  cards,
  className,
}: ResponsiveListProps): React.JSX.Element {
  return (
    <div className={cn(className)}>
      <div data-slot="domain-list-table" className="hidden md:block">
        {table}
      </div>
      <div data-slot="domain-list-cards" className="space-y-3 md:hidden">
        {cards}
      </div>
    </div>
  );
}
