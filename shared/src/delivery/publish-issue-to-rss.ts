import type { Client } from "node-appwrite";

import { getNewsletter } from "../newsletters/repository";
import { IssueLoadError, loadIssueDraft, resolveIssueDisplayTitle } from "../runs/issues";
import { resolveOperatorSettings } from "../settings/resolve-operator-settings";
import { sanitizeAppwriteMessageForLog } from "../util/log-redact";
import { draftMarkdownToEmailHtml } from "./email-body";
import {
  recordRssDelivery as defaultRecordRssDelivery,
  type DeliveryOutcome,
} from "./record-delivery";
import { trimRssPublications, upsertRssPublication } from "./rss-publications";
import type { PublishIssueToRssResult } from "./types";

export type PublishIssueToRssOptions = {
  /** Optional override for unit tests; production defaults to {@link defaultRecordRssDelivery}. */
  recordRssDelivery?: (
    client: Client,
    runId: string,
    outcome: DeliveryOutcome,
  ) => Promise<void>;
};

/**
 * Best-effort status persist after a channel outcome. Never fails the caller —
 * injectable recorders may throw; production recorder already swallows Appwrite errors.
 */
async function persistRssDelivery(
  client: Client,
  runId: string,
  outcome: DeliveryOutcome,
  record: NonNullable<PublishIssueToRssOptions["recordRssDelivery"]>,
): Promise<void> {
  try {
    await record(client, runId, outcome);
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    console.error({
      phase: "publish-issue-to-rss-record",
      runId,
      errorType: err instanceof Error ? err.name : typeof err,
      message: sanitizeAppwriteMessageForLog(rawMessage),
    });
  }
}

/**
 * Load a completed issue draft and upsert an RSS publication snapshot for its
 * newsletter (then trim to the feed max). Republish of the same runId updates
 * the snapshot in place.
 *
 * Business failures resolve to `{ ok: false }` — they do not throw.
 * After every returned outcome (success or failure), persists last RSS delivery
 * status on the run (best-effort; persist failure never fails a successful publish).
 */
export async function publishIssueToRss(
  client: Client,
  runId: string,
  options?: PublishIssueToRssOptions,
): Promise<PublishIssueToRssResult> {
  const record = options?.recordRssDelivery ?? defaultRecordRssDelivery;

  const finish = async (result: PublishIssueToRssResult): Promise<PublishIssueToRssResult> => {
    const outcome: DeliveryOutcome = result.ok
      ? { ok: true }
      : { ok: false, error: result.error };
    await persistRssDelivery(client, runId, outcome, record);
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
      return finish({ ok: false, error: "Couldn’t load this issue for publishing" });
    }
    throw err;
  }

  if (markdown.trim() === "") {
    return finish({ ok: false, error: "Issue draft is empty" });
  }

  if (run.endedAt == null || run.endedAt.trim() === "") {
    return finish({ ok: false, error: "Issue is missing an end time" });
  }

  let newsletter;
  try {
    newsletter = await getNewsletter(client, run.newsletterId);
  } catch {
    return finish({ ok: false, error: "Couldn’t load newsletter for publishing" });
  }

  const title = resolveIssueDisplayTitle({
    markdown,
    newsletterName: newsletter.name,
    dateIso: run.endedAt,
    issueTitle: run.issueTitle,
  });
  const htmlBody = draftMarkdownToEmailHtml(markdown);

  // Resolve RSS last-N once per publish (Feature 01 cascade).
  const resolved = await resolveOperatorSettings(client);
  const maxItems = resolved.rssFeedMaxItems.value;

  try {
    await upsertRssPublication(client, {
      newsletterId: run.newsletterId,
      runId: run.$id,
      title,
      htmlBody,
      pubDate: run.endedAt,
    });
    await trimRssPublications(client, run.newsletterId, maxItems);
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    console.error({
      phase: "publish-issue-to-rss",
      runId,
      errorType: err instanceof Error ? err.name : typeof err,
      message: sanitizeAppwriteMessageForLog(rawMessage),
    });
    return finish({ ok: false, error: "Failed to publish to RSS" });
  }

  return finish({
    ok: true,
    newsletterId: run.newsletterId,
    runId: run.$id,
  });
}
