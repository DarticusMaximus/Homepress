import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";
import { Query } from "node-appwrite";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
  uniqueId: "feed-doc-unique-id",
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

vi.mock("node:dns/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
  };
});

import {
  DATABASE_ID,
  FEEDS_COLLECTION_ID,
  FEED_UNHEALTHY_THRESHOLD,
  NEWSLETTER_FEEDS_COLLECTION_ID,
} from "../../schema/declarations";
import {
  createFeed,
  deleteFeed,
  getFeed,
  listFeeds,
  recordFeedTestResult,
  updateFeed,
} from "../repository";
import { FeedRepositoryError, isFeedUnhealthy } from "../types";
import {
  type MockDocument,
  MockFeedsDatabases,
  appwriteException,
  fakeClient,
  mockFeedDocument,
} from "./mock-client";

const SECRET_API_KEY = "sk-secret-do-not-leak-1234567890";

function expectRepoError(
  promise: Promise<unknown>,
  code: FeedRepositoryError["code"],
): Promise<FeedRepositoryError> {
  return promise.then(
    () => {
      throw new Error(`Expected FeedRepositoryError with code ${code}`);
    },
    (err) => {
      expect(err).toBeInstanceOf(FeedRepositoryError);
      const repoErr = err as FeedRepositoryError;
      expect(repoErr.code).toBe(code);
      return repoErr;
    },
  );
}

function seedFeeds(count: number, dupIndex: number, dupUrl: string): MockDocument[] {
  const docs: MockDocument[] = [];
  for (let i = 0; i < count; i++) {
    const isDup = i === dupIndex;
    docs.push(
      mockFeedDocument({
        $id: isDup ? "dup-feed" : `feed-${i}`,
        url: isDup ? dupUrl : `https://example.com/feed-${i}`,
      }),
    );
  }
  return docs;
}

function applyListQueries(all: MockDocument[], queries: string[] | undefined): MockDocument[] {
  let docs = all;
  const equalEntry = all
    .map((d) => ({ url: String(d.url), q: Query.equal("url", String(d.url)) }))
    .find((entry) => queries?.includes(entry.q));
  if (equalEntry) {
    docs = all.filter((d) => String(d.url) === equalEntry.url);
  }
  const limitQuery = queries?.find((q) => q.startsWith("limit("));
  if (limitQuery) {
    const n = Number(limitQuery.slice("limit(".length, -1));
    if (Number.isFinite(n)) docs = docs.slice(0, n);
  }
  return docs;
}

describe("createFeed", () => {
  let docs: MockFeedsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    mockHolder.uniqueId = "feed-doc-unique-id";
    client = fakeClient();
  });

  it("writes required fields with notes empty string, status untested, and timestamps", async () => {
    const before = Date.now();
    const feed = await createFeed(client, {
      name: "  Tech News  ",
      url: "  https://example.com/rss  ",
      notes: "  ",
    });
    const after = Date.now();

    expect(docs.createDocumentCalls).toHaveLength(1);
    const call = docs.createDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(FEEDS_COLLECTION_ID);
    expect(call.documentId).toBe("feed-doc-unique-id");
    expect(call.data).toMatchObject({
      name: "Tech News",
      url: "https://example.com/rss",
      notes: "",
      status: "untested",
      operationalHealth: "healthy",
      consecutiveFetchFailures: 0,
      lastFetchError: "",
    });
    expect(call.data.lastTestedAt).toBeUndefined();
    expect(call.data.lastTestError).toBeUndefined();
    expect(call.data.lastFetchAt).toBeUndefined();

    const createdAt = new Date(String(call.data.createdAt)).getTime();
    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);

    expect(feed.$id).toBe("feed-doc-unique-id");
    expect(feed.name).toBe("Tech News");
    expect(feed.url).toBe("https://example.com/rss");
    expect(feed.notes).toBe("");
    expect(feed.status).toBe("untested");
  });

  it("throws duplicate_url and skips create when another feed owns the trimmed URL", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === FEEDS_COLLECTION_ID) {
        return {
          total: 1,
          documents: [
            mockFeedDocument({
              $id: "existing-feed",
              url: "https://example.com/rss",
            }),
          ],
        };
      }
      return { total: 0, documents: [] };
    };

    const err = await expectRepoError(
      createFeed(client, {
        name: "Duplicate",
        url: "  https://example.com/rss  ",
      }),
      "duplicate_url",
    );
    expect(err.message).toBe("A feed with this URL already exists");
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("rejects a duplicate URL even when it sits beyond the V1 fetch cap (>100 documents)", async () => {
    const dupUrl = "https://example.com/dup";
    const seeded = seedFeeds(101, 100, dupUrl);
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== FEEDS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      const matched = applyListQueries(seeded, params.queries);
      return { total: matched.length, documents: matched };
    };

    const err = await expectRepoError(
      createFeed(client, { name: "Dup", url: `  ${dupUrl}  ` }),
      "duplicate_url",
    );
    expect(err.message).toBe("A feed with this URL already exists");
    expect(docs.createDocumentCalls).toHaveLength(0);

    const listCall = docs.listDocumentsCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(listCall).toBeDefined();
    expect(listCall!.queries).toContainEqual(Query.equal("url", dupUrl));
    expect(listCall!.queries).toContainEqual(Query.limit(1));
  });
});

