import { Client, Databases, ID, Query } from "node-appwrite";
import {
  DATABASE_ID,
  FEEDS_COLLECTION_ID,
  NEWSLETTER_FEEDS_COLLECTION_ID,
  type FeedStatus,
  type FeedOperationalHealth,
} from "../schema/declarations";
import {
  type CreateFeedInput,
  FeedRepositoryError,
  type Feed,
  type FeedTestResultInput,
  type UpdateFeedInput,
} from "./types";
import { validateFeedName, validateFeedNotes, validateFeedUrl } from "./validation";
import { isValidAppwriteDocumentId } from "../util/document-id";
import {
  describeError,
  redactMessageForStorage,
  sanitizeAppwriteMessageForLog,
} from "../util/log-redact";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

/** V1 fetch cap. */
const FEED_LIST_LIMIT = 100;

interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

function wrapAppwriteError(err: unknown, phase: string): never {
  const { message, code } = describeError(err);
  console.error({ phase, code, message: sanitizeAppwriteMessageForLog(message) });
  throw new FeedRepositoryError("appwrite", APPWRITE_SAFE_MESSAGE);
}

function documentToFeed(doc: Record<string, unknown>): Feed {
  return {
    $id: doc.$id as string,
    name: doc.name as string,
    url: doc.url as string,
    notes: (doc.notes as string) ?? "",
    allowPrivateNetwork: Boolean(doc.allowPrivateNetwork),
    status: doc.status as FeedStatus,
    lastTestedAt: (doc.lastTestedAt as string | null) ?? null,
    lastTestError: (doc.lastTestError as string | null) ?? null,
    operationalHealth: (doc.operationalHealth as FeedOperationalHealth | undefined) ?? "healthy",
    consecutiveFetchFailures: (doc.consecutiveFetchFailures as number | undefined) ?? 0,
    lastFetchError: (doc.lastFetchError as string | undefined) ?? "",
    lastFetchAt: (doc.lastFetchAt as string | null | undefined) ?? null,
    createdAt: doc.createdAt as string,
    updatedAt: doc.updatedAt as string,
  };
}

async function assertUrlNotDuplicate(
  databases: Databases,
  url: string,
  excludeId?: string,
): Promise<void> {
  try {
    const result = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      queries: [Query.equal("url", url), Query.limit(1)],
    });
    const existing = result.documents.find(
      (doc) => excludeId === undefined || doc.$id !== excludeId,
    );
    if (existing) {
      throw new FeedRepositoryError("duplicate_url", "A feed with this URL already exists");
    }
  } catch (err) {
    if (err instanceof FeedRepositoryError) throw err;
    wrapAppwriteError(err, "check-duplicate-url");
  }
}

export async function listFeeds(client: Client): Promise<Feed[]> {
  const databases = new Databases(client);
  try {
    const result = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      queries: [Query.limit(FEED_LIST_LIMIT)],
    });
    const feeds = result.documents.map((doc) =>
      documentToFeed(doc as unknown as Record<string, unknown>),
    );
    feeds.sort((a, b) => {
      const byDate = b.updatedAt.localeCompare(a.updatedAt);
      if (byDate !== 0) return byDate;
      return a.$id.localeCompare(b.$id);
    });
    return feeds;
  } catch (err) {
    wrapAppwriteError(err, "list-feeds");
  }
}

export async function createFeed(client: Client, input: CreateFeedInput): Promise<Feed> {
  const name = validateFeedName(input.name);
  const allowPrivateNetwork = input.allowPrivateNetwork === true;
  const url = await validateFeedUrl(input.url, { allowPrivate: allowPrivateNetwork });
  const notes = validateFeedNotes(input.notes);

  const databases = new Databases(client);

  await assertUrlNotDuplicate(databases, url);

  const now = new Date().toISOString();
  const data = {
    name,
    url,
    notes,
    allowPrivateNetwork,
    status: "untested" as const,
    operationalHealth: "healthy" as const,
    consecutiveFetchFailures: 0,
    lastFetchError: "",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const doc = await databases.createDocument({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: ID.unique(),
      data,
    });
    return documentToFeed(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FeedRepositoryError) throw err;
    wrapAppwriteError(err, "create-feed");
  }
}

