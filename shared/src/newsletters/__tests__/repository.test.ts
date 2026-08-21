import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import { Query } from "node-appwrite";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
  uniqueId: "newsletter-doc-unique-id",
}));

vi.mock("node-appwrite", async (importActual) => {
  const actual = await importActual<typeof import("node-appwrite")>();
  return {
    ...actual,
    ID: {
      ...actual.ID,
      unique: () => mockHolder.uniqueId,
    },
    Databases: class MockDatabasesConstructor {
      constructor() {
        return mockHolder.databases as unknown as MockDatabasesConstructor;
      }
    },
  };
});

import {
  DATABASE_ID,
  DEFAULT_LOOKBACK,
  DEFAULT_SCHEDULE_TIMEZONE,
  FEEDS_COLLECTION_ID,
  NEWSLETTER_FEEDS_COLLECTION_ID,
  NEWSLETTERS_COLLECTION_ID,
} from "../../schema/declarations";
import {
  NEWSLETTER_LIST_LIMIT,
  createNewsletter,
  deleteNewsletter,
  getNewsletter,
  listAllNewslettersForDueCheck,
  listNewsletters,
  setScheduleLastFiredAt,
  updateNewsletter,
  updateNewsletterDelivery,
  updateNewsletterSchedule,
} from "../repository";
import { NewsletterRepositoryError } from "../types";
import {
  MockNewslettersDatabases,
  appwriteException,
  fakeClient,
  mockJunctionDocument,
  mockNewsletterDocument,
} from "./mock-client";

const SECRET_API_KEY = "sk-secret-do-not-leak-1234567890";

function expectRepoError(
  promise: Promise<unknown>,
  code: NewsletterRepositoryError["code"],
): Promise<NewsletterRepositoryError> {
  return promise.then(
    () => {
      throw new Error(`Expected NewsletterRepositoryError with code ${code}`);
    },
    (err) => {
      expect(err).toBeInstanceOf(NewsletterRepositoryError);
      const repoErr = err as NewsletterRepositoryError;
      expect(repoErr.code).toBe(code);
      return repoErr;
    },
  );
}

