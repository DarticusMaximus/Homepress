import { Client, Databases, ID, Query } from "node-appwrite";
import {
  DATABASE_ID,
  DEFAULT_LOOKBACK,
  DEFAULT_SCHEDULE_TIMEZONE,
  NEWSLETTERS_COLLECTION_ID,
  NEWSLETTER_FEEDS_COLLECTION_ID,
  type NewsletterDateRange,
} from "../schema/declarations";
import {
  type CreateNewsletterInput,
  type Newsletter,
  NewsletterRepositoryError,
  type UpdateNewsletterInput,
} from "./types";
import { mapModelFieldFromDocument } from "../settings/model-defaults";
import { resolveDeliveryFields, type UpdateNewsletterDeliveryInput } from "./delivery";
import { resolveScheduleFields, type UpdateNewsletterScheduleInput } from "./schedule";
import { resolveCreateFields, resolveUpdateFields } from "./validation";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";

const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

/**
 * V1 fetch page size — no custom-attribute indexes, so filters/sort run in
 * memory. GUI `listNewsletters` stays single-page; due-check uses
 * `listAllNewslettersForDueCheck` to walk every document via cursor pages.
 */
export const NEWSLETTER_LIST_LIMIT = 100;

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

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as AppwriteExceptionLike).code === 404;
}

function documentToNewsletter(doc: Record<string, unknown>): Newsletter {
  const lookback = doc.lookback;
  const scheduleEnabled = doc.scheduleEnabled;
  const scheduleCron = doc.scheduleCron;
  const scheduleTimezone = doc.scheduleTimezone;
  const autoEmail = doc.autoEmail;
  const autoRss = doc.autoRss;
  return {
    $id: doc.$id as string,
    name: doc.name as string,
    topics: (doc.topics as string[]) ?? [],
    dislikedTopics: (doc.dislikedTopics as string[]) ?? [],
    audience: (doc.audience as string) ?? "",
    newsItems: doc.newsItems as number,
    dateRange: doc.dateRange as NewsletterDateRange,
    lookback:
      typeof lookback === "number" && Number.isFinite(lookback) ? lookback : DEFAULT_LOOKBACK,
    taggerModel: mapModelFieldFromDocument(doc.taggerModel),
    scorerModel: mapModelFieldFromDocument(doc.scorerModel),
    drafterModel: mapModelFieldFromDocument(doc.drafterModel),
    embedderModel: mapModelFieldFromDocument(doc.embedderModel),
    drafterPrompt: typeof doc.drafterPrompt === "string" ? doc.drafterPrompt : "",
    scheduleEnabled: scheduleEnabled === true,
    scheduleCron: typeof scheduleCron === "string" ? scheduleCron : "",
    scheduleTimezone:
      typeof scheduleTimezone === "string" && scheduleTimezone.length > 0
        ? scheduleTimezone
        : DEFAULT_SCHEDULE_TIMEZONE,
    scheduleLastFiredAt: (doc.scheduleLastFiredAt as string | null | undefined) ?? null,
    recipientEmails: (doc.recipientEmails as string[] | null | undefined) ?? [],
    autoEmail: autoEmail === true,
    autoRss: autoRss === true,
    createdAt: doc.createdAt as string,
    updatedAt: doc.updatedAt as string,
  };
}

export async function listNewsletters(client: Client): Promise<Newsletter[]> {
  const databases = new Databases(client);
  try {
    const result = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      queries: [Query.limit(NEWSLETTER_LIST_LIMIT)],
    });
    const newsletters = result.documents.map((doc) =>
      documentToNewsletter(doc as unknown as Record<string, unknown>),
    );
    newsletters.sort((a, b) => {
      const byDate = b.updatedAt.localeCompare(a.updatedAt);
      if (byDate !== 0) return byDate;
      return a.$id.localeCompare(b.$id);
    });
    return newsletters;
  } catch (err) {
    wrapAppwriteError(err, "list-newsletters");
  }
}

