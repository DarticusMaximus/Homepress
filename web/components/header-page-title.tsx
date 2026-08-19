"use client";

import { usePathname } from "next/navigation";
import { pageTitleForPath } from "@/lib/page-title";

/** Route title for the sticky protected-shell header. */
export function HeaderPageTitle() {
  const pathname = usePathname();
  return <span className="text-sm font-medium">{pageTitleForPath(pathname)}</span>;
}