describe("listFeeds", () => {
  let docs: MockFeedsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("fetches with Query.limit(100) and sorts by updatedAt desc in memory", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId !== FEEDS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return {
        total: 3,
        documents: [
          mockFeedDocument({
            $id: "feed-a",
            name: "A",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
          mockFeedDocument({
            $id: "feed-c",
            name: "C",
            updatedAt: "2026-03-01T00:00:00.000Z",
          }),
          mockFeedDocument({
            $id: "feed-b",
            name: "B",
            updatedAt: "2026-02-01T00:00:00.000Z",
          }),
        ],
      };
    };

    const feeds = await listFeeds(client);

    const listCall = docs.listDocumentsCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(listCall).toBeDefined();
    expect(listCall!.queries).toContainEqual(Query.limit(100));

    expect(feeds.map((f) => f.$id)).toEqual(["feed-c", "feed-b", "feed-a"]);
    expect(feeds[0]).toMatchObject({
      $id: "feed-c",
      name: "C",
      url: "https://example.com/feed",
      status: "untested",
      operationalHealth: "healthy",
      consecutiveFetchFailures: 0,
      lastFetchError: "",
    });
    expect(feeds[0].lastFetchAt).toBeNull();
  });
});

describe("updateFeed", () => {
  let docs: MockFeedsDatabases;
  let client: Client;
  const feedId = "feed-to-update";

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();

    docs.getDocumentCalls.length = 0;
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
  });

  it("updates name only without resetting status and bumps updatedAt", async () => {
    const previousUpdatedAt = "2026-01-01T00:00:00.000Z";
    docs.getDocumentError = null;
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });

    // getDocument returns existing feed with ok status
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: feedId,
        name: "Old Name",
        url: "https://example.com/feed",
        notes: "keep",
        status: "ok",
        lastTestedAt: "2026-01-02T00:00:00.000Z",
        lastTestError: "previous error",
        updatedAt: previousUpdatedAt,
      };
    };

    const before = Date.now();
    const feed = await updateFeed(client, feedId, { name: "  New Name  " });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.documentId).toBe(feedId);
    expect(call.data.name).toBe("New Name");
    expect(call.data.url).toBe("https://example.com/feed");
    expect(call.data.status).toBe("ok");
    expect(call.data.lastTestedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(call.data.lastTestError).toBe("previous error");

    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);
    expect(new Date(feed.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("resets status to untested and clears test fields when URL changes (trim-only compare)", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: feedId,
        name: "Feed",
        url: "https://example.com/feed",
        notes: "",
        status: "ok",
        lastTestedAt: "2026-01-02T00:00:00.000Z",
        lastTestError: "old failure",
        operationalHealth: "unhealthy",
        consecutiveFetchFailures: 5,
        lastFetchError: "chronic failure",
        lastFetchAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
    };

    await updateFeed(client, feedId, { url: "https://example.com/feed/" });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.url).toBe("https://example.com/feed/");
    expect(call.data.status).toBe("untested");
    expect(call.data.lastTestedAt).toBeNull();
    expect(call.data.lastTestError).toBeNull();
    expect(call.data.operationalHealth).toBe("healthy");
    expect(call.data.consecutiveFetchFailures).toBe(0);
    expect(call.data.lastFetchError).toBe("");
    expect(call.data.lastFetchAt).toBeNull();
  });

  it("does not reset status when URL is unchanged after trim", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: feedId,
        name: "Feed",
        url: "https://example.com/feed",
        status: "failed",
        lastTestedAt: "2026-01-02T00:00:00.000Z",
        lastTestError: "fetch failed",
        operationalHealth: "unhealthy",
        consecutiveFetchFailures: 3,
        lastFetchError: "run failure",
        lastFetchAt: "2026-01-04T00:00:00.000Z",
      };
    };

    await updateFeed(client, feedId, { url: "  https://example.com/feed  " });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.url).toBe("https://example.com/feed");
    expect(call.data.status).toBe("failed");
    expect(call.data.lastTestedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(call.data.lastTestError).toBe("fetch failed");
    expect(call.data.operationalHealth).toBe("unhealthy");
    expect(call.data.consecutiveFetchFailures).toBe(3);
    expect(call.data.lastFetchError).toBe("run failure");
    expect(call.data.lastFetchAt).toBe("2026-01-04T00:00:00.000Z");
  });

  it("blocks update when another document owns the trimmed URL", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: feedId,
        url: "https://example.com/original",
      };
    };

    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === FEEDS_COLLECTION_ID) {
        return {
          total: 1,
          documents: [
            mockFeedDocument({
              $id: "other-feed",
              url: "https://example.com/taken",
            }),
          ],
        };
      }
      return { total: 0, documents: [] };
    };

    const err = await expectRepoError(
      updateFeed(client, feedId, { url: "  https://example.com/taken  " }),
      "duplicate_url",
    );
    expect(err.message).toBe("A feed with this URL already exists");
    expect(docs.updateDocumentCalls).toHaveLength(0);

    const listCall = docs.listDocumentsCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(listCall).toBeDefined();
    expect(listCall!.queries).toContainEqual(Query.equal("url", "https://example.com/taken"));
    expect(listCall!.queries).toContainEqual(Query.limit(1));
  });

  it("allows an update when the only owner of the URL is the feed being updated (excludeId post-check)", async () => {
    const newUrl = "https://example.com/taken";
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: feedId,
        url: "https://example.com/original",
      };
    };

    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === FEEDS_COLLECTION_ID) {
        return {
          total: 1,
          documents: [mockFeedDocument({ $id: feedId, url: newUrl })],
        };
      }
      return { total: 0, documents: [] };
    };

    await updateFeed(client, feedId, { url: `  ${newUrl}  ` });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.url).toBe(newUrl);

    const listCall = docs.listDocumentsCalls.find((c) => c.collectionId === FEEDS_COLLECTION_ID);
    expect(listCall).toBeDefined();
    expect(listCall!.queries).toContainEqual(Query.equal("url", newUrl));
    expect(listCall!.queries).toContainEqual(Query.limit(1));
  });
});

