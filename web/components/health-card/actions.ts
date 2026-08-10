"use server";

import { revalidatePath } from "next/cache";

/**
 * Server action for the health card's "Re-run" button.
 *
 * Does only `revalidatePath("/")` — the dashboard page (a server component)
 * calls `runHealthCheck(getServerAppwrite())` itself on every render, so the
 * re-render produced by revalidation re-runs the round-trip once with fresh
 * timings. The action must NOT call `runHealthCheck` itself; that would
 * double-count the round-trip per click.
 */
export async function revalidateHealthCheck(): Promise<void> {
  revalidatePath("/");
}
