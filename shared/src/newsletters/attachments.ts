import { Client, Databases, ID, Query } from "node-appwrite";
import { DATABASE_ID, NEWSLETTER_FEEDS_COLLECTION_ID } from "../schema/declarations";
import { FeedRepositoryError, type Feed, getFeed, listFeeds } from "../feeds";
import { type AttachmentRecord, NewsletterRepositoryError } from "./types";
import { getNewsletter } from "./repository";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

export type { AttachmentRecord } from "./types";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

/** V1 fetch cap — no custom-attribute indexes, so equality filters run in memory. */
const ATTACHMENT_LIST_LIMIT = 100;

interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

function describeError(err: unknown): { message: string; code?: number } {
  if (err && typeof err === "object") {
    const e = err as AppwriteExceptionLike;
    const code = typeof e.code === "number" ? e.code : undefined;
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : String(err);
    return { message, code };
  }
  return { message: String(err) };
}

function wrapAppwriteError(err: unknown, phase: string): never {
  const { message, code } = describeError(err);
  console.error({ phase, code, message: sanitizeAppwriteMessageForLog(message) });
  throw new NewsletterRepositoryError("appwrite", APPWRITE_SAFE_MESSAGE);
}

export async function attachFeed(
  client: Client,
  newsletterId: string,
  feedId: string,
): Promise<AttachmentRecord> {
  // 1. Newsletter must exist (getNewsletter throws NewsletterRepositoryError
  //    "not_found" on 404 and "appwrite" otherwise — let it propagate).
  await getNewsletter(client, newsletterId);

  // 2. Feed must exist. getFeed throws FeedRepositoryError; remap to the
  //    newsletter error domain so callers only see NewsletterRepositoryError.
  let feed: Feed;
  try {
    feed = await getFeed(client, feedId);
  } catch (err) {
    if (err instanceof FeedRepositoryError && err.code === "not_found") {
      throw new NewsletterRepositoryError("not_found", "Feed not found");
    }
    wrapAppwriteError(err, "attach-get-feed");
  }

  // 3. Only feeds with status "ok" may be attached — UI filtering alone is
  //    insufficient, so the gate lives on the write path.
  if (feed.status !== "ok") {
    throw new NewsletterRepositoryError("not_ok", "Only feeds with status ok can be attached");
  }

  const databases = new Databases(client);

  // 4. Duplicate (newsletterId, feedId) check before writing.
  try {
    const existing = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      queries: [
        Query.equal("newsletterId", newsletterId),
        Query.equal("feedId", feedId),
        Query.limit(1),
      ],
    });
    if (existing.documents.length > 0) {
      throw new NewsletterRepositoryError(
        "duplicate_attachment",
        "This feed is already attached to this newsletter",
      );
    }
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    wrapAppwriteError(err, "attach-check-duplicate");
  }

  // 5. Create the junction row.
  const now = new Date().toISOString();
  try {
    const doc = await databases.createDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      documentId: ID.unique(),
      data: {
        newsletterId,
        feedId,
        createdAt: now,
      },
    });
    const created = doc as unknown as Record<string, unknown>;
    const id = created.$id as string;
    return {
      $id: id,
      attachmentId: id,
      newsletterId,
      feedId,
      feedName: feed.name,
      feedUrl: feed.url,
      feedStatus: feed.status,
      createdAt: now,
    };
  } catch (err) {
    wrapAppwriteError(err, "attach-create");
  }
}

export async function detachFeed(
  client: Client,
  newsletterId: string,
  feedId: string,
): Promise<void> {
  const databases = new Databases(client);

  // 1. Find the junction row. Never touch the feed library document.
  let junctionId: string;
  try {
    const result = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      queries: [
        Query.equal("newsletterId", newsletterId),
        Query.equal("feedId", feedId),
        Query.limit(1),
      ],
    });
    if (result.documents.length === 0) {
      throw new NewsletterRepositoryError("not_found", "Attachment not found");
    }
    junctionId = result.documents[0].$id;
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    wrapAppwriteError(err, "detach-find-junction");
  }

  // 2. Delete only the junction row.
  try {
    await databases.deleteDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      documentId: junctionId,
    });
  } catch (err) {
    wrapAppwriteError(err, "detach-delete");
  }
}

export async function listAttachmentsForNewsletter(
  client: Client,
  newsletterId: string,
  opts?: { feedsById?: Map<string, Feed> },
): Promise<AttachmentRecord[]> {
  const databases = new Databases(client);

  // 1. Load this newsletter's junction rows.
  let junctions: Record<string, unknown>[];
  try {
    const result = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      queries: [Query.equal("newsletterId", newsletterId), Query.limit(ATTACHMENT_LIST_LIMIT)],
    });
    junctions = result.documents as unknown as Record<string, unknown>[];
  } catch (err) {
    wrapAppwriteError(err, "list-attachments");
  }

  // 2. Resolve feeds. When the caller passes a pre-built feedsById map (e.g.
  //    the list page's already-loaded library), reuse it and skip the
  //    listFeeds round-trip entirely. Otherwise fall back to a single
  //    listFeeds call. listFeeds throws FeedRepositoryError("appwrite") on
  //    failure — remap to the newsletter error domain. A short list (orphans)
  //    is not an error.
  let feedsById: Map<string, Feed>;
  if (opts?.feedsById) {
    feedsById = opts.feedsById;
  } else {
    try {
      const feeds = await listFeeds(client);
      feedsById = new Map(feeds.map((feed) => [feed.$id, feed]));
    } catch (err) {
      if (err instanceof FeedRepositoryError) {
        wrapAppwriteError(err, "list-attachments-feeds");
      }
      wrapAppwriteError(err, "list-attachments-feeds");
    }
  }

  // 3. Build records, omitting orphans (missing feed) and logging safely.
  const records: AttachmentRecord[] = [];
  for (const junction of junctions) {
    const feedId = junction.feedId as string;
    const feed = feedsById.get(feedId);
    if (!feed) {
      console.error({
        phase: "list-attachments",
        code: "orphan-attachment",
        message: `Attachment references a feed that is no longer in the library`,
      });
      continue;
    }
    const junctionId = junction.$id as string;
    records.push({
      $id: junctionId,
      attachmentId: junctionId,
      newsletterId: junction.newsletterId as string,
      feedId,
      feedName: feed.name,
      feedUrl: feed.url,
      feedStatus: feed.status,
      createdAt: junction.createdAt as string,
    });
  }

  // 4. Stable attach order by createdAt ascending (sorted in TS — no index).
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records;
}