describe("deleteFeed", () => {
  let docs: MockFeedsDatabases;
  let client: Client;
  const feedId = "feed-to-delete";

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("calls deleteDocument when no newsletter_feeds attachment exists", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID) {
        return { total: 0, documents: [] };
      }
      return { total: 0, documents: [] };
    };

    await deleteFeed(client, feedId);

    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
    });
  });

  it("throws attached and skips deleteDocument when junction rows exist", async () => {
    docs.listDocumentsImpl = (params) => {
      if (params.collectionId === NEWSLETTER_FEEDS_COLLECTION_ID) {
        return {
          total: 1,
          documents: [
            {
              $id: "junction-1",
              $collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
              $databaseId: DATABASE_ID,
              $createdAt: new Date().toISOString(),
              $updatedAt: new Date().toISOString(),
              $permissions: [],
              newsletterId: "newsletter-1",
              feedId,
            },
          ],
        };
      }
      return { total: 0, documents: [] };
    };

    const err = await expectRepoError(deleteFeed(client, feedId), "attached");
    expect(err.message).toBe("Detach this feed from all newsletters before deleting");
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });
});

describe("Appwrite error wrapping", () => {
  let docs: MockFeedsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockFeedsDatabases();
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

    const err = await expectRepoError(listFeeds(client), "appwrite");
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0]![0] as {
      phase: string;
      code: unknown;
      message: string;
    };
    expect(logged.phase).toBe("list-feeds");
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

    const err = await expectRepoError(
      createFeed(client, { name: "Feed", url: "https://example.com/rss" }),
      "appwrite",
    );
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe("getFeed", () => {
  let docs: MockFeedsDatabases;
  let client: Client;
  const feedId = "feed-to-get";

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns a mapped feed when the document exists", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return {
        ...doc,
        $id: feedId,
        name: "My Feed",
        url: "https://example.com/rss",
        notes: "some notes",
        status: "ok",
        lastTestedAt: "2026-01-02T00:00:00.000Z",
        lastTestError: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      };
    };

    const feed = await getFeed(client, feedId);

    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: FEEDS_COLLECTION_ID,
      documentId: feedId,
    });
    expect(feed).toMatchObject({
      $id: feedId,
      name: "My Feed",
      url: "https://example.com/rss",
      notes: "some notes",
      status: "ok",
      lastTestedAt: "2026-01-02T00:00:00.000Z",
      lastTestError: "",
    });
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(getFeed(client, feedId), "not_found");
    expect(err.message).toBe("Feed not found");
  });
});