/**
 * Page through the entire `newsletters` collection until exhausted. Default
 * page size is `NEWSLETTER_LIST_LIMIT` (100). Uses `Query.limit(pageSize)` on
 * every request and `Query.cursorAfter(lastId)` for subsequent pages.
 *
 * Intended for schedule due-check (`processDueSchedules`) so every newsletter
 * is considered each tick — not for the GUI list (Feature 04 stays single-page).
 */
export async function listAllNewslettersForDueCheck(
  client: Client,
  opts?: { pageSize?: number },
): Promise<Newsletter[]> {
  const databases = new Databases(client);
  const pageSize = opts?.pageSize ?? NEWSLETTER_LIST_LIMIT;
  const all: Newsletter[] = [];
  let cursorId: string | null = null;

  try {
    for (;;) {
      const queries: string[] = [Query.limit(pageSize)];
      if (cursorId) {
        queries.push(Query.cursorAfter(cursorId));
      }
      const res = await databases.listDocuments({
        databaseId: DATABASE_ID,
        collectionId: NEWSLETTERS_COLLECTION_ID,
        queries,
      });
      const docs = res.documents as unknown as Record<string, unknown>[];
      const page = docs.map(documentToNewsletter);
      all.push(...page);

      if (page.length < pageSize) break;
      cursorId = String(docs[docs.length - 1]!.$id);
    }
    return all;
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    wrapAppwriteError(err, "list-all-newsletters-for-due-check");
  }
}

export async function getNewsletter(client: Client, id: string): Promise<Newsletter> {
  const databases = new Databases(client);
  try {
    const doc = await databases.getDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: id,
    });
    return documentToNewsletter(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (isNotFound(err)) {
      throw new NewsletterRepositoryError("not_found", "Newsletter not found");
    }
    wrapAppwriteError(err, "get-newsletter");
  }
}

export async function createNewsletter(
  client: Client,
  input: CreateNewsletterInput,
): Promise<Newsletter> {
  const fields = resolveCreateFields(input);
  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    name: fields.name,
    topics: fields.topics,
    dislikedTopics: fields.dislikedTopics,
    audience: fields.audience,
    newsItems: fields.newsItems,
    dateRange: fields.dateRange,
    lookback: fields.lookback,
    taggerModel: fields.taggerModel,
    scorerModel: fields.scorerModel,
    drafterModel: fields.drafterModel,
    embedderModel: fields.embedderModel,
    drafterPrompt: fields.drafterPrompt,
    scheduleEnabled: false,
    scheduleCron: "",
    scheduleTimezone: DEFAULT_SCHEDULE_TIMEZONE,
    scheduleLastFiredAt: null,
    recipientEmails: [],
    autoEmail: false,
    autoRss: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const doc = await databases.createDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: ID.unique(),
      data,
    });
    return documentToNewsletter(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    wrapAppwriteError(err, "create-newsletter");
  }
}

export async function updateNewsletter(
  client: Client,
  id: string,
  input: UpdateNewsletterInput,
): Promise<Newsletter> {
  const fields = resolveUpdateFields(input);
  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    name: fields.name,
    topics: fields.topics,
    dislikedTopics: fields.dislikedTopics,
    audience: fields.audience,
    newsItems: fields.newsItems,
    dateRange: fields.dateRange,
    lookback: fields.lookback,
    taggerModel: fields.taggerModel,
    scorerModel: fields.scorerModel,
    drafterModel: fields.drafterModel,
    embedderModel: fields.embedderModel,
    drafterPrompt: fields.drafterPrompt,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: id,
      data,
    });
    return documentToNewsletter(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new NewsletterRepositoryError("not_found", "Newsletter not found");
    }
    wrapAppwriteError(err, "update-newsletter");
  }
}

export async function updateNewsletterSchedule(
  client: Client,
  id: string,
  input: UpdateNewsletterScheduleInput,
): Promise<Newsletter> {
  const fields = resolveScheduleFields(input);
  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    scheduleEnabled: fields.scheduleEnabled,
    scheduleCron: fields.scheduleCron,
    scheduleTimezone: fields.scheduleTimezone,
    scheduleLastFiredAt: null,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: id,
      data,
    });
    return documentToNewsletter(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new NewsletterRepositoryError("not_found", "Newsletter not found");
    }
    wrapAppwriteError(err, "update-newsletter-schedule");
  }
}

