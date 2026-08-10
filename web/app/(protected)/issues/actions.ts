"use server";

import {
  getServerAppwrite,
  publishIssueToRss,
  sendIssueEmail,
} from "@newsletter/shared";
import { getAuthenticatedUser } from "@/lib/auth/session";

export type SendIssueEmailActionResult =
  | { ok: true; recipientCount: number }
  | { ok: false; error: string };

export type PublishIssueToRssActionResult =
  | { ok: true; newsletterId: string; runId: string }
  | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Manually email a completed issue to that newsletter's recipient list.
 * Server-only — wraps shared `sendIssueEmail` with the Appwrite server client.
 */
export async function sendIssueEmailAction(
  runId: string,
): Promise<SendIssueEmailActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    return await sendIssueEmail(getServerAppwrite(), runId);
  } catch (err) {
    console.error("[issues] sendIssueEmailAction", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * Manually publish a completed issue to that newsletter's RSS feed.
 * Server-only — wraps shared `publishIssueToRss` with the Appwrite server client.
 * Re-publish of the same runId is allowed (upsert).
 */
export async function publishIssueToRssAction(
  runId: string,
): Promise<PublishIssueToRssActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    return await publishIssueToRss(getServerAppwrite(), runId);
  } catch (err) {
    console.error("[issues] publishIssueToRssAction", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