describe("createNewsletter", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    mockHolder.uniqueId = "newsletter-doc-unique-id";
    client = fakeClient();
  });

  it("writes fields including empty arrays, audience empty string, defaults, and timestamps", async () => {
    const before = Date.now();
    const newsletter = await createNewsletter(client, {
      name: "  My Newsletter  ",
      topics: ["  AI  ", "ML"],
      dislikedTopics: [],
      audience: "  ",
    });
    const after = Date.now();

    expect(docs.createDocumentCalls).toHaveLength(1);
    const call = docs.createDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(NEWSLETTERS_COLLECTION_ID);
    expect(call.documentId).toBe("newsletter-doc-unique-id");
    expect(call.data).toMatchObject({
      name: "My Newsletter",
      topics: ["AI", "ML"],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
    });

    const createdAt = new Date(String(call.data.createdAt)).getTime();
    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);

    expect(newsletter.$id).toBe("newsletter-doc-unique-id");
    expect(newsletter.name).toBe("My Newsletter");
    expect(newsletter.topics).toEqual(["AI", "ML"]);
    expect(newsletter.dislikedTopics).toEqual([]);
    expect(newsletter.audience).toBe("");
    expect(newsletter.newsItems).toBe(16);
    expect(newsletter.dateRange).toBe("yesterday");
  });

  it("applies defaults for omitted newsItems and dateRange", async () => {
    await createNewsletter(client, { name: "Defaults" });

    const call = docs.createDocumentCalls[0]!;
    expect(call.data.newsItems).toBe(16);
    expect(call.data.dateRange).toBe("yesterday");
  });

  it("rejects an invalid name without writing", async () => {
    await expectRepoError(createNewsletter(client, { name: "bad/name" }), "validation");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("rejects out-of-range newsItems without writing", async () => {
    await expectRepoError(createNewsletter(client, { name: "x", newsItems: 101 }), "validation");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("writes lookback: DEFAULT_LOOKBACK (3) when omitted", async () => {
    await createNewsletter(client, { name: "Lookback Default" });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data.lookback).toBe(DEFAULT_LOOKBACK);
    expect(call.data.lookback).toBe(3);
  });

  it("writes an explicit lookback including 0", async () => {
    await createNewsletter(client, { name: "Lookback Zero", lookback: 0 });
    await createNewsletter(client, { name: "Lookback Ten", lookback: 10 });
    expect(docs.createDocumentCalls[0]!.data.lookback).toBe(0);
    expect(docs.createDocumentCalls[1]!.data.lookback).toBe(10);
  });

  it("rejects an out-of-range lookback without writing", async () => {
    await expectRepoError(
      createNewsletter(client, { name: "Bad Lookback", lookback: 11 }),
      "validation",
    );
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("persists five model override fields as empty strings when omitted", async () => {
    const newsletter = await createNewsletter(client, { name: "Model Defaults" });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
      titleDekModel: "",
    });
    expect(newsletter.taggerModel).toBe("");
    expect(newsletter.scorerModel).toBe("");
    expect(newsletter.drafterModel).toBe("");
    expect(newsletter.embedderModel).toBe("");
    expect(newsletter.titleDekModel).toBe("");
  });

  // Feature 03 Task 1 — item 14
  it("persists drafterPrompt as empty string when omitted on create", async () => {
    const newsletter = await createNewsletter(client, { name: "Drafter Prompt Default" });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data.drafterPrompt).toBe("");
    expect(newsletter.drafterPrompt).toBe("");
  });

  it("persists non-empty model overrides on create", async () => {
    const free = "meta-llama/llama-3.2-3b-instruct:free";
    const newsletter = await createNewsletter(client, {
      name: "Model Overrides",
      taggerModel: "openai/gpt-4o-mini",
      scorerModel: free,
      drafterModel: "google/gemini-2.0-flash",
      embedderModel: "openai/text-embedding-3-small",
      titleDekModel: "vendor/title-dek",
    });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      taggerModel: "openai/gpt-4o-mini",
      scorerModel: free,
      drafterModel: "google/gemini-2.0-flash",
      embedderModel: "openai/text-embedding-3-small",
      titleDekModel: "vendor/title-dek",
    });
    expect(newsletter.taggerModel).toBe("openai/gpt-4o-mini");
    expect(newsletter.scorerModel).toBe(free);
    expect(newsletter.drafterModel).toBe("google/gemini-2.0-flash");
    expect(newsletter.embedderModel).toBe("openai/text-embedding-3-small");
    expect(newsletter.titleDekModel).toBe("vendor/title-dek");
  });

  it("rejects an invalid titleDekModel override without writing", async () => {
    await expectRepoError(
      createNewsletter(client, {
        name: "Bad Title Dek",
        titleDekModel: "not-valid",
      }),
      "validation",
    );
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("rejects an invalid model override without writing", async () => {
    await expectRepoError(
      createNewsletter(client, {
        name: "Bad Model",
        topics: ["AI"],
        newsItems: 16,
        dateRange: "yesterday",
        lookback: 3,
        taggerModel: "not-valid",
        scorerModel: "openai/gpt-4o-mini",
        drafterModel: "",
        embedderModel: "",
        titleDekModel: "",
      }),
      "validation",
    );
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("writes schedule defaults when omitted (disabled, empty cron, UTC timezone)", async () => {
    const newsletter = await createNewsletter(client, { name: "Schedule Defaults" });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      scheduleEnabled: false,
      scheduleCron: "",
      scheduleTimezone: DEFAULT_SCHEDULE_TIMEZONE,
    });
    expect(call.data.scheduleTimezone).toBe("UTC");
    expect(newsletter.scheduleEnabled).toBe(false);
    expect(newsletter.scheduleCron).toBe("");
    expect(newsletter.scheduleTimezone).toBe("UTC");
  });

  it("writes scheduleLastFiredAt: null on create", async () => {
    const newsletter = await createNewsletter(client, { name: "Stamp Default" });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data.scheduleLastFiredAt).toBeNull();
    expect(newsletter.scheduleLastFiredAt).toBeNull();
  });

  // Feature 01 case 9 — create always persists delivery defaults.
  it("writes delivery defaults when omitted (empty recipients, both autos false)", async () => {
    const newsletter = await createNewsletter(client, { name: "Delivery Defaults" });
    const call = docs.createDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      recipientEmails: [],
      autoEmail: false,
      autoRss: false,
    });
    expect(newsletter.recipientEmails).toEqual([]);
    expect(newsletter.autoEmail).toBe(false);
    expect(newsletter.autoRss).toBe(false);
  });
});

