import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";

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

// Intentionally imports a module that does not exist yet (Task 3).
// Cases 7–9 fail red for missing module / unimplemented API.
// Constants may live on the module or be re-exported from schema (Task 2).
import {
  upsertRssPublication,
  trimRssPublications,
  RSS_PUBLICATIONS_COLLECTION_ID,
  RSS_FEED_MAX_ITEMS,
} from "../rss-publications";
import { DATABASE_ID } from "../../schema/declarations";

type AppwriteExceptionLike = Error & { code: number; type: string; response: string };

function appwriteException(message: string, code: number, type = ""): AppwriteExceptionLike {
  const err = new Error(message) as AppwriteExceptionLike;
  err.name = "AppwriteException";
  err.code = code;
  err.type = type;
  err.response = "";
  return err;
}

type MockDocument = {
  $id: string;
  $collectionId: string;
  $databaseId: string;
  $createdAt: string;
  $updatedAt: string;
  $permissions: string[];
  [key: string]: unknown;
};

type GetDocumentParams = {
  databaseId: string;
  collectionId: string;
  documentId: string;
};

type CreateDocumentParams = {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
};

type UpdateDocumentParams = {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
};

type ListDocumentsParams = {
  databaseId: string;
  collectionId: string;
  queries?: string[];
};

type DeleteDocumentParams = {
  databaseId: string;
  collectionId: string;
  documentId: string;
};

/**
 * Minimal Databases double for RSS publication upsert/trim — no live Appwrite.
 */
class MockRssDatabases {
  getDocumentError: AppwriteExceptionLike | null = null;
  createDocumentError: AppwriteExceptionLike | null = null;
  updateDocumentError: AppwriteExceptionLike | null = null;
  deleteDocumentError: AppwriteExceptionLike | null = null;

  readonly getDocumentCalls: GetDocumentParams[] = [];
  readonly createDocumentCalls: CreateDocumentParams[] = [];
  readonly updateDocumentCalls: UpdateDocumentParams[] = [];
  readonly listDocumentsCalls: ListDocumentsParams[] = [];
  readonly deleteDocumentCalls: DeleteDocumentParams[] = [];

  private readonly store = new Map<string, MockDocument>();

  seed(doc: MockDocument): void {
    this.store.set(`${doc.$collectionId}:${doc.$id}`, { ...doc });
  }

  reset(): void {
    this.getDocumentError = null;
    this.createDocumentError = null;
    this.updateDocumentError = null;
    this.deleteDocumentError = null;
    this.store.clear();
    (this.getDocumentCalls as GetDocumentParams[]).length = 0;
    (this.createDocumentCalls as CreateDocumentParams[]).length = 0;
    (this.updateDocumentCalls as UpdateDocumentParams[]).length = 0;
    (this.listDocumentsCalls as ListDocumentsParams[]).length = 0;
    (this.deleteDocumentCalls as DeleteDocumentParams[]).length = 0;
  }

  async getDocument(params: GetDocumentParams): Promise<MockDocument> {
    this.getDocumentCalls.push({ ...params });
    if (this.getDocumentError) return Promise.reject(this.getDocumentError);
    const keyed = this.store.get(`${params.collectionId}:${params.documentId}`);
    if (keyed) return { ...keyed };
    return Promise.reject(appwriteException("Document not found", 404));
  }

  async createDocument(params: CreateDocumentParams): Promise<MockDocument> {
    this.createDocumentCalls.push({ ...params, data: { ...params.data } });
    if (this.createDocumentError) return Promise.reject(this.createDocumentError);
    const now = new Date().toISOString();
    const doc: MockDocument = {
      $id: params.documentId,
      $collectionId: params.collectionId,
      $databaseId: params.databaseId,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      ...(params.data as Record<string, unknown>),
    };
    this.store.set(`${params.collectionId}:${params.documentId}`, doc);
    return { ...doc };
  }

  async updateDocument(params: UpdateDocumentParams): Promise<MockDocument> {
    this.updateDocumentCalls.push({ ...params, data: { ...params.data } });
    if (this.updateDocumentError) return Promise.reject(this.updateDocumentError);
    const key = `${params.collectionId}:${params.documentId}`;
    const existing = this.store.get(key);
    const now = new Date().toISOString();
    const doc: MockDocument = {
      $id: params.documentId,
      $collectionId: params.collectionId,
      $databaseId: params.databaseId,
      $createdAt: existing?.$createdAt ?? now,
      $updatedAt: now,
      $permissions: [],
      ...(existing ?? {}),
      ...(params.data as Record<string, unknown>),
    };
    this.store.set(key, doc);
    return { ...doc };
  }

  async listDocuments(params: ListDocumentsParams): Promise<{
    total: number;
    documents: MockDocument[];
  }> {
    this.listDocumentsCalls.push({
      ...params,
      queries: params.queries ? [...params.queries] : undefined,
    });
    const docs = [...this.store.values()].filter(
      (d) => d.$collectionId === params.collectionId,
    );
    // Production filters by newsletterId + orderBy pubDate; tests assert via calls
    // and remaining store size after trim. Return all matching collection docs.
    return { total: docs.length, documents: docs.map((d) => ({ ...d })) };
  }

