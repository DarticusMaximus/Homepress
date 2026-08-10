import type { Client } from "node-appwrite";

import { listIssues } from "../runs/issues";
import type { Run } from "../runs/types";

export type DeliveryOutcomeFilter =
  | "all"
  | "any_failure"
  | "email_failed"
  | "rss_failed";

/** Default post-membership page size (Feature 06). */
const DEFAULT_LIMIT = 100;

/**
 * How many eligible issues to request from {@link listIssues} per expand step.
 * Grows the fetch window until enough delivery-attempt rows are collected.
 */
const FETCH_BATCH = 100;

/** Safety cap so a pathological store cannot expand forever. */
const MAX_FETCH_LIMIT = 1000;

/**
 * True when the run has attempted at least one delivery channel
 * (email or RSS status is not still `"none"`).
 */
export function hasDeliveryAttempt(run: Run): boolean {
  return run.emailDeliveryStatus !== "none" || run.rssDeliveryStatus !== "none";
}

function matchesOutcome(run: Run, outcome: DeliveryOutcomeFilter): boolean {
  switch (outcome) {
    case "all":
      return true;
    case "any_failure":
      return run.emailDeliveryStatus === "failed" || run.rssDeliveryStatus === "failed";
    case "email_failed":
      return run.emailDeliveryStatus === "failed";
    case "rss_failed":
      return run.rssDeliveryStatus === "failed";
  }
}

/**
 * Lists eligible issues that have at least one delivery attempt.
 * Starts from {@link listIssues} (completed + non-empty draft checkpoint,
 * already sorted), then keeps only runs with a delivery attempt and applies
 * the optional outcome filter in memory.
 *
 * `limit` applies to the **post-membership** (and outcome-filtered) result.
 * Never-attempted issues can outnumber delivery attempts in the newest
 * slice, so this expands the {@link listIssues} fetch window in batches
 * until enough matching rows are collected or the underlying list is
 * exhausted.
 */
export async function listDeliveryIssues(
  client: Client,
  opts?: {
    newsletterId?: string;
    outcome?: DeliveryOutcomeFilter;
    limit?: number; // default 100
  },
): Promise<Run[]> {
  const outcome = opts?.outcome ?? "all";
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const newsletterId = opts?.newsletterId;

  // Fetch at least one batch (and at least `limit`) so a full page of matches
  // does not require an extra round-trip when membership is dense.
  let fetchLimit = Math.min(Math.max(limit, FETCH_BATCH), MAX_FETCH_LIMIT);

  for (;;) {
    // listIssues already sorts (endedAt ?? startedAt desc, then $id desc).
    const issues = await listIssues(client, {
      newsletterId,
      limit: fetchLimit,
    });

    const filtered = issues.filter(
      (run) => hasDeliveryAttempt(run) && matchesOutcome(run, outcome),
    );

    const exhausted = issues.length < fetchLimit;
    const atCap = fetchLimit >= MAX_FETCH_LIMIT;
    if (filtered.length >= limit || exhausted || atCap) {
      return filtered.slice(0, limit);
    }

    fetchLimit = Math.min(fetchLimit + FETCH_BATCH, MAX_FETCH_LIMIT);
  }
}
