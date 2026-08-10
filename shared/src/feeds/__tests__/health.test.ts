import { vi, describe, it, expect, beforeEach } from "vitest";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
}));

vi.mock("node-appwrite", async (importActual) => {
  const actual = await importActual<typeof import("node-appwrite")>();
  return {
    ...actual,
    Databases: class MockDatabasesConstructor {
      constructor() {
        return mockHolder.databases as unknown as MockDatabasesConstructor;
      }
    },
  };
});

import { applyFeedFetchOutcomes, countUnhealthyFeeds } from "../health";
import { FEED_UNHEALTHY_THRESHOLD } from "../../schema/declarations";
import type { FeedFailure } from "../../pipeline/types";
import type { Feed } from "../types";
import {
  type MockDocument,
  MockFeedsDatabases,
  appwriteException,
  fakeClient,
  mockFeedDocument,
} from "./mock-client";

const URL_A = "https://a.example.com/feed";
const URL_B = "https://b.example.com/feed";

function makeFailure(overrides: Partial<FeedFailure> = {}): FeedFailure {
  return {
    feedUrl: URL_A,
    errorType: "NetworkError",
    errorMessage: "connection refused",
    ...overrides,
  };
}

function makeDoc(overrides: Partial<MockDocument> & Pick<MockDocument, "$id">): MockDocument {
  return mockFeedDocument({ url: URL_A, ...overrides });
}

