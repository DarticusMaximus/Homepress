import {
  type FeedStatus,
  type FeedOperationalHealth,
  FEED_UNHEALTHY_THRESHOLD,
} from "../schema/declarations";

export type FeedRepositoryErrorCode =
  "validation" | "duplicate_url" | "attached" | "not_found" | "appwrite";

export class FeedRepositoryError extends Error {
  readonly code: FeedRepositoryErrorCode;

  constructor(code: FeedRepositoryErrorCode, message: string) {
    super(message);
    this.name = "FeedRepositoryError";
    this.code = code;
  }
}

export interface Feed {
  $id: string;
  name: string;
  url: string;
  notes: string;
  status: FeedStatus;
  lastTestedAt: string | null;
  lastTestError: string | null;
  operationalHealth: FeedOperationalHealth;
  consecutiveFetchFailures: number;
  lastFetchError: string;
  lastFetchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedInput {
  name: string;
  url: string;
  notes?: string;
}

export interface UpdateFeedInput {
  name?: string;
  url?: string;
  notes?: string;
}

export type FeedTestResultInput = { status: "ok" } | { status: "failed"; error: string };

export function isFeedUnhealthy(
  feed: Pick<Feed, "operationalHealth" | "consecutiveFetchFailures">,
): boolean {
  return (
    feed.operationalHealth === "unhealthy" ||
    feed.consecutiveFetchFailures >= FEED_UNHEALTHY_THRESHOLD
  );
}