describe("documentToFeed operational-health defaults (legacy documents)", () => {
  let docs: MockFeedsDatabases;
  let client: Client;
  const feedId = "legacy-feed";

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("applies safe defaults when operational-health fields are missing entirely", async () => {
    const now = new Date().toISOString();
    docs.getDocument = async () => ({
      $id: feedId,
      $collectionId: FEEDS_COLLECTION_ID,
      $databaseId: DATABASE_ID,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      name: "Legacy",
      url: "https://example.com/legacy",
      notes: "",
      status: "ok",
      lastTestedAt: null,
      lastTestError: null,
      createdAt: now,
      updatedAt: now,
      // operationalHealth, consecutiveFetchFailures, lastFetchError, lastFetchAt intentionally absent
    });

    const feed = await getFeed(client, feedId);

    expect(feed.operationalHealth).toBe("healthy");
    expect(feed.consecutiveFetchFailures).toBe(0);
    expect(feed.lastFetchError).toBe("");
    expect(feed.lastFetchAt).toBeNull();
  });

  it("applies safe defaults when operational-health fields are null", async () => {
    const now = new Date().toISOString();
    docs.getDocument = async () => ({
      $id: feedId,
      $collectionId: FEEDS_COLLECTION_ID,
      $databaseId: DATABASE_ID,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      name: "Legacy",
      url: "https://example.com/legacy",
      notes: "",
      status: "ok",
      lastTestedAt: null,
      lastTestError: null,
      operationalHealth: null,
      consecutiveFetchFailures: null,
      lastFetchError: null,
      lastFetchAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const feed = await getFeed(client, feedId);

    expect(feed.operationalHealth).toBe("healthy");
    expect(feed.consecutiveFetchFailures).toBe(0);
    expect(feed.lastFetchError).toBe("");
    expect(feed.lastFetchAt).toBeNull();
  });

  it("preserves populated operational-health fields from the document", async () => {
    const now = new Date().toISOString();
    docs.getDocument = async () => ({
      $id: feedId,
      $collectionId: FEEDS_COLLECTION_ID,
      $databaseId: DATABASE_ID,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      name: "Flaky",
      url: "https://example.com/flaky",
      notes: "",
      status: "ok",
      lastTestedAt: null,
      lastTestError: null,
      operationalHealth: "unhealthy",
      consecutiveFetchFailures: 7,
      lastFetchError: "timeout",
      lastFetchAt: "2026-01-05T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    });

    const feed = await getFeed(client, feedId);

    expect(feed.operationalHealth).toBe("unhealthy");
    expect(feed.consecutiveFetchFailures).toBe(7);
    expect(feed.lastFetchError).toBe("timeout");
    expect(feed.lastFetchAt).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("isFeedUnhealthy", () => {
  it("returns true when operationalHealth is unhealthy", () => {
    expect(isFeedUnhealthy({ operationalHealth: "unhealthy", consecutiveFetchFailures: 0 })).toBe(
      true,
    );
  });

  it("returns true when consecutiveFetchFailures reaches the threshold", () => {
    expect(
      isFeedUnhealthy({
        operationalHealth: "healthy",
        consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD,
      }),
    ).toBe(true);
  });

  it("returns true when consecutiveFetchFailures exceeds the threshold", () => {
    expect(
      isFeedUnhealthy({
        operationalHealth: "healthy",
        consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD + 2,
      }),
    ).toBe(true);
  });

  it("returns false when healthy with failures below threshold", () => {
    expect(
      isFeedUnhealthy({
        operationalHealth: "healthy",
        consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD - 1,
      }),
    ).toBe(false);
  });

  it("returns false when healthy with zero failures", () => {
    expect(isFeedUnhealthy({ operationalHealth: "healthy", consecutiveFetchFailures: 0 })).toBe(
      false,
    );
  });
});

describe("recordFeedTestResult", () => {
  let docs: MockFeedsDatabases;
  let client: Client;
  const feedId = "feed-to-test";

  beforeEach(() => {
    docs = new MockFeedsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("ok: writes status ok, bumps timestamps, and writes lastTestError as empty string (not omitted)", async () => {
    const before = Date.now();
    await recordFeedTestResult(client, feedId, { status: "ok" });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.documentId).toBe(feedId);
    expect(call.collectionId).toBe(FEEDS_COLLECTION_ID);
    expect(call.data.status).toBe("ok");
    expect(call.data.lastTestError).toBe("");
    expect(Object.keys(call.data)).toContain("lastTestError");

    const lastTestedAt = new Date(String(call.data.lastTestedAt)).getTime();
    const updatedAt = new Date(String(call.data.updatedAt)).getTime();
    expect(lastTestedAt).toBeGreaterThanOrEqual(before);
    expect(lastTestedAt).toBeLessThanOrEqual(after);
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAt).toBeLessThanOrEqual(after);

    expect(docs.listDocumentsCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });

  it("failed: writes status failed and stores the reason trimmed and truncated to <=1000 chars", async () => {
    const longError = "x".repeat(1500);
    await recordFeedTestResult(client, feedId, {
      status: "failed",
      error: `  ${longError}  `,
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.status).toBe("failed");
    expect(typeof call.data.lastTestError).toBe("string");
    expect(String(call.data.lastTestError).length).toBeLessThanOrEqual(1000);

    expect(docs.listDocumentsCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });

  it("failed: stores a short reason verbatim after trimming", async () => {
    await recordFeedTestResult(client, feedId, {
      status: "failed",
      error: "  Could not fetch the RSS feed (timed out)  ",
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.lastTestError).toBe("Could not fetch the RSS feed (timed out)");
  });

  it("demotion: updates an ok document to failed without listing/creating/deleting newsletter_feeds", async () => {
    const originalGet = docs.getDocument.bind(docs);
    docs.getDocument = async (params) => {
      const doc = await originalGet(params);
      return { ...doc, $id: feedId, status: "ok", lastTestError: "" };
    };

    await recordFeedTestResult(client, feedId, {
      status: "failed",
      error: "fetch failed",
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.status).toBe("failed");
    expect(call.data.lastTestError).toBe("fetch failed");
    expect(docs.listDocumentsCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });

  it("throws not_found when the feed does not exist (404) and skips the update", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(
      recordFeedTestResult(client, feedId, { status: "ok" }),
      "not_found",
    );
    expect(err.message).toBe("Feed not found");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });
});
