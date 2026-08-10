import type { Client } from "node-appwrite";
import nodemailer, { type Transporter } from "nodemailer";

import { getNewsletter } from "../newsletters/repository";
import { IssueLoadError, loadIssueDraft, resolveIssueDisplayTitle } from "../runs/issues";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { draftMarkdownToEmailHtml, draftMarkdownToEmailText } from "./email-body";
import {
  recordEmailDelivery as defaultRecordEmailDelivery,
  type DeliveryOutcome,
} from "./record-delivery";
import { resolveSmtpConfig, SmtpConfigError } from "./smtp-config";
import type { SendIssueEmailResult } from "./types";

export type SendIssueEmailOptions = {
  transport?: Transporter;
  /** Optional override for unit tests; production defaults to {@link defaultRecordEmailDelivery}. */
  recordEmailDelivery?: (
    client: Client,
    runId: string,
    outcome: DeliveryOutcome,
  ) => Promise<void>;
};

/**
 * Best-effort status persist after a channel outcome. Never fails the caller —
 * injectable recorders may throw; production recorder already swallows Appwrite errors.
 */
async function persistEmailDelivery(
  client: Client,
  runId: string,
  outcome: DeliveryOutcome,
  record: NonNullable<SendIssueEmailOptions["recordEmailDelivery"]>,
): Promise<void> {
  try {
    await record(client, runId, outcome);
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    console.error({
      phase: "send-issue-email-record",
      runId,
      errorType: err instanceof Error ? err.name : typeof err,
      message: sanitizeAppwriteMessageForLog(rawMessage),
    });
  }
}

/**
 * Load a completed issue draft and email it to the newsletter's recipient list
 * (multipart HTML + plain text) via SMTP. Recipients go in BCC; To equals From.
 *
 * Business failures resolve to `{ ok: false }` — they do not throw.
 * After every returned outcome (success or failure), persists last email delivery
 * status on the run (best-effort; persist failure never fails a successful send).
 */
export async function sendIssueEmail(
  client: Client,
  runId: string,
  options?: SendIssueEmailOptions,
): Promise<SendIssueEmailResult> {
  const record = options?.recordEmailDelivery ?? defaultRecordEmailDelivery;

  const finish = async (result: SendIssueEmailResult): Promise<SendIssueEmailResult> => {
    const outcome: DeliveryOutcome = result.ok
      ? { ok: true }
      : { ok: false, error: result.error };
    await persistEmailDelivery(client, runId, outcome, record);
    return result;
  };

  let run;
  let markdown: string;
  try {
    const draft = await loadIssueDraft(client, runId);
    run = draft.run;
    markdown = draft.markdown;
  } catch (err) {
    if (err instanceof IssueLoadError) {
      return finish({ ok: false, error: "Couldn’t load this issue for sending" });
    }
    throw err;
  }

  if (markdown.trim() === "") {
    return finish({ ok: false, error: "Issue draft is empty" });
  }

  let newsletter;
  try {
    newsletter = await getNewsletter(client, run.newsletterId);
  } catch {
    // not_found / appwrite / unexpected — same operator-facing message; never SMTP.
    return finish({ ok: false, error: "Couldn’t load newsletter for sending" });
  }

  if (newsletter.recipientEmails.length === 0) {
    return finish({ ok: false, error: "No recipients configured for this newsletter" });
  }

  let config;
  try {
    config = resolveSmtpConfig();
  } catch (err) {
    if (err instanceof SmtpConfigError) {
      return finish({ ok: false, error: err.message });
    }
    throw err;
  }

  const dateIso = run.endedAt ?? run.startedAt;
  const subject = resolveIssueDisplayTitle({
    markdown,
    newsletterName: run.newsletterName,
    dateIso,
  });
  const html = draftMarkdownToEmailHtml(markdown);
  const text = draftMarkdownToEmailText(markdown);

  const transport =
    options?.transport ??
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

  try {
    await transport.sendMail({
      from: config.from,
      to: config.from,
      bcc: newsletter.recipientEmails,
      subject,
      html,
      text,
    });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    console.error({
      phase: "send-issue-email",
      runId,
      errorType: err instanceof Error ? err.name : typeof err,
      message: sanitizeAppwriteMessageForLog(rawMessage),
    });
    return finish({ ok: false, error: "Failed to send email" });
  }

  return finish({
    ok: true,
    recipientCount: newsletter.recipientEmails.length,
  });
}