describe("listNewsletters", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("fetches with Query.limit(100) and sorts by updatedAt desc (tie-break $id asc)", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 3,
        documents: [
          mockNewsletterDocument({
            $id: "nl-a",
            name: "A",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
          mockNewsletterDocument({
            $id: "nl-c",
            name: "C",
            updatedAt: "2026-03-01T00:00:00.000Z",
          }),
          mockNewsletterDocument({
            $id: "nl-b",
            name: "B",
            updatedAt: "2026-03-01T00:00:00.000Z",
          }),
        ],
      };
    };

    const newsletters = await listNewsletters(client);

    const listCall = docs.listDocumentsCalls.find(
      (c) => c.collectionId === NEWSLETTERS_COLLECTION_ID,
    );
    expect(listCall).toBeDefined();
    expect(listCall!.queries).toContainEqual(Query.limit(100));

    expect(newsletters.map((n) => n.$id)).toEqual(["nl-b", "nl-c", "nl-a"]);
    expect(newsletters[0]).toMatchObject({
      $id: "nl-b",
      name: "B",
      topics: ["AI"],
      newsItems: 16,
      dateRange: "yesterday",
    });
  });

  it("returns an empty array when there are no newsletters", async () => {
    const newsletters = await listNewsletters(client);
    expect(newsletters).toEqual([]);
  });

  it("maps lookback from each document", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 2,
        documents: [
          mockNewsletterDocument({ $id: "nl-a", lookback: 0 }),
          mockNewsletterDocument({ $id: "nl-b", lookback: 7 }),
        ],
      };
    };
    const newsletters = await listNewsletters(client);
    const byId = Object.fromEntries(newsletters.map((n) => [n.$id, n.lookback]));
    expect(byId["nl-a"]).toBe(0);
    expect(byId["nl-b"]).toBe(7);
  });

  it("coerces a missing/null/undefined lookback to DEFAULT_LOOKBACK (3)", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 2,
        documents: [
          mockNewsletterDocument({ $id: "nl-null", lookback: null }),
          mockNewsletterDocument({ $id: "nl-missing" }),
        ],
      };
    };
    const newsletters = await listNewsletters(client);
    const byId = Object.fromEntries(newsletters.map((n) => [n.$id, n.lookback]));
    expect(byId["nl-null"]).toBe(DEFAULT_LOOKBACK);
    expect(byId["nl-null"]).toBe(3);
    expect(byId["nl-missing"]).toBe(3);
  });

  it("maps model override fields from each document", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 1,
        documents: [
          mockNewsletterDocument({
            $id: "nl-models",
            taggerModel: "openai/gpt-4o-mini",
            scorerModel: "anthropic/claude-3.5-sonnet",
            drafterModel: "google/gemini-2.0-flash",
            embedderModel: "openai/text-embedding-3-small",
            titleDekModel: "vendor/title-dek",
          }),
        ],
      };
    };
    const [newsletter] = await listNewsletters(client);
    expect(newsletter).toMatchObject({
      taggerModel: "openai/gpt-4o-mini",
      scorerModel: "anthropic/claude-3.5-sonnet",
      drafterModel: "google/gemini-2.0-flash",
      embedderModel: "openai/text-embedding-3-small",
      titleDekModel: "vendor/title-dek",
    });
  });

  it("maps missing model override attrs to empty strings", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 2,
        documents: [
          mockNewsletterDocument({ $id: "nl-missing-models" }),
          mockNewsletterDocument({
            $id: "nl-null-models",
            taggerModel: null,
            scorerModel: null,
            drafterModel: null,
            embedderModel: null,
            titleDekModel: null,
          }),
        ],
      };
    };
    const newsletters = await listNewsletters(client);
    for (const newsletter of newsletters) {
      expect(newsletter.taggerModel).toBe("");
      expect(newsletter.scorerModel).toBe("");
      expect(newsletter.drafterModel).toBe("");
      expect(newsletter.embedderModel).toBe("");
      expect(newsletter.titleDekModel).toBe("");
    }
  });

  it("coerces missing/null/undefined schedule fields to disabled, empty cron, and UTC timezone", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 3,
        documents: [
          mockNewsletterDocument({ $id: "nl-sched-missing" }),
          mockNewsletterDocument({
            $id: "nl-sched-null",
            scheduleEnabled: null,
            scheduleCron: null,
            scheduleTimezone: null,
          }),
          mockNewsletterDocument({
            $id: "nl-sched-undefined",
            scheduleEnabled: undefined,
            scheduleCron: undefined,
            scheduleTimezone: undefined,
          }),
        ],
      };
    };
    const newsletters = await listNewsletters(client);
    for (const newsletter of newsletters) {
      expect(newsletter.scheduleEnabled).toBe(false);
      expect(newsletter.scheduleCron).toBe("");
      expect(newsletter.scheduleTimezone).toBe(DEFAULT_SCHEDULE_TIMEZONE);
      expect(newsletter.scheduleTimezone).toBe("UTC");
    }
  });

  it("coerces missing/null scheduleLastFiredAt to null", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 2,
        documents: [
          mockNewsletterDocument({ $id: "nl-stamp-missing" }),
          mockNewsletterDocument({ $id: "nl-stamp-null", scheduleLastFiredAt: null }),
        ],
      };
    };
    const newsletters = await listNewsletters(client);
    for (const newsletter of newsletters) {
      expect(newsletter.scheduleLastFiredAt).toBeNull();
    }
  });

  // Feature 01 case 12 — missing/null/undefined delivery attrs coerce on read.
  it("coerces missing/null/undefined delivery fields to empty recipients and both autos false", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== NEWSLETTERS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 3,
        documents: [
          mockNewsletterDocument({ $id: "nl-delivery-missing" }),
          mockNewsletterDocument({
            $id: "nl-delivery-null",
            recipientEmails: null,
            autoEmail: null,
            autoRss: null,
          }),
          mockNewsletterDocument({
            $id: "nl-delivery-undefined",
            recipientEmails: undefined,
            autoEmail: undefined,
            autoRss: undefined,
          }),
        ],
      };
    };
    const newsletters = await listNewsletters(client);
    for (const newsletter of newsletters) {
      expect(newsletter.recipientEmails).toEqual([]);
      expect(newsletter.autoEmail).toBe(false);
      expect(newsletter.autoRss).toBe(false);
    }
  });
});