export async function updateFeed(
  client: Client,
  feedId: string,
  input: UpdateFeedInput,
): Promise<Feed> {
  if (!isValidAppwriteDocumentId(feedId)) {
    throw new FeedRepositoryError("not_found", "Feed not found");
  }
  const databases = new Databases(client);

  let existing: Record<string, unknown>;
  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
    });
    existing = doc as unknown as Record<string, unknown>;
  } catch (err) {
    if (err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404) {
      throw new FeedRepositoryError("not_found", "Feed not found");
    }
    wrapAppwriteError(err, "get-feed");
  }

  const currentUrl = existing.url as string;
  const allowPrivateNetwork =
    input.allowPrivateNetwork !== undefined
      ? input.allowPrivateNetwork === true
      : existing.allowPrivateNetwork === true;
  const name = input.name !== undefined ? validateFeedName(input.name) : (existing.name as string);
  const url =
    input.url !== undefined
      ? await validateFeedUrl(input.url, { allowPrivate: allowPrivateNetwork })
      : currentUrl;
  const notes =
    input.notes !== undefined ? validateFeedNotes(input.notes) : ((existing.notes as string) ?? "");

  const urlChanged = input.url !== undefined && url !== currentUrl;

  if (urlChanged) {
    await assertUrlNotDuplicate(databases, url, feedId);
  }

  const now = new Date().toISOString();
  const data: Record<string, unknown> = {
    name,
    url,
    notes,
    allowPrivateNetwork,
    updatedAt: now,
  };

  if (urlChanged) {
    data.status = "untested";
    data.lastTestedAt = null;
    data.lastTestError = null;
    data.operationalHealth = "healthy";
    data.consecutiveFetchFailures = 0;
    data.lastFetchError = "";
    data.lastFetchAt = null;
  } else {
    data.status = existing.status;
    data.lastTestedAt = existing.lastTestedAt ?? null;
    data.lastTestError = existing.lastTestError ?? null;
    data.operationalHealth = existing.operationalHealth ?? "healthy";
    data.consecutiveFetchFailures = existing.consecutiveFetchFailures ?? 0;
    data.lastFetchError = existing.lastFetchError ?? "";
    data.lastFetchAt = existing.lastFetchAt ?? null;
  }

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
      data,
    });
    return documentToFeed(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FeedRepositoryError) throw err;
    wrapAppwriteError(err, "update-feed");
  }
}

export async function deleteFeed(client: Client, feedId: string): Promise<void> {
  if (!isValidAppwriteDocumentId(feedId)) {
    throw new FeedRepositoryError("not_found", "Feed not found");
  }
  const databases = new Databases(client);

  try {
    // No index on feedId — Query.equal still works unindexed at household scale.
    const attachments = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      queries: [Query.equal("feedId", feedId), Query.limit(1)],
    });
    if (attachments.documents.length > 0) {
      throw new FeedRepositoryError(
        "attached",
        "Detach this feed from all newsletters before deleting",
      );
    }
  } catch (err) {
    if (err instanceof FeedRepositoryError) throw err;
    wrapAppwriteError(err, "check-attached");
  }

  try {
    await databases.deleteDocument({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
    });
  } catch (err) {
    if (err instanceof FeedRepositoryError) throw err;
    wrapAppwriteError(err, "delete-feed");
  }
}

export async function getFeed(client: Client, feedId: string): Promise<Feed> {
  if (!isValidAppwriteDocumentId(feedId)) {
    throw new FeedRepositoryError("not_found", "Feed not found");
  }
  const databases = new Databases(client);
  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
    });
    return documentToFeed(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404) {
      throw new FeedRepositoryError("not_found", "Feed not found");
    }
    wrapAppwriteError(err, "get-feed");
  }
}

export async function recordFeedTestResult(
  client: Client,
  feedId: string,
  result: FeedTestResultInput,
): Promise<void> {
  await getFeed(client, feedId);

  const databases = new Databases(client);
  const now = new Date().toISOString();

  let data: Record<string, unknown>;
  if (result.status === "ok") {
    data = {
      status: "ok",
      lastTestError: "",
      lastTestedAt: now,
      updatedAt: now,
    };
  } else {
    const reason = redactMessageForStorage(result.error.trim(), 200);
    data = {
      status: "failed",
      lastTestError: reason,
      lastTestedAt: now,
      updatedAt: now,
    };
  }

  try {
    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
      data,
    });
  } catch (err) {
    if (err instanceof FeedRepositoryError) throw err;
    wrapAppwriteError(err, "record-feed-test");
  }
}
