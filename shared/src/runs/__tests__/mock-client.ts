import type { Client } from "node-appwrite";

/**
 * Appwrite-exception-shaped error. Mirrors the helper in
 * `shared/src/feeds/__tests__/mock-client.ts` so run repository tests can
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

// ---------------------------------------------------------------------------
// Storage mock (node-appwrite v26 object-parameter file CRUD)
// ---------------------------------------------------------------------------

/** Minimal shape we need from a node-appwrite `InputFile` to extract content. */
interface InputFileLike {
  filename: string;
  size(): Promise<number>;
  slice(start: number, end: number): Promise<Uint8Array>;
}

export interface CreateFileParams {
  bucketId: string;
  fileId: string;
  file: InputFileLike;
  permissions?: string[];
  onProgress?: never;
}

export interface GetFileDownloadParams {
  bucketId: string;
  fileId: string;
  token?: string;
}

export interface DeleteFileParams {
  bucketId: string;
  fileId: string;
}

export interface StoredFile {
  name: string;
  content: string;
}

export interface MockFile {
  $id: string;
  bucketId: string;
  name: string;
  $createdAt: string;
  $updatedAt: string;
  $permissions: string[];
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
 * run repository: `listDocuments`, `createDocument`, `updateDocument`,
 * `deleteDocument`, and `getDocument`. Per-method error injection, call
 * recording, and an optional `getDocumentImpl` hook let each test stage
 * simulate 404s, Appwrite failures, and custom document shapes.
 */
export class MockRunsDatabases {
  listDocumentsError: AppwriteExceptionLike | null = null;
  createDocumentError: AppwriteExceptionLike | null = null;
  updateDocumentError: AppwriteExceptionLike | null = null;
  /**
   * Optional per-call dynamic error injector for `updateDocument`. When set,
   * each call consults this function (receiving the params and the 0-based
   * call index); a non-null return is rejected. Checked before the static
   * `updateDocumentError`. Lets a test fail the first N calls while allowing
   * later calls (e.g. a best-effort `markFailed`) to succeed.
   */
  updateDocumentErrorFn:
    ((params: UpdateDocumentParams, callIndex: number) => AppwriteExceptionLike | null) | null =
    null;
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

  /**
   * Optional per-call handler. When set, `getDocument` delegates here instead
   * of returning the default run-shaped document.
   */
  getDocumentImpl: ((params: GetDocumentParams) => MockDocument | Promise<MockDocument>) | null =
    null;

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
    this.updateDocumentErrorFn = null;
    this.deleteDocumentError = null;
    this.getDocumentError = null;
    this.listDocumentsImpl = null;
    this.defaultListDocumentsResponse = { total: 0, documents: [] };
    this.getDocumentImpl = null;
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
    const callIndex = this.updateDocumentCalls.length - 1;
    if (this.updateDocumentErrorFn) {
      const dynamicError = this.updateDocumentErrorFn(params, callIndex);
      if (dynamicError) return Promise.reject(dynamicError);
    }
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
    if (this.getDocumentImpl) {
      return await this.getDocumentImpl(params);
    }
    return mockRunDocument({ $id: params.documentId });
  }

  async deleteDocument(params: DeleteDocumentParams): Promise<Record<string, never>> {
    this.deleteDocumentCalls.push({ ...params });
    if (this.deleteDocumentError) return Promise.reject(this.deleteDocumentError);
    return {};
  }
}

/**
 * Test double for node-appwrite v26 `Storage` file methods used by the run
 * repository: `createFile`, `getFileDownload`, `deleteFile`. Object-parameter
 * style, per-method error injection, call recording, and an in-memory `files`
 * map keyed by fileId so tests can assert on uploaded JSON content and round-trip
 * downloads. `createFile` extracts the text payload from a real `InputFile`
 * (passed through un-mocked from `node-appwrite/file`) via its public
 * `size()`/`slice()` API.
 */
export class MockStorage {
  files = new Map<string, StoredFile>();

  createFileError: AppwriteExceptionLike | null = null;
  getFileDownloadError: AppwriteExceptionLike | null = null;
  deleteFileError: AppwriteExceptionLike | null = null;

  readonly createFileCalls: CreateFileParams[] = [];
  readonly getFileDownloadCalls: GetFileDownloadParams[] = [];
  readonly deleteFileCalls: DeleteFileParams[] = [];

  reset(): void {
    this.files.clear();
    this.createFileError = null;
    this.getFileDownloadError = null;
    this.deleteFileError = null;
    (this.createFileCalls as CreateFileParams[]).length = 0;
    (this.getFileDownloadCalls as GetFileDownloadParams[]).length = 0;
    (this.deleteFileCalls as DeleteFileParams[]).length = 0;
  }

  async createFile(params: CreateFileParams): Promise<MockFile> {
    this.createFileCalls.push({ ...params });
    if (this.createFileError) return Promise.reject(this.createFileError);
    const size = await params.file.size();
    const bytes = await params.file.slice(0, size);
    const content = new TextDecoder().decode(bytes);
    this.files.set(params.fileId, {
      name: params.file.filename,
      content,
    });
    const now = new Date().toISOString();
    return {
      $id: params.fileId,
      bucketId: params.bucketId,
      name: params.file.filename,
      $createdAt: now,
      $updatedAt: now,
      $permissions: params.permissions ?? [],
    };
  }

  async getFileDownload(params: GetFileDownloadParams): Promise<Uint8Array> {
    this.getFileDownloadCalls.push({ ...params });
    if (this.getFileDownloadError) {
      return Promise.reject(this.getFileDownloadError);
    }
    const stored = this.files.get(params.fileId);
    if (!stored) {
      return Promise.reject(appwriteException("File not found", 404));
    }
    return Promise.resolve(new TextEncoder().encode(stored.content));
  }

  async deleteFile(params: DeleteFileParams): Promise<Record<string, never>> {
    this.deleteFileCalls.push({ ...params });
    if (this.deleteFileError) return Promise.reject(this.deleteFileError);
    this.files.delete(params.fileId);
    return {};
  }
}

/** A no-op Client stand-in; the real Client is never constructed in unit tests. */
export function fakeClient(): Client {
  return {} as Client;
}

/** Build a run-shaped mock document for get/update/list scenarios. */
export function mockRunDocument(
  overrides: Partial<MockDocument> & Pick<MockDocument, "$id">,
): MockDocument {
  const now = new Date().toISOString();
  return {
    $collectionId: "runs",
    $databaseId: "newsletter_db",
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    newsletterId: "newsletter-1",
    newsletterName: "Test Newsletter",
    status: "pending",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "",
    failedPhase: "",
    failureMessage: "",
    startedAt: now,
    endedAt: null,
    topicSummary: "",
    failedFeeds: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "",
    ...overrides,
  };
}
