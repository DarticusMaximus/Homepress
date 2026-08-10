import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import { Query } from "node-appwrite";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
  uniqueId: "attach-doc-unique-id",
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
  FEEDS_COLLECTION_ID,
  NEWSLETTER_FEEDS_COLLECTION_ID,
  type FeedStatus,
} from "../../schema/declarations";
import {
  attachFeed,
  detachFeed,
  listAttachmentsForNewsletter,
  type AttachmentRecord,
} from "../attachments";
import type { Feed } from "../../feeds";
import { NewsletterRepositoryError } from "../types";
import {
  MockNewslettersDatabases,
  appwriteException,
  fakeClient,
  mockFeedDocument,
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

function seedFeed(
  docs: MockNewslettersDatabases,
  overrides: {
    $id: string;
    status?: FeedStatus;
    name?: string;
    url?: string;
  },
): void {
  docs.seedDocument(
    mockFeedDocument({
      $id: overrides.$id,
      status: overrides.status ?? "ok",
      name: overrides.name ?? `Feed ${overrides.$id}`,
      url: overrides.url ?? `https://example.com/${overrides.$id}`,
    }),
  );
}

function feedFixture($id: string, status: FeedStatus): Feed {
  return {
    $id,
    name: `Feed ${$id}`,
    url: `https://example.com/${$id}`,
    notes: "",
    status,
    lastTestedAt: null,
    lastTestError: null,
    operationalHealth: "healthy",
    consecutiveFetchFailures: 0,
    lastFetchError: "",
    lastFetchAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("attachFeed", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-1";
  const feedId = "feed-1";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    docs.useSeedStore = true;
    mockHolder.databases = docs;
    mockHolder.uniqueId = "attach-doc-unique-id";
    client = fakeClient();
  });

  it("creates a junction row for an ok feed with newsletterId, feedId, createdAt", async () => {
    docs.seedDocument(mockNewsletterDocument({ $id: newsletterId }));
    seedFeed(docs, { $id: feedId, status: "ok" });

    const before = Date.now();
    const record: AttachmentRecord = await attachFeed(client, newsletterId, feedId);
    const after = Date.now();

    expect(docs.createDocumentCalls).toHaveLength(1);
    const call = docs.createDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(NEWSLETTER_FEEDS_COLLECTION_ID);
    expect(call.data.newsletterId).toBe(newsletterId);
    expect(call.data.feedId).toBe(feedId);

    const createdAt = new Date(String(call.data.createdAt)).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);

    expect(record.$id).toBe("attach-doc-unique-id");
    expect(record.newsletterId).toBe(newsletterId);
    expect(record.feedId).toBe(feedId);
    expect(new Date(record.createdAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("rejects an untested feed with not_ok and writes nothing", async () => {
    docs.seedDocument(mockNewsletterDocument({ $id: newsletterId }));
    seedFeed(docs, { $id: feedId, status: "untested" });

    await expectRepoError(attachFeed(client, newsletterId, feedId), "not_ok");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("rejects a failed feed with not_ok and writes nothing", async () => {
    docs.seedDocument(mockNewsletterDocument({ $id: newsletterId }));
    seedFeed(docs, { $id: feedId, status: "failed" });

    await expectRepoError(attachFeed(client, newsletterId, feedId), "not_ok");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("throws not_found when the newsletter does not exist", async () => {
    seedFeed(docs, { $id: feedId, status: "ok" });

    const err = await expectRepoError(
      attachFeed(client, "missing-newsletter", feedId),
      "not_found",
    );
    expect(err.message).toBe("Newsletter not found");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("throws not_found when the feed does not exist", async () => {
    docs.seedDocument(mockNewsletterDocument({ $id: newsletterId }));

    const err = await expectRepoError(
      attachFeed(client, newsletterId, "missing-feed"),
      "not_found",
    );
    expect(err.message).toBe("Feed not found");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("rejects a duplicate (newsletterId, feedId) pair with duplicate_attachment", async () => {
    docs.seedDocument(mockNewsletterDocument({ $id: newsletterId }));
    seedFeed(docs, { $id: feedId, status: "ok" });
    docs.seedDocument(mockJunctionDocument({ $id: "existing-junction", newsletterId, feedId }));

    await expectRepoError(attachFeed(client, newsletterId, feedId), "duplicate_attachment");
    expect(docs.createDocumentCalls).toHaveLength(0);

    const dupListCall = docs.listDocumentsCalls.find(
      (c) => c.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID,
    );
    expect(dupListCall).toBeDefined();
    expect(dupListCall!.queries).toContainEqual(Query.equal("newsletterId", newsletterId));
    expect(dupListCall!.queries).toContainEqual(Query.equal("feedId", feedId));
    expect(dupListCall!.queries).toContainEqual(Query.limit(1));
  });

  it("allows the same ok feed to attach to two different newsletters", async () => {
    docs.seedDocument(mockNewsletterDocument({ $id: "nl-a" }));
    docs.seedDocument(mockNewsletterDocument({ $id: "nl-b" }));
    seedFeed(docs, { $id: feedId, status: "ok" });

    await attachFeed(client, "nl-a", feedId);
    mockHolder.uniqueId = "second-junction";
    await attachFeed(client, "nl-b", feedId);

    expect(docs.createDocumentCalls).toHaveLength(2);
    expect(docs.createDocumentCalls.map((c) => c.data.newsletterId)).toEqual(["nl-a", "nl-b"]);
    expect(docs.createDocumentCalls.every((c) => c.data.feedId === feedId)).toBe(true);
  });
});

describe("detachFeed", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-1";
  const feedId = "feed-1";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    docs.useSeedStore = true;
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("deletes the junction row only and never touches the feed document", async () => {
    docs.seedDocument(mockJunctionDocument({ $id: "junction-1", newsletterId, feedId }));

    await detachFeed(client, newsletterId, feedId);

    const findCall = docs.listDocumentsCalls.find(
      (c) => c.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID,
    );
    expect(findCall).toBeDefined();
    expect(findCall!.queries).toContainEqual(Query.equal("newsletterId", newsletterId));
    expect(findCall!.queries).toContainEqual(Query.equal("feedId", feedId));
    expect(findCall!.queries).toContainEqual(Query.limit(1));

    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
      documentId: "junction-1",
    });

    const feedDelete = docs.deleteDocumentCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(feedDelete).toBeUndefined();
  });

  it("throws not_found when no junction exists for the pair", async () => {
    const err = await expectRepoError(detachFeed(client, newsletterId, feedId), "not_found");
    expect(err.message).toBe("Attachment not found");
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });
});

describe("listAttachmentsForNewsletter", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-1";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    docs.useSeedStore = true;
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("lists attached feeds with name/status sorted by createdAt asc, including failed", async () => {
    docs.seedDocument(
      mockJunctionDocument({
        $id: "j2",
        newsletterId,
        feedId: "f2",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    docs.seedDocument(
      mockJunctionDocument({
        $id: "j1",
        newsletterId,
        feedId: "f1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    seedFeed(docs, {
      $id: "f1",
      status: "ok",
      name: "Feed One",
      url: "https://example.com/f1",
    });
    seedFeed(docs, {
      $id: "f2",
      status: "failed",
      name: "Feed Two",
      url: "https://example.com/f2",
    });

    const records = await listAttachmentsForNewsletter(client, newsletterId);

    const listCall = docs.listDocumentsCalls.find(
      (c) => c.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID,
    );
    expect(listCall).toBeDefined();
    expect(listCall!.queries).toContainEqual(Query.equal("newsletterId", newsletterId));
    expect(listCall!.queries).toContainEqual(Query.limit(100));

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      attachmentId: "j1",
      feedId: "f1",
      feedName: "Feed One",
      feedUrl: "https://example.com/f1",
      feedStatus: "ok",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(records[1]).toMatchObject({
      attachmentId: "j2",
      feedId: "f2",
      feedName: "Feed Two",
      feedUrl: "https://example.com/f2",
      feedStatus: "failed",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("omits an orphan junction whose feed is missing and logs it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });

    docs.seedDocument(
      mockJunctionDocument({
        $id: "j1",
        newsletterId,
        feedId: "f1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    docs.seedDocument(
      mockJunctionDocument({
        $id: "j-orphan",
        newsletterId,
        feedId: "missing-feed",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
    );
    seedFeed(docs, {
      $id: "f1",
      status: "ok",
      name: "Feed One",
      url: "https://example.com/f1",
    });

    const records = await listAttachmentsForNewsletter(client, newsletterId);

    expect(records).toHaveLength(1);
    expect(records[0].feedId).toBe("f1");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("uses the passed feedsById map and issues no feeds-collection read", async () => {
    docs.seedDocument(mockJunctionDocument({ $id: "j1", newsletterId, feedId: "f1" }));
    const feedsById = new Map<string, Feed>([["f1", feedFixture("f1", "ok")]]);

    const records = await listAttachmentsForNewsletter(client, newsletterId, {
      feedsById,
    });

    const feedsReads = docs.listDocumentsCalls.filter(
      (c) => c.collectionId === FEEDS_COLLECTION_ID,
    );
    expect(feedsReads).toHaveLength(0);

    const junctionReads = docs.listDocumentsCalls.filter(
      (c) => c.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID,
    );
    expect(junctionReads).toHaveLength(1);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      feedId: "f1",
      feedName: "Feed f1",
      feedUrl: "https://example.com/f1",
      feedStatus: "ok",
    });
  });

  it("falls back to listFeeds (reads the feeds collection) when no feedsById is passed", async () => {
    docs.seedDocument(mockJunctionDocument({ $id: "j1", newsletterId, feedId: "f1" }));
    seedFeed(docs, { $id: "f1", status: "ok" });

    await listAttachmentsForNewsletter(client, newsletterId);

    const feedsReads = docs.listDocumentsCalls.filter(
      (c) => c.collectionId === FEEDS_COLLECTION_ID,
    );
    expect(feedsReads).toHaveLength(1);
  });

  it("resolves identical records from feedsById or listFeeds, keeping a demoted failed attachment (orphan omitted)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow orphan log */
    });

    const f1 = feedFixture("f1", "ok");
    const f2 = feedFixture("f2", "failed");
    docs.seedDocument(
      mockJunctionDocument({
        $id: "j2",
        newsletterId,
        feedId: "f2",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    docs.seedDocument(
      mockJunctionDocument({
        $id: "j1",
        newsletterId,
        feedId: "f1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    docs.seedDocument(
      mockJunctionDocument({
        $id: "j-orphan",
        newsletterId,
        feedId: "missing-feed",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
    );
    seedFeed(docs, { $id: "f1", status: "ok", name: f1.name, url: f1.url });
    seedFeed(docs, {
      $id: "f2",
      status: "failed",
      name: f2.name,
      url: f2.url,
    });

    const fromMap = await listAttachmentsForNewsletter(client, newsletterId, {
      feedsById: new Map<string, Feed>([
        ["f1", f1],
        ["f2", f2],
      ]),
    });
    const fromList = await listAttachmentsForNewsletter(client, newsletterId);

    expect(fromMap).toEqual(fromList);
    expect(fromMap).toHaveLength(2);
    expect(fromMap.map((r) => r.feedStatus)).toContain("failed");
    expect(fromMap[0]).toMatchObject({ feedId: "f1", feedStatus: "ok" });
    expect(fromMap[1]).toMatchObject({ feedId: "f2", feedStatus: "failed" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Appwrite error wrapping", () => {
  let docs: MockNewslettersDatabases;
  let client: Client;
  const newsletterId = "newsletter-1";
  const feedId = "feed-1";

  beforeEach(() => {
    docs = new MockNewslettersDatabases();
    docs.useSeedStore = true;
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("wraps listDocuments failures as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.seedDocument(mockJunctionDocument({ $id: "j1", newsletterId, feedId }));
    docs.listDocumentsError = appwriteException(
      `Request failed with key ${SECRET_API_KEY}`,
      500,
      "general_unknown",
    );

    const err = await expectRepoError(
      listAttachmentsForNewsletter(client, newsletterId),
      "appwrite",
    );
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0]![0] as {
      phase: string;
      code: unknown;
      message: string;
    };
    expect(logged.phase).toBe("list-attachments");
    expect(logged.code).toBe(500);
    expect(logged.message).not.toContain(SECRET_API_KEY);
    expect(logged.message).not.toContain("sk-");
    spy.mockRestore();
  });
});