export async function updateNewsletterDelivery(
  client: Client,
  id: string,
  input: UpdateNewsletterDeliveryInput,
): Promise<Newsletter> {
  const fields = resolveDeliveryFields(input);
  const databases = new Databases(client);
  const now = new Date().toISOString();
  const data = {
    recipientEmails: fields.recipientEmails,
    autoEmail: fields.autoEmail,
    autoRss: fields.autoRss,
    updatedAt: now,
  };

  try {
    const doc = await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: id,
      data,
    });
    return documentToNewsletter(doc as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new NewsletterRepositoryError("not_found", "Newsletter not found");
    }
    wrapAppwriteError(err, "update-newsletter-delivery");
  }
}

export type SetScheduleLastFiredAtOpts = {
  /**
   * When true, only advance the stamp if the current value is null or older
   * than `iso` (idempotent retries / concurrent stampers). Equal or newer
   * stamps are a successful no-op.
   */
  compare?: boolean;
};

/**
 * Stamp-only writer: persist the previous-fire ISO after a successful schedule
 * enqueue, or after a busy-skip (`already_in_progress`). Clearing the stamp is
 * done by `updateNewsletterSchedule`, not here.
 *
 * With `{ compare: true }`, reads the current document first and writes only
 * when the stamp would advance (null or older than `iso`).
 */
export async function setScheduleLastFiredAt(
  client: Client,
  id: string,
  iso: string,
  opts?: SetScheduleLastFiredAtOpts,
): Promise<void> {
  const trimmed = typeof iso === "string" ? iso.trim() : "";
  if (trimmed.length === 0 || Number.isNaN(new Date(trimmed).getTime())) {
    throw new NewsletterRepositoryError(
      "validation",
      "scheduleLastFiredAt must be a non-empty ISO-8601 timestamp",
    );
  }

  const databases = new Databases(client);

  if (opts?.compare) {
    let current: Newsletter;
    try {
      current = await getNewsletter(client, id);
    } catch (err) {
      if (err instanceof NewsletterRepositoryError) throw err;
      wrapAppwriteError(err, "set-schedule-last-fired-at");
    }

    const existing = current.scheduleLastFiredAt;
    if (existing !== null) {
      const existingMs = new Date(existing).getTime();
      const nextMs = new Date(trimmed).getTime();
      if (!Number.isNaN(existingMs) && existingMs >= nextMs) {
        return;
      }
    }
  }

  const now = new Date().toISOString();
  const data = {
    scheduleLastFiredAt: trimmed,
    updatedAt: now,
  };

  try {
    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: id,
      data,
    });
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new NewsletterRepositoryError("not_found", "Newsletter not found");
    }
    wrapAppwriteError(err, "set-schedule-last-fired-at");
  }
}

export async function deleteNewsletter(client: Client, id: string): Promise<void> {
  const databases = new Databases(client);

  // 1. Cascade: list and delete this newsletter's junction rows first.
  //    Loop pages (cap NEWSLETTER_LIST_LIMIT) until a partial page arrives.
  try {
    while (true) {
      const result = await databases.listDocuments({
        databaseId: DATABASE_ID,
        collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
        queries: [Query.equal("newsletterId", id), Query.limit(NEWSLETTER_LIST_LIMIT)],
      });
      const junctions = result.documents;
      if (junctions.length === 0) break;
      for (const junction of junctions) {
        await databases.deleteDocument({
          databaseId: DATABASE_ID,
          collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
          documentId: junction.$id,
        });
      }
      if (junctions.length < NEWSLETTER_LIST_LIMIT) break;
    }
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    wrapAppwriteError(err, "delete-newsletter-junctions");
  }

  // 2. Then delete the newsletter document itself.
  try {
    await databases.deleteDocument({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: id,
    });
  } catch (err) {
    if (err instanceof NewsletterRepositoryError) throw err;
    if (isNotFound(err)) {
      throw new NewsletterRepositoryError("not_found", "Newsletter not found");
    }
    wrapAppwriteError(err, "delete-newsletter");
  }
}
