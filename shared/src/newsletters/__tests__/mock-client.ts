import type { Client } from "node-appwrite";

import {
  DATABASE_ID,
  FEEDS_COLLECTION_ID,
  NEWSLETTERS_COLLECTION_ID,
  NEWSLETTER_FEEDS_COLLECTION_ID,
  type FeedStatus,
} from "../../schema/declarations";

/**
 * Appwrite-exception-shaped error. Mirrors the helper in
 * `shared/src/feeds/__tests__/mock-client.ts` (itself mirrored from health) so
 * newsletter repository tests can inject SDK failures with the same
 * `appwriteException(message, code, type)` factory pattern.
 *
 * A dedicated newsletter mock is kept (rather than importing the feeds one) so
 * the newsletters module is self-contained and its `getDocument`/document
 * helpers return newsletter-shaped defaults — matching how feeds kept its own
 * copy despite mirroring health.
 */
export interface AppwriteExceptionLike extends Error {
  code: number;
  type: string;
  response: string;
}

export function appwriteException(message: string, code: number, type = ""): AppwriteExceptionLike {
  const err = new Error(message) as AppwriteExceptionLike;
  err.name = "AppwriteException";
  err.code = code;
  err.type = type;
  err.response = "";
  return err;
}

/** node-appwrite v26 object-parameter shapes for document CRUD. */
export interface ListDocumentsParams {
  databaseId: string;
  collectionId: string;
  queries?: string[];
  transactionId?: string;
  total?: boolean;
}

export interface CreateDocumentParams {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
  permissions?: string[];
  transactionId?: string;
}

export interface UpdateDocumentParams {
  databaseId: string;
  collectionId: string;
  documentId: string;
  data: Record<string, unknown>;
  permissions?: string[];
  transactionId?: string;
}

export interface GetDocumentParams {
  databaseId: string;
  collectionId: string;
  documentId: string;
  queries?: string[];
  transactionId?: string;
}

export interface DeleteDocumentParams {
  databaseId: string;
  collectionId: string;
  documentId: string;
  transactionId?: string;
}

/** Minimal Document shape — mirrors the `Models.Document` subset we read back. */
export interface MockDocument {
  $id: string;
  $collectionId: string;
  $databaseId: string;
  $createdAt: string;
  $updatedAt: string;
  $permissions: string[];
  [key: string]: unknown;
}

export interface ListDocumentsResponse {
  total: number;
  documents: MockDocument[];
}

/**
 * Test double for node-appwrite v26 `Databases` document methods used by the
 * newsletter repository: `listDocuments`, `createDocument`, `updateDocument`,
 * `deleteDocument`, and `getDocument`. Per-method error injection, call
 * recording, and an optional `listDocumentsImpl` hook let each test stage drive
 * junction lookups, list/sort behaviour, and not-found paths.
 */
export class MockNewslettersDatabases {
  listDocumentsError: AppwriteExceptionLike | null = null;
  createDocumentError: AppwriteExceptionLike | null = null;
  updateDocumentError: AppwriteExceptionLike | null = null;
  deleteDocumentError: AppwriteExceptionLike | null = null;
  getDocumentError: AppwriteExceptionLike | null = null;

  /**
   * Optional per-call handler. When set, `listDocuments` delegates here instead
   * of returning `defaultListDocumentsResponse`.
   */
  listDocumentsImpl:
    | ((params: ListDocumentsParams) => ListDocumentsResponse | Promise<ListDocumentsResponse>)
    | null = null;

  defaultListDocumentsResponse: ListDocumentsResponse = { total: 0, documents: [] };

  readonly listDocumentsCalls: ListDocumentsParams[] = [];
  readonly createDocumentCalls: CreateDocumentParams[] = [];
  readonly updateDocumentCalls: UpdateDocumentParams[] = [];
  readonly deleteDocumentCalls: DeleteDocumentParams[] = [];
  readonly getDocumentCalls: GetDocumentParams[] = [];

  lastCreatedDocumentId: string | null = null;

  /**
   * When true, `getDocument`/`listDocuments` serve the seeded document store:
   * `getDocument` returns the seeded doc or rejects with a 404 on misses, and
   * `listDocuments` filters seeded docs (by collectionId + `Query.equal`/limit).
   * Existing newsletter repository tests leave this false so legacy default
   * behaviour (newsletter-shaped `getDocument`, empty/default `listDocuments`)
   * is unchanged.
   */
  useSeedStore = false;

  private readonly seededDocuments = new Map<string, MockDocument>();

  /**
   * Register a document in the seed store keyed by
   * `${$collectionId}:${$id}`. In `useSeedStore` mode, `getDocument` reads
   * from here (miss → 404) and `listDocuments` filters the matching
   * collectionId by the call's `Query.equal`/`Query.limit` queries.
   */
  seedDocument(doc: MockDocument): void {
    this.seededDocuments.set(`${doc.$collectionId}:${doc.$id}`, { ...doc });
  }

  clearSeededDocuments(): void {
    this.seededDocuments.clear();
  }

  reset(): void {
    this.listDocumentsError = null;
    this.createDocumentError = null;
    this.updateDocumentError = null;
    this.deleteDocumentError = null;
    this.getDocumentError = null;
    this.listDocumentsImpl = null;
    this.defaultListDocumentsResponse = { total: 0, documents: [] };
    this.lastCreatedDocumentId = null;
    this.useSeedStore = false;
    this.seededDocuments.clear();
    (this.listDocumentsCalls as ListDocumentsParams[]).length = 0;
    (this.createDocumentCalls as CreateDocumentParams[]).length = 0;
    (this.updateDocumentCalls as UpdateDocumentParams[]).length = 0;
    (this.deleteDocumentCalls as DeleteDocumentParams[]).length = 0;
    (this.getDocumentCalls as GetDocumentParams[]).length = 0;
  }

