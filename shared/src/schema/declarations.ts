/**
 * Appwrite schema declarations — the single source of truth for the database
 * id/name and the collection/attribute model. Later stages import `DATABASE_ID`
 * (immutable) and `COLLECTIONS` from here.
 */

export type AttributeType = "string" | "datetime" | "number" | "boolean";

export interface SchemaAttribute {
  key: string;
  type: AttributeType;
  size?: number;
  required: boolean;
  default?: string | number | boolean;
  array?: boolean;
}

export interface SchemaCollection {
  id: string;
  name: string;
  permissions: { read: string[]; write: string[] };
  attributes: SchemaAttribute[];
}

export interface SchemaBucket {
  id: string;
  name: string;
  permissions: string[];
  fileSecurity: boolean;
  enabled: boolean;
  maximumFileSize: number;
  allowedFileExtensions: string[];
}

export const DATABASE_ID = "newsletter_db" as const;
export const DATABASE_NAME = "Homepress" as const;
export const HEALTH_CHECK_COLLECTION_ID = "health_check" as const;

export const FEEDS_COLLECTION_ID = "feeds" as const;
export const NEWSLETTERS_COLLECTION_ID = "newsletters" as const;
export const NEWSLETTER_FEEDS_COLLECTION_ID = "newsletter_feeds" as const;
export const RUNS_COLLECTION_ID = "runs" as const;

export const APP_SETTINGS_COLLECTION_ID = "app_settings" as const;
export const APP_SETTINGS_DOCUMENT_ID = "default" as const;

export const PROMPT_TEMPLATES_COLLECTION_ID = "prompt_templates" as const;

/**
 * RSS publication snapshots (Feature 03). Document `$id` = `runId`
 * (one publication doc per run; upsert is get/create/update by that id).
 */
export const RSS_PUBLICATIONS_COLLECTION_ID = "rss_publications" as const;
export const RSS_FEED_MAX_ITEMS = 10 as const;
export const RSS_HTML_BODY_ATTR_SIZE = 200000 as const;
export const RSS_TITLE_ATTR_SIZE = 512 as const;

export const DEFAULT_RUN_RETENTION_DAYS = 30 as const;
export const MIN_RUN_RETENTION_DAYS = 1 as const;
export const MAX_RUN_RETENTION_DAYS = 365 as const;
export const PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER = 3 as const;

export const DEFAULT_LOOKBACK = 3 as const;
export const LOOKBACK_MIN = 0 as const;
export const LOOKBACK_MAX = 10 as const;

export const DEFAULT_SCHEDULE_TIMEZONE = "UTC" as const;
export const SCHEDULE_CRON_MAX_LENGTH = 128 as const;
export const SCHEDULE_TIMEZONE_MAX_LENGTH = 64 as const;

export const RECIPIENT_EMAIL_MAX_LENGTH = 254 as const;
export const RECIPIENT_EMAIL_ATTR_SIZE = 320 as const;
export const RECIPIENT_LIST_MAX = 20 as const;

export const RUN_CHECKPOINTS_BUCKET_ID = "run_checkpoints" as const;

export const FEED_STATUSES = ["untested", "ok", "failed"] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];

export const FEED_OPERATIONAL_HEALTH = ["healthy", "unhealthy"] as const;
export type FeedOperationalHealth = (typeof FEED_OPERATIONAL_HEALTH)[number];
export const FEED_UNHEALTHY_THRESHOLD = 3 as const;

