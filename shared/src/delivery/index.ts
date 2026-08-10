export {
  draftMarkdownToEmailHtml,
  draftMarkdownToEmailText,
} from "./email-body";

export { resolveSmtpConfig, SmtpConfigError } from "./smtp-config";
export type { SmtpConfig } from "./smtp-config";
export type { SendIssueEmailResult } from "./types";
export { sendIssueEmail } from "./send-issue-email";
export type { SendIssueEmailOptions } from "./send-issue-email";

export { recordEmailDelivery, recordRssDelivery } from "./record-delivery";
export type { DeliveryOutcome } from "./record-delivery";

export { hasDeliveryAttempt, listDeliveryIssues } from "./list-delivery-issues";
export type { DeliveryOutcomeFilter } from "./list-delivery-issues";

export { resolveAppPublicUrl, AppPublicUrlError } from "./app-public-url";
export { buildRssXml } from "./rss-xml";
export type { BuildRssXmlInput, RssFeedItem } from "./rss-xml";
export {
  upsertRssPublication,
  trimRssPublications,
  listRssPublications,
  RSS_PUBLICATIONS_COLLECTION_ID,
  RSS_FEED_MAX_ITEMS,
} from "./rss-publications";
export type { RssPublication, UpsertRssPublicationInput } from "./rss-publications";

export { publishIssueToRss } from "./publish-issue-to-rss";
export type { PublishIssueToRssOptions } from "./publish-issue-to-rss";
export type { PublishIssueToRssResult } from "./types";

export { buildIssueExportFilename, prepareIssueExport } from "./issue-export";
export type { IssueExportFormat, IssueExportPayload } from "./issue-export";

export { autoDeliverAfterSuccess } from "./auto-deliver";
export type {
  AutoDeliverChannelResult,
  AutoDeliverOptions,
  AutoDeliverResult,
} from "./auto-deliver";
