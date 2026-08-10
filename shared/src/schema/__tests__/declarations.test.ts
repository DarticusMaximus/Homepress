import { describe, it, expect } from "vitest";
import {
  DATABASE_ID,
  DATABASE_NAME,
  COLLECTIONS,
  FEEDS_COLLECTION_ID,
  NEWSLETTERS_COLLECTION_ID,
  NEWSLETTER_FEEDS_COLLECTION_ID,
  FEED_STATUSES,
  type FeedStatus,
  FEED_OPERATIONAL_HEALTH,
  type FeedOperationalHealth,
  FEED_UNHEALTHY_THRESHOLD,
  type NewsletterDateRange,
  type SchemaCollection,
  RUNS_COLLECTION_ID,
  RUN_STATUSES,
  type RunStatus,
  RUN_PHASES,
  type RunPhase,
  APP_SETTINGS_COLLECTION_ID,
  APP_SETTINGS_DOCUMENT_ID,
  PROMPT_TEMPLATES_COLLECTION_ID,
  RSS_PUBLICATIONS_COLLECTION_ID,
  RSS_FEED_MAX_ITEMS,
  RSS_HTML_BODY_ATTR_SIZE,
  RSS_TITLE_ATTR_SIZE,
  DEFAULT_RUN_RETENTION_DAYS,
  MIN_RUN_RETENTION_DAYS,
  MAX_RUN_RETENTION_DAYS,
  PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER,
  DEFAULT_LOOKBACK,
  LOOKBACK_MIN,
  LOOKBACK_MAX,
  DEFAULT_SCHEDULE_TIMEZONE,
  SCHEDULE_CRON_MAX_LENGTH,
  SCHEDULE_TIMEZONE_MAX_LENGTH,
  RECIPIENT_EMAIL_MAX_LENGTH,
  RECIPIENT_EMAIL_ATTR_SIZE,
  RECIPIENT_LIST_MAX,
  EMAIL_DELIVERY_STATUSES,
  RSS_DELIVERY_STATUSES,
  DELIVERY_ERROR_MAX,
  DELIVERY_STATUS_ATTR_SIZE,
  RUN_CHECKPOINTS_BUCKET_ID,
  BUCKETS,
  type SchemaBucket,
} from "../declarations";

// Compile-time type check: COLLECTIONS must be assignable to SchemaCollection[].
const _check: SchemaCollection[] = COLLECTIONS;

// Compile-time: BUCKETS must be assignable to SchemaBucket[].
const _bucketCheck: SchemaBucket[] = BUCKETS;

// Compile-time: FeedStatus / NewsletterDateRange vocabulary is usable.
const _feedStatus: FeedStatus = "untested";
const _dateRange: NewsletterDateRange = "yesterday";
void _feedStatus;
void _dateRange;

// Compile-time: FeedOperationalHealth vocabulary is usable.
const _feedOpHealth: FeedOperationalHealth = "healthy";
void _feedOpHealth;

// Compile-time: RunStatus / RunPhase vocabulary is usable.
const _runStatus: RunStatus = "pending";
const _runPhase: RunPhase = "fetch";
void _runStatus;
void _runPhase;

function byId(id: string) {
  return COLLECTIONS.find((c) => c.id === id);
}