export const RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ["manual", "scheduled"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const EMAIL_DELIVERY_STATUSES = ["none", "sent", "failed"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const RSS_DELIVERY_STATUSES = ["none", "published", "failed"] as const;
export type RssDeliveryStatus = (typeof RSS_DELIVERY_STATUSES)[number];

export const DELIVERY_ERROR_MAX = 2000 as const;
export const DELIVERY_STATUS_ATTR_SIZE = 16 as const;

/**
 * Pipeline phases for runs — duplicated from pipeline types to avoid
 * declarations→pipeline cycle (same pattern as NewsletterDateRange).
 */
export const RUN_PHASES = ["fetch", "scrape", "tag", "score", "selection", "draft"] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/** Fetch lookback enum — duplicated from pipeline DateRange to avoid declarations→pipeline cycle. */
export type NewsletterDateRange = "yesterday" | "last_3_days" | "last_week" | "all";

export const COLLECTIONS: SchemaCollection[] = [
  {
    id: "health_check",
    name: "Health Check",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "status", type: "string", size: 255, required: true },
      { key: "createdAt", type: "datetime", required: true },
    ],
  },
  {
    id: FEEDS_COLLECTION_ID,
    name: "Feeds",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "name", type: "string", size: 255, required: true },
      { key: "url", type: "string", size: 2048, required: true },
      { key: "notes", type: "string", size: 2000, required: false },
      { key: "status", type: "string", size: 32, required: true },
      { key: "lastTestedAt", type: "datetime", required: false },
      { key: "lastTestError", type: "string", size: 1000, required: false },
      { key: "operationalHealth", type: "string", size: 32, required: false, default: "healthy" },
      { key: "consecutiveFetchFailures", type: "number", required: false, default: 0 },
      { key: "lastFetchError", type: "string", size: 1000, required: false },
      { key: "lastFetchAt", type: "datetime", required: false },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
  },
  {
    id: NEWSLETTERS_COLLECTION_ID,
    name: "Newsletters",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "name", type: "string", size: 255, required: true },
      { key: "topics", type: "string", size: 128, required: false, array: true },
      {
        key: "dislikedTopics",
        type: "string",
        size: 128,
        required: false,
        array: true,
      },
      { key: "audience", type: "string", size: 2000, required: false },
      { key: "newsItems", type: "number", required: false, default: 16 },
      {
        key: "dateRange",
        type: "string",
        size: 32,
        required: false,
        default: "yesterday",
      },
      { key: "lookback", type: "number", required: false, default: 3 },
      { key: "scheduleEnabled", type: "boolean", required: false, default: false },
      {
        key: "scheduleCron",
        type: "string",
        size: SCHEDULE_CRON_MAX_LENGTH,
        required: false,
      },
      {
        key: "scheduleTimezone",
        type: "string",
        size: SCHEDULE_TIMEZONE_MAX_LENGTH,
        required: false,
        default: DEFAULT_SCHEDULE_TIMEZONE,
      },
      { key: "scheduleLastFiredAt", type: "datetime", required: false },
      { key: "taggerModel", type: "string", size: 256, required: false },
      { key: "scorerModel", type: "string", size: 256, required: false },
      { key: "drafterModel", type: "string", size: 256, required: false },
      { key: "embedderModel", type: "string", size: 256, required: false },
      { key: "drafterPrompt", type: "string", size: 50000, required: false },
      {
        key: "recipientEmails",
        type: "string",
        size: RECIPIENT_EMAIL_ATTR_SIZE,
        required: false,
        array: true,
      },
      { key: "autoEmail", type: "boolean", required: false, default: false },
      { key: "autoRss", type: "boolean", required: false, default: false },
      { key: "createdAt", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
  },
  {
    id: NEWSLETTER_FEEDS_COLLECTION_ID,
    name: "Newsletter Feeds",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "newsletterId", type: "string", size: 64, required: true },
      { key: "feedId", type: "string", size: 64, required: true },
      { key: "createdAt", type: "datetime", required: true },
    ],
  },
  {
    id: RUNS_COLLECTION_ID,
    name: "Runs",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "newsletterId", type: "string", size: 64, required: true },
      { key: "newsletterName", type: "string", size: 255, required: true },
      { key: "status", type: "string", size: 32, required: true },
      { key: "currentPhase", type: "string", size: 32, required: false },
      { key: "completedPhase", type: "string", size: 32, required: false },
      { key: "failedPhase", type: "string", size: 32, required: false },
      { key: "failureMessage", type: "string", size: 2000, required: false },
      { key: "startedAt", type: "datetime", required: true },
      { key: "endedAt", type: "datetime", required: false },
      { key: "topicSummary", type: "string", size: 100000, required: false },
      { key: "failedFeeds", type: "string", size: 20000, required: false },
      { key: "checkpointFetchId", type: "string", size: 64, required: false },
      { key: "checkpointScrapeId", type: "string", size: 64, required: false },
      { key: "checkpointTagId", type: "string", size: 64, required: false },
      { key: "checkpointScoreId", type: "string", size: 64, required: false },
      {
        key: "checkpointSelectionId",
        type: "string",
        size: 64,
        required: false,
      },
      { key: "checkpointDraftId", type: "string", size: 64, required: false },
      { key: "suppressSummary", type: "string", size: 100000, required: false },
      { key: "trigger", type: "string", size: 32, required: false, default: "manual" },
      {
        key: "emailDeliveryStatus",
        type: "string",
        size: DELIVERY_STATUS_ATTR_SIZE,
        required: false,
        default: "none",
      },
      { key: "emailDeliveryAt", type: "datetime", required: false },
      {
        key: "emailDeliveryError",
        type: "string",
        size: DELIVERY_ERROR_MAX,
        required: false,
      },
      {
        key: "rssDeliveryStatus",
        type: "string",
        size: DELIVERY_STATUS_ATTR_SIZE,
        required: false,
        default: "none",
      },
      { key: "rssDeliveryAt", type: "datetime", required: false },
      {
        key: "rssDeliveryError",
        type: "string",
        size: DELIVERY_ERROR_MAX,
        required: false,
      },
    ],
  },
  {
    id: APP_SETTINGS_COLLECTION_ID,
    name: "App Settings",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "runRetentionDays", type: "number", required: true },
      { key: "updatedAt", type: "datetime", required: true },
      { key: "taggerModel", type: "string", size: 256, required: false },
      { key: "scorerModel", type: "string", size: 256, required: false },
      { key: "drafterModel", type: "string", size: 256, required: false },
      { key: "embedderModel", type: "string", size: 256, required: false },
      // Stage 12 Feature 01 — optional operator overrides (GUI → env → default).
      { key: "openRouterApiKey", type: "string", size: 512, required: false },
      { key: "smtpHost", type: "string", size: 512, required: false },
      { key: "smtpPort", type: "number", required: false },
      { key: "smtpUsername", type: "string", size: 512, required: false },
      { key: "smtpPassword", type: "string", size: 512, required: false },
      { key: "smtpFrom", type: "string", size: 512, required: false },
      { key: "smtpSecure", type: "string", size: 16, required: false },
      { key: "appPublicUrl", type: "string", size: 512, required: false },
      { key: "scoreThreshold", type: "number", required: false },
      { key: "crossRunSimilarityThreshold", type: "number", required: false },
      { key: "rssFeedMaxItems", type: "number", required: false },
      { key: "drafterReasoningEffort", type: "string", size: 16, required: false },
      { key: "drafterMaxCompletionTokens", type: "number", required: false },
    ],
  },
  {
    id: PROMPT_TEMPLATES_COLLECTION_ID,
    name: "Prompt Templates",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "body", type: "string", size: 50000, required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
  },
  {
    // Document `$id` = `runId` (stable guid; one snapshot per run).
    id: RSS_PUBLICATIONS_COLLECTION_ID,
    name: "RSS Publications",
    permissions: { read: [], write: [] },
    attributes: [
      { key: "newsletterId", type: "string", size: 64, required: true },
      { key: "runId", type: "string", size: 64, required: true },
      { key: "title", type: "string", size: RSS_TITLE_ATTR_SIZE, required: true },
      {
        key: "htmlBody",
        type: "string",
        size: RSS_HTML_BODY_ATTR_SIZE,
        required: true,
      },
      { key: "pubDate", type: "datetime", required: true },
      { key: "updatedAt", type: "datetime", required: true },
    ],
  },
];

export const BUCKETS: SchemaBucket[] = [
  {
    id: RUN_CHECKPOINTS_BUCKET_ID,
    name: "Run Checkpoints",
    permissions: [],
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 30000000,
    allowedFileExtensions: ["json"],
  },
];
