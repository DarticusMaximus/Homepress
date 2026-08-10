import type { Client } from "node-appwrite";

/**
 * Appwrite-exception-shaped error. Mirrors the helper in
 * `shared/src/health/__tests__/mock-client.ts` so feed repository tests can
 * inject SDK failures with the same `appwriteException(message, code, type)`
 * factory pattern.
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
 * feed repository: `listDocuments`, `createDocument`, `updateDocument`,
 * `deleteDocument`, and optionally `getDocument`. Per-method error injection,
 * call recording, and an optional `listDocumentsImpl` hook let each test stage
 * duplicate-url checks, junction lookups, and list/sort behaviour.
 */
export class MockFeedsDatabases {
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

  /**
   * Optional per-call handler. When set, `updateDocument` delegates here instead
   * of returning the default synthesized document. Used for per-call error
   * injection (e.g. feed-health isolation tests).
   */
  updateDocumentImpl:
    ((params: UpdateDocumentParams) => MockDocument | Promise<MockDocument>) | null = null;

  defaultListDocumentsResponse: ListDocumentsResponse = { total: 0, documents: [] };

  readonly listDocumentsCalls: ListDocumentsParams[] = [];
  readonly createDocumentCalls: CreateDocumentParams[] = [];
  readonly updateDocumentCalls: UpdateDocumentParams[] = [];
  readonly deleteDocumentCalls: DeleteDocumentParams[] = [];
  readonly getDocumentCalls: GetDocumentParams[] = [];

  lastCreatedDocumentId: string | null = null;

  reset(): void {
    this.listDocumentsError = null;
    this.createDocumentError = null;
    this.updateDocumentError = null;
    this.deleteDocumentError = null;
    this.getDocumentError = null;
    this.listDocumentsImpl = null;
    this.updateDocumentImpl = null;
    this.defaultListDocumentsResponse = { total: 0, documents: [] };
    this.lastCreatedDocumentId = null;
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
    if (this.updateDocumentImpl) {
      return this.updateDocumentImpl(params);
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
    };
  }

  async getDocument(params: GetDocumentParams): Promise<MockDocument> {
    this.getDocumentCalls.push({ ...params });
    if (this.getDocumentError) return Promise.reject(this.getDocumentError);
    const now = new Date().toISOString();
    return {
      $id: params.documentId,
      $collectionId: params.collectionId,
      $databaseId: params.databaseId,
      $createdAt: now,
      $updatedAt: now,
      $permissions: [],
      name: "Existing Feed",
      url: "https://example.com/feed",
      notes: "",
      status: "ok",
      operationalHealth: "healthy",
      consecutiveFetchFailures: 0,
      lastFetchError: "",
      lastFetchAt: null,
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

/** Build a feed-shaped mock document for list/update scenarios. */
export function mockFeedDocument(
  overrides: Partial<MockDocument> & Pick<MockDocument, "$id">,
): MockDocument {
  const now = new Date().toISOString();
  return {
    $collectionId: "feeds",
    $databaseId: "newsletter_db",
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    name: "Test Feed",
    url: "https://example.com/feed",
    notes: "",
    status: "untested",
    lastTestedAt: null,
    lastTestError: null,
    operationalHealth: "healthy",
    consecutiveFetchFailures: 0,
    lastFetchError: "",
    lastFetchAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