describe("getNewsletter", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-to-get";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns a mapped newsletter when the document exists", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: newsletterId,
        name: "My Newsletter",
        topics: ["AI", "ML"],
        dislikedTopics: ["Crypto"],
        audience: "fintech",
        newsItems: 25,
        dateRange: "last_week",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      };
    };

    const newsletter = await getNewsletter(client, newsletterId);

    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: newsletterId,
    });
    expect(newsletter).toMatchObject({
      $id: newsletterId,
      name: "My Newsletter",
      topics: ["AI", "ML"],
      dislikedTopics: ["Crypto"],
      audience: "fintech",
      newsItems: 25,
      dateRange: "last_week",
    });
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(getNewsletter(client, newsletterId), "not_found");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("maps lookback from the document", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return { ...doc, lookback: 8 };
    };
    const newsletter = await getNewsletter(client, newsletterId);
    expect(newsletter.lookback).toBe(8);
  });

  it("coerces a missing lookback to DEFAULT_LOOKBACK (3)", async () => {
    const newsletter = await getNewsletter(client, newsletterId);
    expect(newsletter.lookback).toBe(DEFAULT_LOOKBACK);
    expect(newsletter.lookback).toBe(3);
  });

  it("maps model overrides from the document", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        taggerModel: "openai/gpt-4o-mini",
        scorerModel: "anthropic/claude-3.5-sonnet",
        drafterModel: "google/gemini-2.0-flash",
        embedderModel: "openai/text-embedding-3-small",
        titleDekModel: "vendor/title-dek",
      };
    };
    const newsletter = await getNewsletter(client, newsletterId);
    expect(newsletter.taggerModel).toBe("openai/gpt-4o-mini");
    expect(newsletter.scorerModel).toBe("anthropic/claude-3.5-sonnet");
    expect(newsletter.drafterModel).toBe("google/gemini-2.0-flash");
    expect(newsletter.embedderModel).toBe("openai/text-embedding-3-small");
    expect(newsletter.titleDekModel).toBe("vendor/title-dek");
  });

  it("maps missing model override attrs to empty strings", async () => {
    const newsletter = await getNewsletter(client, newsletterId);
    expect(newsletter.taggerModel).toBe("");
    expect(newsletter.scorerModel).toBe("");
    expect(newsletter.drafterModel).toBe("");
    expect(newsletter.embedderModel).toBe("");
    expect(newsletter.titleDekModel).toBe("");
  });

  it("coerces missing/null schedule fields to disabled, empty cron, and UTC timezone", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        scheduleEnabled: null,
        scheduleCron: null,
        scheduleTimezone: null,
      };
    };
    const newsletter = await getNewsletter(client, newsletterId);
    expect(newsletter.scheduleEnabled).toBe(false);
    expect(newsletter.scheduleCron).toBe("");
    expect(newsletter.scheduleTimezone).toBe(DEFAULT_SCHEDULE_TIMEZONE);
    expect(newsletter.scheduleTimezone).toBe("UTC");
  });

  it("coerces missing schedule attributes to disabled, empty cron, and UTC timezone", async () => {
    const newsletter = await getNewsletter(client, newsletterId);
    expect(newsletter.scheduleEnabled).toBe(false);
    expect(newsletter.scheduleCron).toBe("");
    expect(newsletter.scheduleTimezone).toBe("UTC");
  });

  it("coerces missing/null scheduleLastFiredAt to null", async () => {
    const missing = await getNewsletter(client, newsletterId);
    expect(missing.scheduleLastFiredAt).toBeNull();

    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return { ...doc, scheduleLastFiredAt: null };
    };
    const nulled = await getNewsletter(client, newsletterId);
    expect(nulled.scheduleLastFiredAt).toBeNull();
  });

  // Feature 01 case 12 — getNewsletter coerce path.
  it("coerces missing/null delivery fields to empty recipients and both autos false", async () => {
    const missing = await getNewsletter(client, newsletterId);
    expect(missing.recipientEmails).toEqual([]);
    expect(missing.autoEmail).toBe(false);
    expect(missing.autoRss).toBe(false);

    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        recipientEmails: null,
        autoEmail: null,
        autoRss: null,
      };
    };
    const nulled = await getNewsletter(client, newsletterId);
    expect(nulled.recipientEmails).toEqual([]);
    expect(nulled.autoEmail).toBe(false);
    expect(nulled.autoRss).toBe(false);
  });
});