  async listDocuments(params: ListDocumentsParams): Promise<ListDocumentsResponse> {
    this.listDocumentsCalls.push({
      ...params,
      queries: params.queries ? [...params.queries] : undefined,
    });
    if (this.listDocumentsError) return Promise.reject(this.listDocumentsError);
    if (this.listDocumentsImpl) {
      const result = await this.listDocumentsImpl(params);
      return { ...result, documents: [...result.documents] };
    }
    if (this.useSeedStore) {
      const queries = params.queries ?? [];
      let matched: MockDocument[] = [];
      for (const doc of this.seededDocuments.values()) {
        if (
          doc.$collectionId === params.collectionId &&
          queries.every((query) => queryMatchesDoc(doc, query))
        ) {
          matched.push({ ...doc });
        }
      }
      const limit = limitFromQueries(queries);
      if (limit !== undefined) {
        matched = matched.slice(0, limit);
      }
      return { total: matched.length, documents: matched };
    }
    return {
      total: this.defaultListDocumentsResponse.total,
      documents: [...this.defaultListDocumentsResponse.documents],
    };
  }

  async createDocument(params: CreateDocumentParams): Promise<MockDocument> {
    this.createDocumentCalls.push({ ...params, data: { ...params.data } });
    this.lastCreatedDocumentId = params.documentId;
    if (this.createDocumentError) return Promise.reject(this.createDocumentError);
    const now = new Date().toISOString();
    return {
      $id: params.documentId,
      $collectionId: params.collectionId,
      $databaseId: params.databaseId,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      ...(params.data as Record<string, unknown>),
    };
  }

  async updateDocument(params: UpdateDocumentParams): Promise<MockDocument> {
    this.updateDocumentCalls.push({ ...params, data: { ...params.data } });
    if (this.updateDocumentError) return Promise.reject(this.updateDocumentError);
    const now = new Date().toISOString();
    return {
      $id: params.documentId,
      $collectionId: params.collectionId,
      $databaseId: params.databaseId,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      ...(params.data as Record<string, unknown>),
    };
  }

  async getDocument(params: GetDocumentParams): Promise<MockDocument> {
    this.getDocumentCalls.push({ ...params });
    if (this.getDocumentError) return Promise.reject(this.getDocumentError);
    const seeded = this.seededDocuments.get(`${params.collectionId}:${params.documentId}`);
    if (seeded) {
      return { ...seeded };
    }
    if (this.useSeedStore) {
      return Promise.reject(appwriteException("document_not_found", 404));
    }
    const now = new Date().toISOString();
    return {
      $id: params.documentId,
      $collectionId: params.collectionId,
      $databaseId: params.databaseId,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      name: "Existing Newsletter",
      topics: ["AI"],
      dislikedTopics: [],
      audience: "",
      newsItems: 16,
      dateRange: "yesterday",
      createdAt: now,
      updatedAt: now,
    };
  }

  async deleteDocument(params: DeleteDocumentParams): Promise<Record<string, never>> {
    this.deleteDocumentCalls.push({ ...params });
    if (this.deleteDocumentError) return Promise.reject(this.deleteDocumentError);
    return {};
  }
}

/** A no-op Client stand-in; the real Client is never constructed in unit tests. */
export function fakeClient(): Client {
  return {} as Client;
}

/** Build a newsletter-shaped mock document for list/update scenarios. */
export function mockNewsletterDocument(
  overrides: Partial<MockDocument> & Pick<MockDocument, "$id">,
): MockDocument {
  const now = new Date().toISOString();
  return {
    $collectionId: NEWSLETTERS_COLLECTION_ID,
    $databaseId: DATABASE_ID,
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    name: "Test Newsletter",
    topics: ["AI"],
    dislikedTopics: [],
    audience: "",
    newsItems: 16,
    dateRange: "yesterday" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Build a newsletter_feeds junction-shaped mock document for delete-cascade scenarios. */
export function mockJunctionDocument(
  overrides: Partial<MockDocument> & Pick<MockDocument, "$id">,
): MockDocument {
  const now = new Date().toISOString();
  return {
    $collectionId: NEWSLETTER_FEEDS_COLLECTION_ID,
    $databaseId: DATABASE_ID,
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    newsletterId: "",
    feedId: "",
    createdAt: now,
    ...overrides,
  };
}

/** Build a feed-shaped mock document so attachment tests can seed `getFeed` reads. */
export function mockFeedDocument(
  overrides: Partial<MockDocument> & Pick<MockDocument, "$id">,
): MockDocument {
  const now = new Date().toISOString();
  return {
    $collectionId: FEEDS_COLLECTION_ID,
    $databaseId: DATABASE_ID,
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    name: "Test Feed",
    url: "https://example.com/feed",
    notes: "",
    status: "untested" as FeedStatus,
    lastTestedAt: null,
    lastTestError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Returns true if a seeded document satisfies a single node-appwrite query
 * string. Only `equal("attr","value")` is treated as a filter; `limit(n)` and
 * any unrecognised query pass through (non-filtering).
 */
function queryMatchesDoc(doc: MockDocument, query: string): boolean {
  const equal = query.match(/^equal\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)$/);
  if (equal) {
    const [, attr, val] = equal;
    return String(doc[attr] ?? "") === val;
  }
  return true;
}

/** Extracts the first `limit(n)` value from a query list, if present. */
function limitFromQueries(queries: string[]): number | undefined {
  for (const query of queries) {
    const match = query.match(/^limit\((\d+)\)$/);
    if (match) return Number(match[1]);
  }
  return undefined;
}