describe("applyFeedFetchOutcomes", () => {
  let db: MockFeedsDatabases;

  beforeEach(() => {
    db = new MockFeedsDatabases();
    mockHolder.databases = db;
  });

  // -- Increment ----------------------------------------------------------

  it("increments consecutiveFetchFailures by 1 on a single failure and stays healthy", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [makeDoc({ $id: "feed-1", consecutiveFetchFailures: 0 })],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [makeFailure({ errorMessage: "connection refused" })],
    });

    expect(db.updateDocumentCalls).toHaveLength(1);
    expect(db.updateDocumentCalls[0].documentId).toBe("feed-1");
    expect(db.updateDocumentCalls[0].data).toEqual({
      consecutiveFetchFailures: 1,
      lastFetchError: "connection refused",
      operationalHealth: "healthy",
      lastFetchAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it("increments from an existing non-zero counter (1 → 2, still healthy)", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [makeDoc({ $id: "feed-1", consecutiveFetchFailures: 1 })],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [makeFailure()],
    });

    expect(db.updateDocumentCalls[0].data).toMatchObject({
      consecutiveFetchFailures: 2,
      operationalHealth: "healthy",
    });
  });

  // -- Threshold → unhealthy ----------------------------------------------

  it("marks feed unhealthy when consecutive failures reach the threshold", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [
        makeDoc({
          $id: "feed-1",
          consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD - 1,
        }),
      ],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [
        makeFailure({
          errorType: "HttpError",
          errorMessage: "HTTP 503",
          statusCode: 503,
        }),
      ],
    });

    expect(db.updateDocumentCalls[0].data).toMatchObject({
      consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD,
      operationalHealth: "unhealthy",
      lastFetchError: "HTTP 503",
    });
  });

  it("stays healthy just below the threshold (counter → threshold - 1)", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [
        makeDoc({
          $id: "feed-1",
          consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD - 2,
        }),
      ],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [makeFailure()],
    });

    expect(db.updateDocumentCalls[0].data).toMatchObject({
      consecutiveFetchFailures: FEED_UNHEALTHY_THRESHOLD - 1,
      operationalHealth: "healthy",
    });
  });

  // -- Success reset ------------------------------------------------------

  it("resets to healthy, counter 0, and empty lastFetchError on successful fetch", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [
        makeDoc({
          $id: "feed-1",
          operationalHealth: "unhealthy",
          consecutiveFetchFailures: 5,
          lastFetchError: "old stale error",
        }),
      ],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [],
    });

    expect(db.updateDocumentCalls).toHaveLength(1);
    expect(db.updateDocumentCalls[0].data).toEqual({
      consecutiveFetchFailures: 0,
      operationalHealth: "healthy",
      lastFetchError: "",
      lastFetchAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  // -- Qualification field isolation --------------------------------------

  it("does NOT write status, lastTestedAt, or lastTestError on failure", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [
        makeDoc({
          $id: "feed-1",
          status: "ok",
          lastTestedAt: "2026-01-01T00:00:00.000Z",
          lastTestError: "existing test error",
        }),
      ],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [makeFailure()],
    });

    const data = db.updateDocumentCalls[0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("lastTestedAt");
    expect(data).not.toHaveProperty("lastTestError");
  });

  it("does NOT write status, lastTestedAt, or lastTestError on success", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [
        makeDoc({
          $id: "feed-1",
          status: "failed",
          lastTestedAt: "2026-01-01T00:00:00.000Z",
          lastTestError: "test error",
        }),
      ],
    };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [],
    });

    const data = db.updateDocumentCalls[0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("lastTestedAt");
    expect(data).not.toHaveProperty("lastTestError");
  });

  // -- Unknown / orphan URL ----------------------------------------------

  it("skips unknown orphan URLs without throwing and performs no updates", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [makeDoc({ $id: "feed-1" })],
    };

    await expect(
      applyFeedFetchOutcomes(fakeClient(), {
        attemptedFeedUrls: ["https://orphan.example.com/feed"],
        failedFeeds: [makeFailure({ feedUrl: "https://orphan.example.com/feed" })],
      }),
    ).resolves.toBeUndefined();

    expect(db.updateDocumentCalls).toHaveLength(0);
  });

  it("ignores failures for URLs not in attemptedFeedUrls (defensive)", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [makeDoc({ $id: "feed-1" })],
    };

    // URL_A attempted + succeeded; URL_B failure only in failedFeeds, not attempted
    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [makeFailure({ feedUrl: URL_B })],
    });

    expect(db.updateDocumentCalls).toHaveLength(1);
    // URL_A was a success → reset
    expect(db.updateDocumentCalls[0].data).toMatchObject({
      consecutiveFetchFailures: 0,
      operationalHealth: "healthy",
      lastFetchError: "",
    });
  });

  // -- Per-feed error isolation -------------------------------------------

  it("isolates per-feed update errors — a failing sibling does not block others", async () => {
    db.defaultListDocumentsResponse = {
      total: 2,
      documents: [makeDoc({ $id: "feed-a", url: URL_A }), makeDoc({ $id: "feed-b", url: URL_B })],
    };

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.updateDocumentImpl = (params) => {
      if (params.documentId === "feed-a") {
        throw appwriteException("boom", 500);
      }
      const now = new Date().toISOString();
      return {
        $id: params.documentId,
        $collectionId: params.collectionId,
        $databaseId: params.databaseId,
        $createdAt: now,
        $updatedAt: now,
        $permissions: [],
        ...(params.data as Record<string, unknown>),
      } as MockDocument;
    };

    await expect(
      applyFeedFetchOutcomes(fakeClient(), {
        attemptedFeedUrls: [URL_A, URL_B],
        failedFeeds: [],
      }),
    ).resolves.toBeUndefined();

    // Both updates were attempted despite feed-a throwing
    expect(db.updateDocumentCalls).toHaveLength(2);
    const updatedIds = db.updateDocumentCalls.map((c) => c.documentId);
    expect(updatedIds).toEqual(expect.arrayContaining(["feed-a", "feed-b"]));

    // feed-b got its success reset despite feed-a failing
    const feedBCall = db.updateDocumentCalls.find((c) => c.documentId === "feed-b");
    expect(feedBCall?.data).toMatchObject({
      consecutiveFetchFailures: 0,
      operationalHealth: "healthy",
      lastFetchError: "",
    });

    errSpy.mockRestore();
  });

  // -- Truncation ---------------------------------------------------------

  it("truncates lastFetchError to 1000 characters", async () => {
    db.defaultListDocumentsResponse = {
      total: 1,
      documents: [makeDoc({ $id: "feed-1" })],
    };

    const longMessage = "x".repeat(2500);

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [URL_A],
      failedFeeds: [makeFailure({ errorMessage: longMessage })],
    });

    const data = db.updateDocumentCalls[0].data;
    expect(data.lastFetchError).toHaveLength(1000);
    expect(data.lastFetchError).toBe("x".repeat(1000));
  });

  // -- Empty attempted list -----------------------------------------------

  it("resolves without updates when attemptedFeedUrls is empty", async () => {
    db.defaultListDocumentsResponse = { total: 0, documents: [] };

    await applyFeedFetchOutcomes(fakeClient(), {
      attemptedFeedUrls: [],
      failedFeeds: [],
    });

    expect(db.updateDocumentCalls).toHaveLength(0);
  });
});

describe("countUnhealthyFeeds", () => {
  function makeFeed(overrides: Partial<Feed>): Feed {
    return {
      $id: "feed-1",
      name: "Test",
      url: URL_A,
      notes: "",
      status: "ok",
      lastTestedAt: null,
      lastTestError: null,
      operationalHealth: "healthy",
      consecutiveFetchFailures: 0,
      lastFetchError: "",
      lastFetchAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("counts only feeds with operationalHealth === 'unhealthy'", () => {
    const feeds: Feed[] = [
      makeFeed({ $id: "1", operationalHealth: "healthy" }),
      makeFeed({ $id: "2", operationalHealth: "unhealthy" }),
      makeFeed({ $id: "3", operationalHealth: "healthy" }),
      makeFeed({ $id: "4", operationalHealth: "unhealthy" }),
    ];
    expect(countUnhealthyFeeds(feeds)).toBe(2);
  });

  it("returns 0 when all feeds are healthy", () => {
    const feeds: Feed[] = [
      makeFeed({ $id: "1", operationalHealth: "healthy" }),
      makeFeed({ $id: "2", operationalHealth: "healthy" }),
    ];
    expect(countUnhealthyFeeds(feeds)).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(countUnhealthyFeeds([])).toBe(0);
  });
});