describe("updateNewsletter", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-to-update";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  const blankModels = {
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    titleDekModel: "",
    drafterPrompt: "",
  };

  it("writes the full field set including empty arrays and bumps updatedAt", async () => {
    const before = Date.now();
    const newsletter = await updateNewsletter(client, newsletterId, {
      name: "  Updated Name  ",
      topics: ["AI"],
      dislikedTopics: [],
      audience: "  new audience  ",
      newsItems: 30,
      dateRange: "all",
      lookback: 3,
      ...blankModels,
    });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(NEWSLETTERS_COLLECTION_ID);
    expect(call.documentId).toBe(newsletterId);
    expect(call.data).toMatchObject({
      name: "Updated Name",
      topics: ["AI"],
      dislikedTopics: [],
      audience: "new audience",
      newsItems: 30,
      dateRange: "all",
    });
    expect(Object.keys(call.data)).toContain("topics");
    expect(Object.keys(call.data)).toContain("dislikedTopics");
    expect(Object.keys(call.data)).toContain("audience");

    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);

    expect(newsletter.$id).toBe(newsletterId);
    expect(newsletter.name).toBe("Updated Name");
  });

  it("writes empty arrays and empty audience explicitly so prior values clear", async () => {
    await updateNewsletter(client, newsletterId, {
      name: "Cleared",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      ...blankModels,
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.topics).toEqual([]);
    expect(call.data.dislikedTopics).toEqual([]);
    expect(call.data.audience).toBe("");
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.updateDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(
      updateNewsletter(client, newsletterId, {
        name: "x",
        topics: [],
        dislikedTopics: [],
        audience: "",
        newsItems: 16,
        dateRange: "yesterday",
        lookback: 3,
        ...blankModels,
      }),
      "not_found",
    );
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("rejects an invalid field without writing", async () => {
    await expectRepoError(
      updateNewsletter(client, newsletterId, {
        name: "bad\\name",
        topics: [],
        dislikedTopics: [],
        audience: "",
        newsItems: 16,
        dateRange: "yesterday",
        lookback: 3,
        ...blankModels,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("writes the submitted lookback and bumps updatedAt", async () => {
    const before = Date.now();
    await updateNewsletter(client, newsletterId, {
      name: "Updated",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 5,
      ...blankModels,
    });
    const after = Date.now();
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.lookback).toBe(5);
    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });

  it("rejects an out-of-range lookback without writing", async () => {
    await expectRepoError(
      updateNewsletter(client, newsletterId, {
        name: "x",
        topics: [],
        dislikedTopics: [],
        audience: "",
        newsItems: 16,
        dateRange: "yesterday",
        lookback: 11,
        ...blankModels,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("writes non-empty model overrides on update", async () => {
    const free = "meta-llama/llama-3.2-3b-instruct:free";
    const newsletter = await updateNewsletter(client, newsletterId, {
      name: "Updated Models",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      taggerModel: "openai/gpt-4o-mini",
      scorerModel: free,
      drafterModel: "google/gemini-2.0-flash",
      embedderModel: "openai/text-embedding-3-small",
      titleDekModel: "vendor/title-dek",
      drafterPrompt: "",
    });
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      taggerModel: "openai/gpt-4o-mini",
      scorerModel: free,
      drafterModel: "google/gemini-2.0-flash",
      embedderModel: "openai/text-embedding-3-small",
      titleDekModel: "vendor/title-dek",
    });
    expect(newsletter.taggerModel).toBe("openai/gpt-4o-mini");
    expect(newsletter.scorerModel).toBe(free);
    expect(newsletter.drafterModel).toBe("google/gemini-2.0-flash");
    expect(newsletter.embedderModel).toBe("openai/text-embedding-3-small");
    expect(newsletter.titleDekModel).toBe("vendor/title-dek");
  });

  it("clears model overrides back to empty strings on update", async () => {
    await updateNewsletter(client, newsletterId, {
      name: "Cleared Models",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      taggerModel: "",
      scorerModel: "",
      drafterModel: "",
      embedderModel: "",
      titleDekModel: "",
      drafterPrompt: "",
    });
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.taggerModel).toBe("");
    expect(call.data.scorerModel).toBe("");
    expect(call.data.drafterModel).toBe("");
    expect(call.data.embedderModel).toBe("");
    expect(call.data.titleDekModel).toBe("");
  });

  // Feature 03 Task 1 — items 12–13
  it("persists a valid drafterPrompt override on update", async () => {
    const body = 'Write for {newsletter_name}. Topics: {topics}. Count: {count}. Articles: {articles_json}.';
    const newsletter = await updateNewsletter(client, newsletterId, {
      name: "Override Drafter",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      ...blankModels,
      drafterPrompt: body,
    });
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.drafterPrompt).toBe(body);
    expect(newsletter.drafterPrompt).toBe(body);
  });

  it("clears drafterPrompt to empty string on update when blank", async () => {
    await updateNewsletter(client, newsletterId, {
      name: "Clear Drafter Prompt",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      ...blankModels,
      drafterPrompt: "   ",
    });
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.drafterPrompt).toBe("");
  });

  it("rejects invalid drafterPrompt override without writing", async () => {
    await expectRepoError(
      updateNewsletter(client, newsletterId, {
        name: "x",
        topics: [],
        dislikedTopics: [],
        audience: "",
        newsItems: 16,
        dateRange: "yesterday",
        lookback: 3,
        ...blankModels,
        drafterPrompt: 'Missing required placeholders only {topics} {count}',
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects an invalid model override without writing", async () => {
    await expectRepoError(
      updateNewsletter(client, newsletterId, {
        name: "x",
        topics: [],
        dislikedTopics: [],
        audience: "",
        newsItems: 16,
        dateRange: "yesterday",
        lookback: 3,
        taggerModel: "openai/gpt-4o-mini",
        scorerModel: "invalid-no-slash",
        drafterModel: "",
        embedderModel: "",
        titleDekModel: "",
        drafterPrompt: "",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("does not include schedule fields in the updateDocument payload", async () => {
    await updateNewsletter(client, newsletterId, {
      name: "Updated",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      ...blankModels,
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).not.toHaveProperty("scheduleEnabled");
    expect(call.data).not.toHaveProperty("scheduleCron");
    expect(call.data).not.toHaveProperty("scheduleTimezone");
    expect(call.data).not.toHaveProperty("scheduleLastFiredAt");
  });

  // Feature 01 case 10 — definition update must not overwrite delivery keys.
  it("does not include delivery fields in the updateDocument payload", async () => {
    await updateNewsletter(client, newsletterId, {
      name: "Updated",
      topics: [],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      lookback: 3,
      ...blankModels,
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).not.toHaveProperty("recipientEmails");
    expect(call.data).not.toHaveProperty("autoEmail");
    expect(call.data).not.toHaveProperty("autoRss");
  });
});

describe("updateNewsletterSchedule", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-schedule-update";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("writes schedule fields and updatedAt on success", async () => {
    const before = Date.now();
    const newsletter = await updateNewsletterSchedule(client, newsletterId, {
      scheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
    });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(NEWSLETTERS_COLLECTION_ID);
    expect(call.documentId).toBe(newsletterId);
    expect(call.data).toMatchObject({
      scheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
      scheduleLastFiredAt: null,
    });
    expect(call.data.scheduleLastFiredAt).toBeNull();

    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);

    expect(newsletter.scheduleEnabled).toBe(true);
    expect(newsletter.scheduleCron).toBe("0 9 * * 1-5");
    expect(newsletter.scheduleTimezone).toBe("America/New_York");
  });

  it("clears scheduleLastFiredAt to null on every successful schedule write", async () => {
    await updateNewsletterSchedule(client, newsletterId, {
      scheduleEnabled: false,
      scheduleCron: "",
      scheduleTimezone: "UTC",
    });
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.scheduleLastFiredAt).toBeNull();
  });

  it("rejects invalid schedule without calling Appwrite", async () => {
    await expectRepoError(
      updateNewsletterSchedule(client, newsletterId, {
        scheduleEnabled: true,
        scheduleCron: "",
        scheduleTimezone: "UTC",
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.updateDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(
      updateNewsletterSchedule(client, newsletterId, {
        scheduleEnabled: false,
        scheduleCron: "",
        scheduleTimezone: "UTC",
      }),
      "not_found",
    );
    expect(err.message.length).toBeGreaterThan(0);
  });
});

// Feature 01 case 11 — dedicated delivery write path.
describe("updateNewsletterDelivery", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-delivery-update";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("writes delivery fields and updatedAt on success", async () => {
    const before = Date.now();
    const newsletter = await updateNewsletterDelivery(client, newsletterId, {
      recipientEmails: ["Alice@Example.COM", "bob@example.org"],
      autoEmail: true,
      autoRss: false,
    });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(NEWSLETTERS_COLLECTION_ID);
    expect(call.documentId).toBe(newsletterId);
    expect(call.data).toMatchObject({
      recipientEmails: ["alice@example.com", "bob@example.org"],
      autoEmail: true,
      autoRss: false,
    });

    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);

    expect(newsletter.recipientEmails).toEqual(["alice@example.com", "bob@example.org"]);
    expect(newsletter.autoEmail).toBe(true);
    expect(newsletter.autoRss).toBe(false);
  });

  it("rejects invalid delivery without calling Appwrite", async () => {
    await expectRepoError(
      updateNewsletterDelivery(client, newsletterId, {
        recipientEmails: ["not-an-email"],
        autoEmail: false,
        autoRss: false,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);

    await expectRepoError(
      updateNewsletterDelivery(client, newsletterId, {
        recipientEmails: [],
        autoEmail: true,
        autoRss: false,
      }),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.updateDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(
      updateNewsletterDelivery(client, newsletterId, {
        recipientEmails: ["ok@example.com"],
        autoEmail: false,
        autoRss: false,
      }),
      "not_found",
    );
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe("setScheduleLastFiredAt", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-stamp";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("writes scheduleLastFiredAt ISO and bumps updatedAt", async () => {
    const iso = "2025-01-06T14:00:00.000Z";
    const before = Date.now();
    await setScheduleLastFiredAt(client, newsletterId, iso);
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(NEWSLETTERS_COLLECTION_ID);
    expect(call.documentId).toBe(newsletterId);
    expect(call.data.scheduleLastFiredAt).toBe(iso);
    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.updateDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(
      setScheduleLastFiredAt(client, newsletterId, "2025-01-06T14:00:00.000Z"),
      "not_found",
    );
    expect(err.message.length).toBeGreaterThan(0);
  });

  // C1: stamp-with-compare — only advance when null or older.
  it("compare: writes when current stamp is null", async () => {
    const iso = "2025-01-06T14:00:00.000Z";
    docs.seedDocument(
      mockNewsletterDocument({
        $id: newsletterId,
        scheduleLastFiredAt: null,
      }),
    );

    await setScheduleLastFiredAt(client, newsletterId, iso, { compare: true });

    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.scheduleLastFiredAt).toBe(iso);
  });

  it("compare: writes when current stamp is older than the new previous-fire ISO", async () => {
    const older = "2025-01-03T14:00:00.000Z";
    const newer = "2025-01-06T14:00:00.000Z";
    docs.seedDocument(
      mockNewsletterDocument({
        $id: newsletterId,
        scheduleLastFiredAt: older,
      }),
    );

    await setScheduleLastFiredAt(client, newsletterId, newer, { compare: true });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.scheduleLastFiredAt).toBe(newer);
  });

  it("compare: no-ops when current stamp is equal or newer (idempotent)", async () => {
    const iso = "2025-01-06T14:00:00.000Z";
    docs.seedDocument(
      mockNewsletterDocument({
        $id: newsletterId,
        scheduleLastFiredAt: iso,
      }),
    );

    await setScheduleLastFiredAt(client, newsletterId, iso, { compare: true });
    expect(docs.updateDocumentCalls).toHaveLength(0);

    docs.seedDocument(
      mockNewsletterDocument({
        $id: newsletterId,
        scheduleLastFiredAt: "2025-01-07T14:00:00.000Z",
      }),
    );
    await setScheduleLastFiredAt(client, newsletterId, iso, { compare: true });
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });
});

describe("deleteNewsletter", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-to-delete";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("lists junctions by newsletterId, deletes junction docs, then deletes the newsletter", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID) {
        return {
          total: 2,
          documents: [
            mockJunctionDocument({
              $id: "junction-1",
              newsletterId,
              feedId: "feed-1",
            }),
            mockJunctionDocument({
              $id: "junction-2",
              newsletterId,
              feedId: "feed-2",
            }),
          ],
        };
      }
      return { total: 0, documents: [] };
    };

    await deleteNewsletter(client, newsletterId);

    const junctionListCall = docs.listDocumentsCalls.find(
      (c) => c.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID,
    );
    expect(junctionListCall).toBeDefined();
    expect(junctionListCall!.queries).toContainEqual(Query.equal("newsletterId", newsletterId));
    expect(junctionListCall!.queries).toContainEqual(Query.limit(100));

    expect(docs.deleteDocumentCalls).toHaveLength(3);

    const junctionDeletes = docs.deleteDocumentCalls.filter(
      (c) => c.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID,
    );
    expect(junctionDeletes).toHaveLength(2);
    expect(junctionDeletes.map((c) => c.documentId)).toEqual(["junction-1", "junction-2"]);

    const newsletterDelete = docs.deleteDocumentCalls.find(
      (c) => c.collectionId === NEWSLETTERS_COLLECTION_ID,
    );
    expect(newsletterDelete?.documentId).toBe(newsletterId);
  });

  it("never deletes feed library documents", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID) {
        return {
          total: 1,
          documents: [
            mockJunctionDocument({
              $id: "junction-1",
              newsletterId,
              feedId: "feed-1",
            }),
          ],
        };
      }
      return { total: 0, documents: [] };
    };

    await deleteNewsletter(client, newsletterId);

    const feedDelete = docs.deleteDocumentCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(feedDelete).toBeUndefined();
  });

  it("deletes the newsletter when there are no junction rows", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });

    await deleteNewsletter(client, newsletterId);

    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTERS_COLLECTION_ID,
      documentId: newsletterId,
    });
  });

  it("throws not_found when the newsletter is missing (and no spurious feed deletes)", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    docs.deleteDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(deleteNewsletter(client, "missing-id"), "not_found");
    expect(err.message.length).toBeGreaterThan(0);

    const feedDelete = docs.deleteDocumentCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(feedDelete).toBeUndefined();
  });
});

