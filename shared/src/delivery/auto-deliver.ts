import type { Client } from "node-appwrite";

import { getNewsletter as defaultGetNewsletter } from "../newsletters/repository";
import type { Newsletter } from "../newsletters/types";
import { getRun as defaultGetRun } from "../runs/repository";
import type { Run } from "../runs/types";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { publishIssueToRss as defaultPublishIssueToRss } from "./publish-issue-to-rss";
import { sendIssueEmail as defaultSendIssueEmail } from "./send-issue-email";
import type { PublishIssueToRssResult, SendIssueEmailResult } from "./types";

export type AutoDeliverChannelResult = {
  attempted: boolean;
  ok: boolean;
  /** Present when attempted && !ok — operator-facing or sanitized error string; never secrets. */
  error?: string;
};

export type AutoDeliverResult = {
  email: AutoDeliverChannelResult;
  rss: AutoDeliverChannelResult;
};

export type AutoDeliverOptions = {
  getRun?: (client: Client, runId: string) => Promise<Run>;
  getNewsletter?: (client: Client, id: string) => Promise<Newsletter>;
  sendIssueEmail?: (client: Client, runId: string) => Promise<SendIssueEmailResult>;
  publishIssueToRss?: (client: Client, runId: string) => Promise<PublishIssueToRssResult>;
};

const NOT_ATTEMPTED: AutoDeliverChannelResult = { attempted: false, ok: false };

function errorMessageFromUnknown(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return sanitizeAppwriteMessageForLog(raw);
}

/**
 * After a successful run completion, honor the newsletter's auto-email / auto-RSS
 * toggles by calling the same send/publish entry points as manual delivery.
 *
 * Never throws — load or channel failures are logged and returned on the result.
 * Channels are independent; when both are on, email runs before RSS.
 * Does not write delivery-status fields (Feature 06). No auto-export.
 */
export async function autoDeliverAfterSuccess(
  client: Client,
  runId: string,
  options?: AutoDeliverOptions,
): Promise<AutoDeliverResult> {
  const getRun = options?.getRun ?? defaultGetRun;
  const getNewsletter = options?.getNewsletter ?? defaultGetNewsletter;
  const sendIssueEmail = options?.sendIssueEmail ?? defaultSendIssueEmail;
  const publishIssueToRss = options?.publishIssueToRss ?? defaultPublishIssueToRss;

  let run: Run;
  try {
    run = await getRun(client, runId);
  } catch (err) {
    console.error({
      action: "auto-deliver",
      phase: "get-run",
      runId,
      message: errorMessageFromUnknown(err),
    });
    return { email: NOT_ATTEMPTED, rss: NOT_ATTEMPTED };
  }

  let newsletter: Newsletter;
  try {
    newsletter = await getNewsletter(client, run.newsletterId);
  } catch (err) {
    console.error({
      action: "auto-deliver",
      phase: "get-newsletter",
      runId,
      newsletterId: run.newsletterId,
      message: errorMessageFromUnknown(err),
    });
    return { email: NOT_ATTEMPTED, rss: NOT_ATTEMPTED };
  }

  const autoEmail = newsletter.autoEmail === true;
  const autoRss = newsletter.autoRss === true;

  if (!autoEmail && !autoRss) {
    console.log({
      action: "auto-deliver-skip",
      runId,
      reason: "toggles-off",
    });
    return { email: NOT_ATTEMPTED, rss: NOT_ATTEMPTED };
  }

  let email: AutoDeliverChannelResult = NOT_ATTEMPTED;
  let rss: AutoDeliverChannelResult = NOT_ATTEMPTED;

  if (autoEmail) {
    try {
      const sendResult = await sendIssueEmail(client, runId);
      if (sendResult.ok) {
        email = { attempted: true, ok: true };
        console.log({ action: "auto-deliver-email", runId, ok: true });
      } else {
        email = { attempted: true, ok: false, error: sendResult.error };
        console.error({
          action: "auto-deliver-email",
          runId,
          ok: false,
          message: sanitizeAppwriteMessageForLog(sendResult.error),
        });
      }
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      email = { attempted: true, ok: false, error: message };
      console.error({
        action: "auto-deliver-email",
        runId,
        ok: false,
        message,
      });
    }
  }

  if (autoRss) {
    try {
      const publishResult = await publishIssueToRss(client, runId);
      if (publishResult.ok) {
        rss = { attempted: true, ok: true };
        console.log({ action: "auto-deliver-rss", runId, ok: true });
      } else {
        rss = { attempted: true, ok: false, error: publishResult.error };
        console.error({
          action: "auto-deliver-rss",
          runId,
          ok: false,
          message: sanitizeAppwriteMessageForLog(publishResult.error),
        });
      }
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      rss = { attempted: true, ok: false, error: message };
      console.error({
        action: "auto-deliver-rss",
        runId,
        ok: false,
        message,
      });
    }
  }

  return { email, rss };
}
