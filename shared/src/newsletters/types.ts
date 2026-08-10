import type { FeedStatus, NewsletterDateRange } from "../schema/declarations";

export type NewsletterRepositoryErrorCode =
  "validation" | "not_found" | "not_ok" | "duplicate_attachment" | "appwrite";

export class NewsletterRepositoryError extends Error {
  readonly code: NewsletterRepositoryErrorCode;

  constructor(code: NewsletterRepositoryErrorCode, message: string) {
    super(message);
    this.name = "NewsletterRepositoryError";
    this.code = code;
  }
}

export interface Newsletter {
  $id: string;
  name: string;
  topics: string[];
  dislikedTopics: string[];
  audience: string;
  newsItems: number;
  dateRange: NewsletterDateRange;
  lookback: number;
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  embedderModel: string;
  /** Per-newsletter drafter prompt override; empty string = use global template. */
  drafterPrompt: string;
  scheduleEnabled: boolean;
  scheduleCron: string;
  scheduleTimezone: string;
  scheduleLastFiredAt: string | null;
  recipientEmails: string[];
  autoEmail: boolean;
  autoRss: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNewsletterInput {
  name: string;
  topics?: string[];
  dislikedTopics?: string[];
  audience?: string;
  newsItems?: number;
  dateRange?: NewsletterDateRange;
  lookback?: number;
  taggerModel?: string;
  scorerModel?: string;
  drafterModel?: string;
  embedderModel?: string;
  /** Optional; omit → `""` (use global). Create UI does not collect this. */
  drafterPrompt?: string;
}

export interface UpdateNewsletterInput {
  name: string;
  topics: string[];
  dislikedTopics: string[];
  audience: string;
  newsItems: number;
  dateRange: NewsletterDateRange;
  lookback: number;
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  embedderModel: string;
  /** Always written; explicit `""` clears the override. */
  drafterPrompt: string;
}

/**
 * Definition fields after validation/normalization — the shape persisted to
 * Appwrite (timestamps are added by the repository at write time).
 */
export interface NewsletterFields {
  name: string;
  topics: string[];
  dislikedTopics: string[];
  audience: string;
  newsItems: number;
  dateRange: NewsletterDateRange;
  lookback: number;
  taggerModel: string;
  scorerModel: string;
  drafterModel: string;
  embedderModel: string;
  drafterPrompt: string;
}

/**
 * A newsletter↔feed attachment. `$id` is the junction document id (same value
 * as `attachmentId`, kept under both keys so the attach path and the list path
 * share one shape). Feed fields are resolved from the feeds collection; the
 * list path omits junctions whose feed is missing (orphan).
 */
export interface AttachmentRecord {
  $id: string;
  attachmentId: string;
  newsletterId: string;
  feedId: string;
  feedName: string;
  feedUrl: string;
  feedStatus: FeedStatus;
  createdAt: string;
}
