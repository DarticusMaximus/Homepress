import type { Client } from "node-appwrite";

/**
 * Appwrite-exception-shaped error. Mirrors the helper in
 * `shared/src/schema/__tests__/mock-client.ts` so the health-check tests can
 * reuse the same `appwriteException(message, code, type)` factory pattern as
 * the provisioner tests. node-appwrite's `AppwriteException` extends Error and
 * exposes `code: number`, `type: string`, `response: string`; we mirror that
 * shape so `runHealthCheck` can detect the code via `err.code`.
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

/**
 * The exact object-parameter shapes from node-appwrite v26 for the three
 * document methods we round-trip. Keeps the mock's recorded calls shape-checked
 * against the real SDK so a signature drift shows up here, not in production.
 */
export interface CreateDocumentParams {
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

/**
 * Test double for the three `Databases` methods that `runHealthCheck` calls:
 * `createDocument`, `getDocument`, `deleteDocument`. Same shape as the
 * provisioner's `MockDatabases`: per-method error injection via
 * `createDocumentError` / `getDocumentError` / `deleteDocumentError`, calls
 * recorded (params cloned) into `*.calls` arrays, and an optional `delayMs`
 * for timing assertions. The `lastCreatedDocumentId` field lets the test
 * assert that `runHealthCheck` propagates the captured id back on the result.
 *
 * Sibling to `MockDatabases` in `shared/src/schema/__tests__/mock-client.ts`
 * (not an extension of it) — the two mocks are intentionally separate because
 * the schema module and the health module operate on disjoint concerns.
 */
export class MockDocuments {
  // ---- response config ----
  createDocumentError: AppwriteExceptionLike | null = null;
  getDocumentError: AppwriteExceptionLike | null = null;
  deleteDocumentError: AppwriteExceptionLike | null = null;

  /** Artificial delay applied to every method call (used by the timing test). */
  delayMs = 0;

  // ---- call recording ----
  readonly createDocumentCalls: CreateDocumentParams[] = [];
  readonly getDocumentCalls: GetDocumentParams[] = [];
  readonly deleteDocumentCalls: DeleteDocumentParams[] = [];

  /** The documentId from the last createDocument call (mirrors doc.$id). */
  lastCreatedDocumentId: string | null = null;

  reset(): void {
    this.createDocumentError = null;
    this.getDocumentError = null;
    this.deleteDocumentError = null;
    this.delayMs = 0;
    this.lastCreatedDocumentId = null;
    (this.createDocumentCalls as CreateDocumentParams[]).length = 0;
    (this.getDocumentCalls as GetDocumentParams[]).length = 0;
    (this.deleteDocumentCalls as DeleteDocumentParams[]).length = 0;
  }

  private async sleep(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  async createDocument(params: CreateDocumentParams): Promise<MockDocument> {
    await this.sleep();
    this.createDocumentCalls.push({ ...params });
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

  async getDocument(params: GetDocumentParams): Promise<MockDocument> {
    await this.sleep();
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
      status: "ok",
      createdAt: now,
    };
  }

  async deleteDocument(params: DeleteDocumentParams): Promise<Record<string, never>> {
    await this.sleep();
    this.deleteDocumentCalls.push({ ...params });
    if (this.deleteDocumentError) return Promise.reject(this.deleteDocumentError);
    return {};
  }
}

/** A no-op Client stand-in; the real Client is never constructed in unit tests. */
export function fakeClient(): Client {
  return {} as Client;
}
