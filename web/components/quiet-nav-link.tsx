import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Quiet shell back/inspect nav links — min 44px tap height (`min-h-11`) +
 * comfortable horizontal padding (`px-3`). Feature 05 Task 3 sizing pin.
 */
export const quietNavLinkClassName =
  "inline-flex items-center min-h-11 px-3 text-sm text-muted-foreground hover:text-foreground hover:underline";

export function QuietNavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(quietNavLinkClassName, className)}>
      {children}
    </Link>
  );
}