describe("Appwrite error wrapping", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("wraps listDocuments failures as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException(
      `Request failed with key ${SECRET_API_KEY}`,
      500,
      "general_unknown",
    );

    const err = await expectRepoError(listNewsletters(client), "appwrite");
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0]![0] as {
      phase: string;
      code: unknown;
      message: string;
    };
    expect(logged.phase).toBe("list-newsletters");
    expect(logged.code).toBe(500);
    expect(logged.message).not.toContain(SECRET_API_KEY);
    expect(logged.message).not.toContain("sk-");
    spy.mockRestore();
  });

  it("wraps createDocument failures as appwrite code with a safe message", async () => {
    docs.createDocumentError = appwriteException(
      `Unauthorized: ${SECRET_API_KEY}`,
      401,
      "user_unauthorized",
    );

    const err = await expectRepoError(createNewsletter(client, { name: "Newsletter" }), "appwrite");
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("wraps a non-404 delete failure as appwrite code with a safe message", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    docs.deleteDocumentError = appwriteException(
      `Server error: ${SECRET_API_KEY}`,
      500,
      "general_unknown",
    );

    const err = await expectRepoError(deleteNewsletter(client, "some-id"), "appwrite");
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// listAllNewslettersForDueCheck — C2 full-collection walk for schedule ticks
// ---------------------------------------------------------------------------

describe("listAllNewslettersForDueCheck", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("concatenates two pages of fixtures into the full array", async () => {
    const page1 = Array.from({ length: NEWSLETTER_LIST_LIMIT }, (_, i) =>
      mockNewsletterDocument({ $id: `nl-p1-${i}` }),
    );
    const page2 = Array.from({ length: 50 }, (_, i) =>
      mockNewsletterDocument({ $id: `nl-p2-${i}` }),
    );
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      if (callCount === 1) return { total: 150, documents: page1 };
      return { total: 150, documents: page2 };
    };

    const newsletters = await listAllNewslettersForDueCheck(client);

    expect(newsletters).toHaveLength(150);
    expect(docs.listDocumentsCalls).toHaveLength(2);
  });

  it("returns a single page when total <= pageSize", async () => {
    const fixtures = Array.from({ length: 3 }, (_, i) =>
      mockNewsletterDocument({ $id: `nl-${i}` }),
    );
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      return { total: 3, documents: fixtures };
    };

    const newsletters = await listAllNewslettersForDueCheck(client);

    expect(newsletters).toHaveLength(3);
    expect(callCount).toBe(1);
  });

  it("returns [] when the collection is empty", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });

    const newsletters = await listAllNewslettersForDueCheck(client);

    expect(newsletters).toEqual([]);
    expect(docs.listDocumentsCalls).toHaveLength(1);
  });

  it("uses NEWSLETTER_LIST_LIMIT as default pageSize on the first call", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listAllNewslettersForDueCheck(client);

    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContainEqual(Query.limit(NEWSLETTER_LIST_LIMIT));
    expect(queries.every((q) => !String(q).startsWith("cursorAfter"))).toBe(true);
  });

  it("respects a custom pageSize", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listAllNewslettersForDueCheck(client, { pageSize: 25 });

    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContainEqual(Query.limit(25));
    expect(queries).not.toContainEqual(Query.limit(NEWSLETTER_LIST_LIMIT));
  });

  it("uses cursorAfter on the second page", async () => {
    const page1 = Array.from({ length: NEWSLETTER_LIST_LIMIT }, (_, i) =>
      mockNewsletterDocument({ $id: `nl-p1-${i}` }),
    );
    const lastId = page1[page1.length - 1]!.$id;
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      if (callCount === 1) return { total: NEWSLETTER_LIST_LIMIT, documents: page1 };
      return { total: NEWSLETTER_LIST_LIMIT, documents: [] };
    };

    await listAllNewslettersForDueCheck(client);

    expect(docs.listDocumentsCalls).toHaveLength(2);
    const secondQueries = docs.listDocumentsCalls[1]!.queries!;
    expect(secondQueries).toContainEqual(Query.cursorAfter(lastId));
  });

  // C2: a newsletter only on page 2 must be returned (single-page listNewsletters would miss it).
  it("includes a later-page newsletter that listNewsletters would miss (C2)", async () => {
    const page1 = Array.from({ length: NEWSLETTER_LIST_LIMIT }, (_, i) =>
      mockNewsletterDocument({
        $id: `nl-fill-${i}`,
        scheduleEnabled: false,
      }),
    );
    const page2Due = mockNewsletterDocument({
      $id: "nl-due-page-2",
      scheduleEnabled: true,
      scheduleCron: "0 9 * * 1-5",
      scheduleTimezone: "America/New_York",
      scheduleLastFiredAt: null,
    });
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      if (callCount === 1) {
        return { total: NEWSLETTER_LIST_LIMIT + 1, documents: page1 };
      }
      return { total: NEWSLETTER_LIST_LIMIT + 1, documents: [page2Due] };
    };

    const all = await listAllNewslettersForDueCheck(client);
    expect(all).toHaveLength(NEWSLETTER_LIST_LIMIT + 1);
    expect(all.some((n) => n.$id === "nl-due-page-2")).toBe(true);

    // Contrast: GUI listNewsletters stays single-page and would starve schedules.
    docs.listDocumentsCalls.length = 0;
    docs.listDocumentsImpl = () => ({
      total: NEWSLETTER_LIST_LIMIT + 1,
      documents: page1,
    });
    const firstPageOnly = await listNewsletters(client);
    expect(firstPageOnly).toHaveLength(NEWSLETTER_LIST_LIMIT);
    expect(firstPageOnly.some((n) => n.$id === "nl-due-page-2")).toBe(false);
  });

  it("wraps Appwrite errors as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException("db down", 500);
    const err = await expectRepoError(listAllNewslettersForDueCheck(client), "appwrite");
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message).not.toContain("db down");
    spy.mockRestore();
  });
});
