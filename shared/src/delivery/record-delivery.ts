import { Databases } from "node-appwrite";
import type { Client } from "node-appwrite";

import {
  DATABASE_ID,
  DELIVERY_ERROR_MAX,
  RUNS_COLLECTION_ID,
} from "../schema/declarations";
import {
  redactMessageForStorage,
  sanitizeAppwriteMessageForLog,
} from "../util/log-redact";

export type DeliveryOutcome = { ok: true } | { ok: false; error: string };

function errorMessageFromUnknown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Persist last email delivery outcome on the run (best-effort).
 * Updates only the three email delivery attributes; never throws.
 */
export async function recordEmailDelivery(
  client: Client,
  runId: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  const now = new Date().toISOString();
  const data = outcome.ok
    ? {
        emailDeliveryStatus: "sent" as const,
        emailDeliveryAt: now,
        emailDeliveryError: "",
      }
    : {
        emailDeliveryStatus: "failed" as const,
        emailDeliveryAt: now,
        emailDeliveryError: redactMessageForStorage(outcome.error, DELIVERY_ERROR_MAX),
      };

  try {
    const databases = new Databases(client);
    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
  } catch (err) {
    console.error({
      phase: "record-email-delivery",
      runId,
      errorType: err instanceof Error ? err.name : typeof err,
      message: sanitizeAppwriteMessageForLog(errorMessageFromUnknown(err)),
    });
  }
}

/**
 * Persist last RSS delivery outcome on the run (best-effort).
 * Updates only the three RSS delivery attributes; never throws.
 */
export async function recordRssDelivery(
  client: Client,
  runId: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  const now = new Date().toISOString();
  const data = outcome.ok
    ? {
        rssDeliveryStatus: "published" as const,
        rssDeliveryAt: now,
        rssDeliveryError: "",
      }
    : {
        rssDeliveryStatus: "failed" as const,
        rssDeliveryAt: now,
        rssDeliveryError: redactMessageForStorage(outcome.error, DELIVERY_ERROR_MAX),
      };

  try {
    const databases = new Databases(client);
    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
      data,
    });
  } catch (err) {
    console.error({
      phase: "record-rss-delivery",
      runId,
      errorType: err instanceof Error ? err.name : typeof err,
      message: sanitizeAppwriteMessageForLog(errorMessageFromUnknown(err)),
    });
  }
}
