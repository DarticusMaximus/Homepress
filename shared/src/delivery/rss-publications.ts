import { Client, Databases, Query } from "node-appwrite";
import {
  DATABASE_ID,
  RSS_FEED_MAX_ITEMS,
  RSS_PUBLICATIONS_COLLECTION_ID,
} from "../schema/declarations";

export { RSS_FEED_MAX_ITEMS, RSS_PUBLICATIONS_COLLECTION_ID };

export type RssPublication = {
  $id: string;
  newsletterId: string;
  runId: string;
  title: string;
  htmlBody: string;
  pubDate: string;
  updatedAt: string;
};

export type UpsertRssPublicationInput = {
  newsletterId: string;
  runId: string;
  title: string;
  htmlBody: string;
  pubDate: string;
};

interface AppwriteExceptionLike {
  code?: unknown;
  message?: unknown;
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404;
}

function documentToPublication(doc: Record<string, unknown>): RssPublication {
  return {
    $id: doc.$id as string,
    newsletterId: doc.newsletterId as string,
    runId: doc.runId as string,
    title: doc.title as string,
    htmlBody: doc.htmlBody as string,
    pubDate: doc.pubDate as string,
    updatedAt: doc.updatedAt as string,
  };
}

/**
 * Upsert a publication snapshot keyed by `$id = runId`.
 * Creates when missing; updates title/htmlBody/pubDate/updatedAt on republish.
 */
export async function upsertRssPublication(
  client: Client,
  input: UpsertRssPublicationInput,
): Promise<RssPublication> {
  const databases = new Databases(client);
  const { newsletterId, runId, title, htmlBody, pubDate } = input;
  const updatedAt = new Date().toISOString();

  let exists = false;
  try {
    await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
      documentId: runId,
    });
    exists = true;
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }

  if (exists) {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
      documentId: runId,
      data: {
        title,
        htmlBody,
        pubDate,
        updatedAt,
      },
    });
    return documentToPublication(doc as unknown as Record<string, unknown>);
  }

  const doc = await databases.createDocument({
    databaseId: DATABASE_ID,
    collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
    documentId: runId,
    data: {
      newsletterId,
      runId,
      title,
      htmlBody,
      pubDate,
      updatedAt,
    },
  });
  return documentToPublication(doc as unknown as Record<string, unknown>);
}

/**
 * List publication snapshots for a newsletter, newest `pubDate` first.
 * Defaults to the feed max (10) for the public route.
 */
export async function listRssPublications(
  client: Client,
  newsletterId: string,
  opts?: { limit?: number },
): Promise<RssPublication[]> {
  const databases = new Databases(client);
  const limit = opts?.limit ?? RSS_FEED_MAX_ITEMS;

  const res = await databases.listDocuments({
    databaseId: DATABASE_ID,
    collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
    queries: [
      Query.equal("newsletterId", newsletterId),
      Query.orderDesc("pubDate"),
      Query.limit(limit),
    ],
  });

  const pubs = (res.documents as unknown as Record<string, unknown>[])
    .map(documentToPublication)
    .filter((p) => p.newsletterId === newsletterId);

  pubs.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
  return pubs.slice(0, limit);
}

/**
 * Keep at most {@link RSS_FEED_MAX_ITEMS} publications per newsletter.
 * Lists by `pubDate` desc and deletes the oldest beyond the limit.
 */
export async function trimRssPublications(
  client: Client,
  newsletterId: string,
): Promise<void> {
  const databases = new Databases(client);

  // Fetch enough rows to detect overflow; mock doubles may ignore queries,
  // so we also filter/sort in memory.
  const res = await databases.listDocuments({
    databaseId: DATABASE_ID,
    collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
    queries: [
      Query.equal("newsletterId", newsletterId),
      Query.orderDesc("pubDate"),
      Query.limit(100),
    ],
  });

  const pubs = (res.documents as unknown as Record<string, unknown>[])
    .map(documentToPublication)
    .filter((p) => p.newsletterId === newsletterId);

  pubs.sort((a, b) => b.pubDate.localeCompare(a.pubDate));

  if (pubs.length <= RSS_FEED_MAX_ITEMS) {
    return;
  }

  const toDelete = pubs.slice(RSS_FEED_MAX_ITEMS);
  for (const pub of toDelete) {
    await databases.deleteDocument({
      databaseId: DATABASE_ID,
      collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
      documentId: pub.$id,
    });
  }
}