  async deleteDocument(params: DeleteDocumentParams): Promise<Record<string, never>> {
    this.deleteDocumentCalls.push({ ...params });
    if (this.deleteDocumentError) return Promise.reject(this.deleteDocumentError);
    this.store.delete(`${params.collectionId}:${params.documentId}`);
    return {};
  }

  docsForNewsletter(newsletterId: string): MockDocument[] {
    return [...this.store.values()].filter(
      (d) =>
        d.$collectionId === RSS_PUBLICATIONS_COLLECTION_ID &&
        d.newsletterId === newsletterId,
    );
  }
}

function fakeClient(): Client {
  return {} as Client;
}

describe("rss publications constants", () => {
  it("exports collection id and feed max of 10", () => {
    expect(RSS_PUBLICATIONS_COLLECTION_ID).toBe("rss_publications");
    expect(RSS_FEED_MAX_ITEMS).toBe(10);
  });
});

describe("upsertRssPublication — create", () => {
  let docs: MockRssDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRssDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("creates a document with $id=runId when none exists", async () => {
    const runId = "run-new-1";
    const input = {
      newsletterId: "nl-1",
      runId,
      title: "Weekly Tech Digest",
      htmlBody: "<h1>Hello</h1>",
      pubDate: "2026-07-01T11:00:00.000Z",
    };

    await upsertRssPublication(client, input);

    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls).toHaveLength(0);
    const create = docs.createDocumentCalls[0]!;
    expect(create.databaseId).toBe(DATABASE_ID);
    expect(create.collectionId).toBe(RSS_PUBLICATIONS_COLLECTION_ID);
    expect(create.documentId).toBe(runId);
    expect(create.data).toMatchObject({
      newsletterId: "nl-1",
      runId,
      title: "Weekly Tech Digest",
      htmlBody: "<h1>Hello</h1>",
      pubDate: "2026-07-01T11:00:00.000Z",
    });
    expect(create.data).toHaveProperty("updatedAt");
  });
});

describe("upsertRssPublication — update (republish)", () => {
  let docs: MockRssDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRssDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("updates title/htmlBody/pubDate when a document for runId already exists", async () => {
    const runId = "run-existing-1";
    const now = new Date().toISOString();
    docs.seed({
      $id: runId,
      $collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
      $databaseId: DATABASE_ID,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      newsletterId: "nl-1",
      runId,
      title: "Old Title",
      htmlBody: "<p>old</p>",
      pubDate: "2026-06-01T10:00:00.000Z",
      updatedAt: now,
    });

    await upsertRssPublication(client, {
      newsletterId: "nl-1",
      runId,
      title: "Refreshed Title",
      htmlBody: "<h1>New HTML</h1>",
      pubDate: "2026-07-15T12:00:00.000Z",
    });

    expect(docs.createDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const update = docs.updateDocumentCalls[0]!;
    expect(update.documentId).toBe(runId);
    expect(update.collectionId).toBe(RSS_PUBLICATIONS_COLLECTION_ID);
    expect(update.data).toMatchObject({
      title: "Refreshed Title",
      htmlBody: "<h1>New HTML</h1>",
      pubDate: "2026-07-15T12:00:00.000Z",
    });
  });
});

describe("trimRssPublications", () => {
  let docs: MockRssDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRssDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("leaves 10 publications after trim when 11 exist (oldest pubDate removed)", async () => {
    const newsletterId = "nl-trim";
    const now = new Date().toISOString();

    for (let i = 0; i < 11; i++) {
      const runId = `run-trim-${i}`;
      // pubDate ascending: run-trim-0 is oldest, run-trim-10 newest
      const pubDate = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      docs.seed({
        $id: runId,
        $collectionId: RSS_PUBLICATIONS_COLLECTION_ID,
        $databaseId: DATABASE_ID,
        $createdAt: now,
        $updatedAt: now,
        $permissions: [],
        newsletterId,
        runId,
        title: `Issue ${i}`,
        htmlBody: `<p>${i}</p>`,
        pubDate,
        updatedAt: now,
      });
    }

    expect(docs.docsForNewsletter(newsletterId)).toHaveLength(11);

    await trimRssPublications(client, newsletterId);

    const remaining = docs.docsForNewsletter(newsletterId);
    expect(remaining).toHaveLength(RSS_FEED_MAX_ITEMS);
    expect(remaining.map((d) => d.$id)).not.toContain("run-trim-0");
    expect(docs.deleteDocumentCalls.length).toBeGreaterThanOrEqual(1);
    expect(docs.deleteDocumentCalls.some((c) => c.documentId === "run-trim-0")).toBe(
      true,
    );
  });
});
