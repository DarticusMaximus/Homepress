import { Client, Databases } from "node-appwrite";
import {
  DATABASE_ID,
  FEEDS_COLLECTION_ID,
  FEED_UNHEALTHY_THRESHOLD,
  type FeedOperationalHealth,
} from "../schema/declarations";
import type { FeedFailure } from "../pipeline/types";
import { type Feed } from "./types";
import { listFeeds } from "./repository";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

/** Truncation cap for `lastFetchError`, matching `recordFeedTestResult`. */
const LAST_FETCH_ERROR_MAX = 1000;

export interface ApplyFeedFetchOutcomesInput {
  /** Exact feed URLs included in this run's fetch (ok attachments used). */
  attemptedFeedUrls: string[];
  /** From FetchResult / run `failedFeeds` JSON. */
  failedFeeds: FeedFailure[];
}

/**
 * Apply fetch-phase outcomes to feed operational-health fields. For each URL in
 * `attemptedFeedUrls` (exact string match on `Feed.url`):
 *
 * - **Failure** (URL appears in `failedFeeds`): increment
 *   `consecutiveFetchFailures`, write truncated `lastFetchError`, and flip
 *   `operationalHealth` to `"unhealthy"` once the threshold is reached.
 * - **Success** (attempted, not in `failedFeeds` — including zero articles):
 *   reset counter to 0, clear `lastFetchError`, set `"healthy"`.
 *
 * Qualification fields (`status` / `lastTestedAt` / `lastTestError`) are never
 * touched. Per-feed update errors are caught and logged so one failing sibling
 * cannot abort the rest. Throws `FeedRepositoryError` only if the initial feed
 * listing fails fatally.
 */
export async function applyFeedFetchOutcomes(
  client: Client,
  input: ApplyFeedFetchOutcomesInput,
): Promise<void> {
  const feeds = await listFeeds(client);

  const feedByUrl = new Map<string, Feed>();
  for (const feed of feeds) {
    feedByUrl.set(feed.url, feed);
  }

  const failureByUrl = new Map<string, FeedFailure>();
  for (const failure of input.failedFeeds) {
    failureByUrl.set(failure.feedUrl, failure);
  }

  const databases = new Databases(client);
  const now = new Date().toISOString();

  // V1 single-worker assumption: the counter increment below is a non-atomic
  // read-modify-write (snapshot from listFeeds → compute +1 → blind
  // updateDocument overwrite). Two concurrent pipeline runs that both fetch
  // the same failing feed would read the same snapshot, compute the same
  // incremented value, and the second write silently overwrites the first —
  // losing one increment. This is acceptable for V1 because the worker
  // processes one run at a time globally. If horizontal scaling is added,
  // switch to optimistic concurrency (compare $updatedAt in a read-check-write
  // loop with retry on mismatch).
  for (const url of input.attemptedFeedUrls) {
    const feed = feedByUrl.get(url);
    if (!feed) {
      continue;
    }

    const failure = failureByUrl.get(url);

    let data: Record<string, unknown>;
    if (failure) {
      const consecutive = (feed.consecutiveFetchFailures ?? 0) + 1;
      const health: FeedOperationalHealth =
        consecutive >= FEED_UNHEALTHY_THRESHOLD ? "unhealthy" : "healthy";
      data = {
        consecutiveFetchFailures: consecutive,
        lastFetchError: failure.errorMessage.slice(0, LAST_FETCH_ERROR_MAX),
        operationalHealth: health,
        lastFetchAt: now,
        updatedAt: now,
      };
    } else {
      data = {
        consecutiveFetchFailures: 0,
        operationalHealth: "healthy" as const,
        lastFetchError: "",
        lastFetchAt: now,
        updatedAt: now,
      };
    }

    try {
      await databases.updateDocument({
        databaseId: DATABASE_ID,
        collectionId: FEEDS_COLLECTION_ID,
        documentId: feed.$id,
        data,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error({
        phase: "feed-health-update",
        feedId: feed.$id,
        message: sanitizeAppwriteMessageForLog(message),
      });
    }
  }
}

/**
 * Count feeds whose `operationalHealth` is `"unhealthy"`. Used by the dashboard
 * to surface a dead/flaky-source count without re-querying the database.
 */
export function countUnhealthyFeeds(feeds: Feed[]): number {
  return feeds.filter((f) => f.operationalHealth === "unhealthy").length;
}