describe("schema declarations", () => {
  it("exports the database id and name", () => {
    expect(DATABASE_ID).toBe("newsletter_db");
    expect(DATABASE_NAME).toBe("Homepress");
  });

  it("COLLECTIONS has exactly eight collections in order", () => {
    expect(Array.isArray(COLLECTIONS)).toBe(true);
    expect(COLLECTIONS).toHaveLength(8);
    expect(COLLECTIONS.map((c) => c.id)).toEqual([
      "health_check",
      "feeds",
      "newsletters",
      "newsletter_feeds",
      "runs",
      "app_settings",
      "prompt_templates",
      "rss_publications",
    ]);
  });

  it("exports collection-id constants matching declared ids", () => {
    expect(FEEDS_COLLECTION_ID).toBe("feeds");
    expect(NEWSLETTERS_COLLECTION_ID).toBe("newsletters");
    expect(NEWSLETTER_FEEDS_COLLECTION_ID).toBe("newsletter_feeds");
    expect(RUNS_COLLECTION_ID).toBe("runs");
    expect(APP_SETTINGS_COLLECTION_ID).toBe("app_settings");
    expect(PROMPT_TEMPLATES_COLLECTION_ID).toBe("prompt_templates");
    expect(RSS_PUBLICATIONS_COLLECTION_ID).toBe("rss_publications");
    expect(byId(FEEDS_COLLECTION_ID)?.id).toBe("feeds");
    expect(byId(NEWSLETTERS_COLLECTION_ID)?.id).toBe("newsletters");
    expect(byId(NEWSLETTER_FEEDS_COLLECTION_ID)?.id).toBe("newsletter_feeds");
    expect(byId(RUNS_COLLECTION_ID)?.id).toBe("runs");
    expect(byId(APP_SETTINGS_COLLECTION_ID)?.id).toBe("app_settings");
    expect(byId(PROMPT_TEMPLATES_COLLECTION_ID)?.id).toBe("prompt_templates");
    expect(byId(RSS_PUBLICATIONS_COLLECTION_ID)?.id).toBe("rss_publications");
  });

  // Feature 03 Task 2 — RSS publication snapshot constants.
  it("exports RSS publication constants with locked values", () => {
    expect(RSS_PUBLICATIONS_COLLECTION_ID).toBe("rss_publications");
    expect(RSS_FEED_MAX_ITEMS).toBe(10);
    expect(RSS_HTML_BODY_ATTR_SIZE).toBe(200000);
    expect(RSS_TITLE_ATTR_SIZE).toBe(512);
  });

  it("exports app_settings constants with locked values", () => {
    expect(APP_SETTINGS_COLLECTION_ID).toBe("app_settings");
    expect(APP_SETTINGS_DOCUMENT_ID).toBe("default");
    expect(DEFAULT_RUN_RETENTION_DAYS).toBe(30);
    expect(MIN_RUN_RETENTION_DAYS).toBe(1);
    expect(MAX_RUN_RETENTION_DAYS).toBe(365);
    expect(PROTECTED_COMPLETED_RUNS_PER_NEWSLETTER).toBe(3);
  });

  it("exports lookback constants with locked values", () => {
    expect(DEFAULT_LOOKBACK).toBe(3);
    expect(LOOKBACK_MIN).toBe(0);
    expect(LOOKBACK_MAX).toBe(10);
  });

  it("exports schedule constants with locked values", () => {
    expect(DEFAULT_SCHEDULE_TIMEZONE).toBe("UTC");
    expect(SCHEDULE_CRON_MAX_LENGTH).toBe(128);
    expect(SCHEDULE_TIMEZONE_MAX_LENGTH).toBe(64);
  });

  // Feature 01 Task 1 case 13 — fails until delivery constants are exported.
  it("exports delivery recipient constants with locked values", () => {
    expect(RECIPIENT_EMAIL_MAX_LENGTH).toBe(254);
    expect(RECIPIENT_EMAIL_ATTR_SIZE).toBe(320);
    expect(RECIPIENT_LIST_MAX).toBe(20);
  });

  // Stage 09 Feature 06 Task 1 case 1 — delivery visibility status constants.
  it("exports delivery visibility status constants with locked values", () => {
    expect(EMAIL_DELIVERY_STATUSES).toEqual(["none", "sent", "failed"]);
    expect(RSS_DELIVERY_STATUSES).toEqual(["none", "published", "failed"]);
    expect(DELIVERY_ERROR_MAX).toBe(2000);
    expect(DELIVERY_STATUS_ATTR_SIZE).toBe(16);
  });

  it("FEED_STATUSES is the canonical untested|ok|failed vocabulary", () => {
    expect(FEED_STATUSES).toEqual(["untested", "ok", "failed"]);
  });

  it("FEED_OPERATIONAL_HEALTH is the canonical healthy|unhealthy vocabulary", () => {
    expect(FEED_OPERATIONAL_HEALTH).toEqual(["healthy", "unhealthy"]);
  });

  it("FEED_UNHEALTHY_THRESHOLD is 3", () => {
    expect(FEED_UNHEALTHY_THRESHOLD).toBe(3);
  });

  it("RUN_STATUSES is the canonical pending|running|completed|failed vocabulary", () => {
    expect(RUN_STATUSES).toEqual(["pending", "running", "completed", "failed"]);
  });

  it("RUN_PHASES is the canonical fetch|scrape|tag|score|selection|draft vocabulary", () => {
    expect(RUN_PHASES).toEqual(["fetch", "scrape", "tag", "score", "selection", "draft"]);
  });

  it("RUN_CHECKPOINTS_BUCKET_ID is the canonical bucket id", () => {
    expect(RUN_CHECKPOINTS_BUCKET_ID).toBe("run_checkpoints");
  });

  it("the health_check collection is unchanged (id, perms, attributes)", () => {
    const hc = COLLECTIONS[0];
    expect(hc.id).toBe("health_check");
    expect(hc.name).toBe("Health Check");
    expect(hc.permissions).toEqual({ read: [], write: [] });
    expect(hc.attributes).toHaveLength(2);

    const status = hc.attributes.find((a) => a.key === "status");
    expect(status).toEqual({
      key: "status",
      type: "string",
      size: 255,
      required: true,
    });

    const createdAt = hc.attributes.find((a) => a.key === "createdAt");
    expect(createdAt).toEqual({
      key: "createdAt",
      type: "datetime",
      required: true,
    });

    expect(hc.attributes.map((a) => a.key).sort()).toEqual(["createdAt", "status"]);
  });

  it("declares feeds with display name, server-only perms, and Spec attributes", () => {
    const feeds = byId("feeds");
    expect(feeds).toBeDefined();
    expect(feeds!.name).toBe("Feeds");
    expect(feeds!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(feeds!.attributes.map((a) => [a.key, a]));
    expect(byKey.name).toMatchObject({
      type: "string",
      size: 255,
      required: true,
    });
    expect(byKey.name.array).toBeFalsy();

    expect(byKey.url).toMatchObject({
      type: "string",
      size: 2048,
      required: true,
    });
    expect(byKey.url.array).toBeFalsy();

    expect(byKey.notes).toMatchObject({
      type: "string",
      size: 2000,
      required: false,
    });
    expect(byKey.notes.array).toBeFalsy();

    expect(byKey.status).toMatchObject({
      type: "string",
      size: 32,
      required: true,
    });
    expect(byKey.status.array).toBeFalsy();

    expect(byKey.lastTestedAt).toMatchObject({
      type: "datetime",
      required: false,
    });
    expect(byKey.lastTestedAt.array).toBeFalsy();

    expect(byKey.lastTestError).toMatchObject({
      type: "string",
      size: 1000,
      required: false,
    });
    expect(byKey.lastTestError.array).toBeFalsy();

    expect(byKey.operationalHealth).toMatchObject({
      type: "string",
      size: 32,
      required: false,
      default: "healthy",
    });
    expect(byKey.operationalHealth.array).toBeFalsy();

    expect(byKey.consecutiveFetchFailures).toMatchObject({
      type: "number",
      required: false,
      default: 0,
    });
    expect(byKey.consecutiveFetchFailures.array).toBeFalsy();

    expect(byKey.lastFetchError).toMatchObject({
      type: "string",
      size: 1000,
      required: false,
    });
    expect(byKey.lastFetchError.array).toBeFalsy();

    expect(byKey.lastFetchAt).toMatchObject({
      type: "datetime",
      required: false,
    });
    expect(byKey.lastFetchAt.array).toBeFalsy();

    expect(byKey.createdAt).toMatchObject({
      type: "datetime",
      required: true,
    });
    expect(byKey.updatedAt).toMatchObject({
      type: "datetime",
      required: true,
    });

    expect(feeds!.attributes.map((a) => a.key).sort()).toEqual(
      [
        "consecutiveFetchFailures",
        "createdAt",
        "lastFetchAt",
        "lastFetchError",
        "lastTestedAt",
        "lastTestError",
        "name",
        "notes",
        "operationalHealth",
        "status",
        "updatedAt",
        "url",
      ].sort(),
    );
  });

  it("declares newsletters with array topics, defaults, and no feed-URL fields", () => {
    const newsletters = byId("newsletters");
    expect(newsletters).toBeDefined();
    expect(newsletters!.name).toBe("Newsletters");
    expect(newsletters!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(newsletters!.attributes.map((a) => [a.key, a]));

    expect(byKey.name).toMatchObject({
      type: "string",
      size: 255,
      required: true,
    });

    expect(byKey.topics).toMatchObject({
      type: "string",
      size: 128,
      required: false,
      array: true,
    });
    expect(byKey.topics).not.toHaveProperty("default");

    expect(byKey.dislikedTopics).toMatchObject({
      type: "string",
      size: 128,
      required: false,
      array: true,
    });
    expect(byKey.dislikedTopics).not.toHaveProperty("default");

    expect(byKey.audience).toMatchObject({
      type: "string",
      size: 2000,
      required: false,
    });
    expect(byKey.audience.array).toBeFalsy();

    expect(byKey.newsItems).toMatchObject({
      type: "number",
      required: false,
      default: 16,
    });
    expect(byKey.newsItems.array).toBeFalsy();

    expect(byKey.dateRange).toMatchObject({
      type: "string",
      size: 32,
      required: false,
      default: "yesterday",
    });
    expect(byKey.dateRange.array).toBeFalsy();

    expect(byKey.lookback).toMatchObject({
      type: "number",
      required: false,
      default: 3,
    });
    expect(byKey.lookback.array).toBeFalsy();

    expect(byKey.scheduleEnabled).toMatchObject({
      type: "boolean",
      required: false,
      default: false,
    });
    expect(byKey.scheduleEnabled.array).toBeFalsy();

    expect(byKey.scheduleCron).toMatchObject({
      type: "string",
      size: 128,
      required: false,
    });
    expect(byKey.scheduleCron.array).toBeFalsy();

    expect(byKey.scheduleTimezone).toMatchObject({
      type: "string",
      size: 64,
      required: false,
      default: "UTC",
    });
    expect(byKey.scheduleTimezone.array).toBeFalsy();

    expect(byKey.scheduleLastFiredAt).toMatchObject({
      type: "datetime",
      required: false,
    });
    expect(byKey.scheduleLastFiredAt.array).toBeFalsy();

    // Feature 01 delivery attributes (case 13).
    expect(byKey.recipientEmails).toMatchObject({
      type: "string",
      size: 320,
      required: false,
      array: true,
    });
    expect(byKey.recipientEmails).not.toHaveProperty("default");

    expect(byKey.autoEmail).toMatchObject({
      type: "boolean",
      required: false,
      default: false,
    });
    expect(byKey.autoEmail.array).toBeFalsy();

    expect(byKey.autoRss).toMatchObject({
      type: "boolean",
      required: false,
      default: false,
    });
    expect(byKey.autoRss.array).toBeFalsy();

    for (const key of ["taggerModel", "scorerModel", "drafterModel", "embedderModel"] as const) {
      expect(byKey[key]).toEqual({
        key,
        type: "string",
        size: 256,
        required: false,
      });
      expect(byKey[key].array).toBeFalsy();
    }

    expect(byKey.drafterPrompt).toEqual({
      key: "drafterPrompt",
      type: "string",
      size: 50000,
      required: false,
    });
    expect(byKey.drafterPrompt.array).toBeFalsy();

    expect(byKey.createdAt).toMatchObject({
      type: "datetime",
      required: true,
    });
    expect(byKey.updatedAt).toMatchObject({
      type: "datetime",
      required: true,
    });

    const keys = newsletters!.attributes.map((a) => a.key);
    expect(keys).not.toContain("url");
    expect(keys).not.toContain("feedUrl");
    expect(keys.sort()).toEqual(
      [
        "audience",
        "autoEmail",
        "autoRss",
        "createdAt",
        "dateRange",
        "dislikedTopics",
        "drafterModel",
        "drafterPrompt",
        "embedderModel",
        "lookback",
        "name",
        "newsItems",
        "recipientEmails",
        "scheduleCron",
        "scheduleEnabled",
        "scheduleLastFiredAt",
        "scheduleTimezone",
        "scorerModel",
        "taggerModel",
        "topics",
        "updatedAt",
      ].sort(),
    );
  });

  it("declares newsletter_feeds junction with string ids and createdAt only", () => {
    const junction = byId("newsletter_feeds");
    expect(junction).toBeDefined();
    expect(junction!.name).toBe("Newsletter Feeds");
    expect(junction!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(junction!.attributes.map((a) => [a.key, a]));

    expect(byKey.newsletterId).toMatchObject({
      type: "string",
      size: 64,
      required: true,
    });
    expect(byKey.feedId).toMatchObject({
      type: "string",
      size: 64,
      required: true,
    });
    expect(byKey.createdAt).toMatchObject({
      type: "datetime",
      required: true,
    });

    expect(junction!.attributes.map((a) => a.key).sort()).toEqual([
      "createdAt",
      "feedId",
      "newsletterId",
    ]);
  });

  it("all domain collections use server-only permissions", () => {
    for (const id of [
      "feeds",
      "newsletters",
      "newsletter_feeds",
      "runs",
      "app_settings",
      "prompt_templates",
      "rss_publications",
    ] as const) {
      const collection = byId(id);
      expect(collection).toBeDefined();
      expect(collection!.permissions).toEqual({ read: [], write: [] });
    }
  });

  // Feature 06 Task 1 case 1 — fails until trigger attribute is appended.
  it("declares runs.trigger as optional string size 32 defaulting to manual", () => {
    const runs = byId("runs");
    expect(runs).toBeDefined();
    const byKey = Object.fromEntries(runs!.attributes.map((a) => [a.key, a]));
    expect(byKey.trigger).toMatchObject({
      key: "trigger",
      type: "string",
      size: 32,
      required: false,
      default: "manual",
    });
    expect(byKey.trigger.array).toBeFalsy();
  });

  it("declares runs with display name, server-only perms, and Spec attributes", () => {
    const runs = byId("runs");
    expect(runs).toBeDefined();
    expect(runs!.name).toBe("Runs");
    expect(runs!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(runs!.attributes.map((a) => [a.key, a]));

    expect(byKey.newsletterId).toMatchObject({
      type: "string",
      size: 64,
      required: true,
    });
    expect(byKey.newsletterName).toMatchObject({
      type: "string",
      size: 255,
      required: true,
    });
    expect(byKey.status).toMatchObject({
      type: "string",
      size: 32,
      required: true,
    });
    expect(byKey.currentPhase).toMatchObject({
      type: "string",
      size: 32,
      required: false,
    });
    expect(byKey.completedPhase).toMatchObject({
      type: "string",
      size: 32,
      required: false,
    });
    expect(byKey.failedPhase).toMatchObject({
      type: "string",
      size: 32,
      required: false,
    });
    expect(byKey.failureMessage).toMatchObject({
      type: "string",
      size: 2000,
      required: false,
    });
    expect(byKey.startedAt).toMatchObject({
      type: "datetime",
      required: true,
    });
    expect(byKey.endedAt).toMatchObject({
      type: "datetime",
      required: false,
    });
    expect(byKey.topicSummary).toMatchObject({
      type: "string",
      size: 100000,
      required: false,
    });
    expect(byKey.failedFeeds).toMatchObject({
      type: "string",
      size: 20000,
      required: false,
    });
    expect(byKey.checkpointFetchId).toMatchObject({
      type: "string",
      size: 64,
      required: false,
    });
    expect(byKey.checkpointScrapeId).toMatchObject({
      type: "string",
      size: 64,
      required: false,
    });
    expect(byKey.checkpointTagId).toMatchObject({
      type: "string",
      size: 64,
      required: false,
    });
    expect(byKey.checkpointScoreId).toMatchObject({
      type: "string",
      size: 64,
      required: false,
    });
    expect(byKey.checkpointSelectionId).toMatchObject({
      type: "string",
      size: 64,
      required: false,
    });
    expect(byKey.checkpointDraftId).toMatchObject({
      type: "string",
      size: 64,
      required: false,
    });
    expect(byKey.suppressSummary).toMatchObject({
      type: "string",
      size: 100000,
      required: false,
    });

    // No array attributes on runs.
    for (const attr of runs!.attributes) {
      expect(attr.array).toBeFalsy();
    }

    expect(runs!.attributes).toHaveLength(25);
    expect(runs!.attributes.map((a) => a.key).sort()).toEqual(
      [
        "checkpointDraftId",
        "checkpointFetchId",
        "checkpointScoreId",
        "checkpointScrapeId",
        "checkpointSelectionId",
        "checkpointTagId",
        "completedPhase",
        "currentPhase",
        "emailDeliveryAt",
        "emailDeliveryError",
        "emailDeliveryStatus",
        "endedAt",
        "failedFeeds",
        "failedPhase",
        "failureMessage",
        "newsletterId",
        "newsletterName",
        "rssDeliveryAt",
        "rssDeliveryError",
        "rssDeliveryStatus",
        "startedAt",
        "status",
        "suppressSummary",
        "topicSummary",
        "trigger",
      ].sort(),
    );
  });

  // Stage 09 Feature 06 Task 1 case 1 — six delivery visibility attributes on runs.
  it("declares runs delivery visibility attributes with locked sizes and defaults", () => {
    const runs = byId("runs");
    expect(runs).toBeDefined();
    const byKey = Object.fromEntries(runs!.attributes.map((a) => [a.key, a]));

    expect(byKey.emailDeliveryStatus).toMatchObject({
      key: "emailDeliveryStatus",
      type: "string",
      size: DELIVERY_STATUS_ATTR_SIZE,
      required: false,
      default: "none",
    });
    expect(byKey.emailDeliveryStatus.array).toBeFalsy();

    expect(byKey.emailDeliveryAt).toMatchObject({
      key: "emailDeliveryAt",
      type: "datetime",
      required: false,
    });
    expect(byKey.emailDeliveryAt.array).toBeFalsy();

    expect(byKey.emailDeliveryError).toMatchObject({
      key: "emailDeliveryError",
      type: "string",
      size: DELIVERY_ERROR_MAX,
      required: false,
    });
    expect(byKey.emailDeliveryError.array).toBeFalsy();

    expect(byKey.rssDeliveryStatus).toMatchObject({
      key: "rssDeliveryStatus",
      type: "string",
      size: DELIVERY_STATUS_ATTR_SIZE,
      required: false,
      default: "none",
    });
    expect(byKey.rssDeliveryStatus.array).toBeFalsy();

    expect(byKey.rssDeliveryAt).toMatchObject({
      key: "rssDeliveryAt",
      type: "datetime",
      required: false,
    });
    expect(byKey.rssDeliveryAt.array).toBeFalsy();

    expect(byKey.rssDeliveryError).toMatchObject({
      key: "rssDeliveryError",
      type: "string",
      size: DELIVERY_ERROR_MAX,
      required: false,
    });
    expect(byKey.rssDeliveryError.array).toBeFalsy();
  });

  it("declares app_settings with display name, server-only perms, and Spec attributes", () => {
    const settings = byId("app_settings");
    expect(settings).toBeDefined();
    expect(settings!.name).toBe("App Settings");
    expect(settings!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(settings!.attributes.map((a) => [a.key, a]));

    expect(byKey.runRetentionDays).toEqual({
      key: "runRetentionDays",
      type: "number",
      required: true,
    });
    expect(byKey.runRetentionDays.array).toBeFalsy();

    expect(byKey.updatedAt).toEqual({
      key: "updatedAt",
      type: "datetime",
      required: true,
    });
    expect(byKey.updatedAt.array).toBeFalsy();

    for (const key of ["taggerModel", "scorerModel", "drafterModel", "embedderModel"] as const) {
      expect(byKey[key]).toEqual({
        key,
        type: "string",
        size: 256,
        required: false,
      });
      expect(byKey[key].array).toBeFalsy();
    }

    expect(settings!.attributes).toHaveLength(6);
    expect(settings!.attributes.map((a) => a.key).sort()).toEqual(
      [
        "drafterModel",
        "embedderModel",
        "runRetentionDays",
        "scorerModel",
        "taggerModel",
        "updatedAt",
      ].sort(),
    );
  });

  it("declares prompt_templates with display name, server-only perms, and Spec attributes", () => {
    const prompts = byId("prompt_templates");
    expect(prompts).toBeDefined();
    expect(prompts!.name).toBe("Prompt Templates");
    expect(prompts!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(prompts!.attributes.map((a) => [a.key, a]));

    expect(byKey.body).toEqual({
      key: "body",
      type: "string",
      size: 50000,
      required: true,
    });
    expect(byKey.body.array).toBeFalsy();

    expect(byKey.updatedAt).toEqual({
      key: "updatedAt",
      type: "datetime",
      required: true,
    });
    expect(byKey.updatedAt.array).toBeFalsy();

    expect(prompts!.attributes).toHaveLength(2);
    expect(prompts!.attributes.map((a) => a.key).sort()).toEqual(
      ["body", "updatedAt"].sort(),
    );
    expect(prompts!.attributes.map((a) => a.key)).not.toContain("role");
  });

  // Feature 03 Task 2 — rss_publications snapshot collection.
  // Document `$id` = `runId` (asserted via constant docs / upsert contract in Task 3).
  it("declares rss_publications with display name, server-only perms, and Spec attributes", () => {
    const pubs = byId("rss_publications");
    expect(pubs).toBeDefined();
    expect(pubs!.id).toBe(RSS_PUBLICATIONS_COLLECTION_ID);
    expect(pubs!.name).toBe("RSS Publications");
    expect(pubs!.permissions).toEqual({ read: [], write: [] });

    const byKey = Object.fromEntries(pubs!.attributes.map((a) => [a.key, a]));

    expect(byKey.newsletterId).toEqual({
      key: "newsletterId",
      type: "string",
      size: 64,
      required: true,
    });
    expect(byKey.newsletterId.array).toBeFalsy();

    expect(byKey.runId).toEqual({
      key: "runId",
      type: "string",
      size: 64,
      required: true,
    });
    expect(byKey.runId.array).toBeFalsy();

    expect(byKey.title).toEqual({
      key: "title",
      type: "string",
      size: RSS_TITLE_ATTR_SIZE,
      required: true,
    });
    expect(byKey.title.size).toBe(512);
    expect(byKey.title.array).toBeFalsy();

    expect(byKey.htmlBody).toEqual({
      key: "htmlBody",
      type: "string",
      size: RSS_HTML_BODY_ATTR_SIZE,
      required: true,
    });
    expect(byKey.htmlBody.size).toBe(200000);
    expect(byKey.htmlBody.array).toBeFalsy();

    expect(byKey.pubDate).toEqual({
      key: "pubDate",
      type: "datetime",
      required: true,
    });
    expect(byKey.pubDate.array).toBeFalsy();

    expect(byKey.updatedAt).toEqual({
      key: "updatedAt",
      type: "datetime",
      required: true,
    });
    expect(byKey.updatedAt.array).toBeFalsy();

    for (const attr of pubs!.attributes) {
      expect(attr.array).toBeFalsy();
    }

    expect(pubs!.attributes).toHaveLength(6);
    expect(pubs!.attributes.map((a) => a.key).sort()).toEqual(
      ["htmlBody", "newsletterId", "pubDate", "runId", "title", "updatedAt"].sort(),
    );
  });

  it("BUCKETS has exactly one bucket with the run_checkpoints settings", () => {
    expect(Array.isArray(BUCKETS)).toBe(true);
    expect(BUCKETS).toHaveLength(1);

    const bucket = BUCKETS[0];
    expect(bucket.id).toBe("run_checkpoints");
    expect(bucket.name).toBe("Run Checkpoints");
    expect(bucket.permissions).toEqual([]);
    expect(bucket.fileSecurity).toBe(false);
    expect(bucket.enabled).toBe(true);
    expect(bucket.maximumFileSize).toBe(30000000);
    expect(bucket.allowedFileExtensions).toEqual(["json"]);
  });

  it("COLLECTIONS is assignable to SchemaCollection[] at compile time", () => {
    // The real assertion is the compile-time line above; this mirrors it at runtime.
    expect(_check).toBe(COLLECTIONS);
  });

  it("BUCKETS is assignable to SchemaBucket[] at compile time", () => {
    // The real assertion is the compile-time line above; this mirrors it at runtime.
    expect(_bucketCheck).toBe(BUCKETS);
  });
});
