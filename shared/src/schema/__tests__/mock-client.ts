import type { Client } from "node-appwrite";

/**
 * Appwrite-exception-shaped error. node-appwrite's `AppwriteException` extends
 * Error and exposes `code: number`, `type: string`, `response: string`. We mirror
 * that shape so the real provisioner (Task 3) can detect 409 via `err.code === 409`.
 */
export interface AppwriteExceptionLike extends Error {
  code: number;
  type: string;
  response: string;
}

/** Build an Appwrite-exception-shaped error. For 409 use `code: 409`. */
export function appwriteException(message: string, code: number, type = ""): AppwriteExceptionLike {
  const err = new Error(message) as AppwriteExceptionLike;
  err.name = "AppwriteException";
  err.code = code;
  err.type = type;
  err.response = "";
  return err;
}

export interface MockDatabaseEntry {
  $id: string;
  name: string;
}

export interface MockCollectionEntry {
  $id: string;
  name: string;
}

/**
 * A live attribute as returned by `Databases.listAttributes`. Shape mirrors the
 * relevant subset of Appwrite's attribute models (`Models.Attribute*`):
 * `{ key, type, size?, required?, array? }`.
 */
export interface MockAttributeEntry {
  key: string;
  type: string;
  size?: number;
  required?: boolean;
  array?: boolean;
}

export interface AttributeListResponse {
  total: number;
  attributes: MockAttributeEntry[];
}
export interface DatabaseListResponse {
  total: number;
  databases: MockDatabaseEntry[];
}
export interface CollectionListResponse {
  total: number;
  collections: MockCollectionEntry[];
}

/**
 * The exact `create<Type>Attribute` object-parameter shapes from node-appwrite v26.
 * NOTE: the SDK spells the default param `xdefault` (reserved word workaround).
 */
export interface CreateStringAttributeParams {
  databaseId: string;
  collectionId: string;
  key: string;
  size: number;
  required: boolean;
  xdefault?: string;
  array?: boolean;
  encrypt?: boolean;
}
export interface CreateDatetimeAttributeParams {
  databaseId: string;
  collectionId: string;
  key: string;
  required: boolean;
  xdefault?: string;
  array?: boolean;
}
export interface CreateFloatAttributeParams {
  databaseId: string;
  collectionId: string;
  key: string;
  required: boolean;
  min?: number;
  max?: number;
  xdefault?: number;
  array?: boolean;
}
export interface CreateBooleanAttributeParams {
  databaseId: string;
  collectionId: string;
  key: string;
  required: boolean;
  xdefault?: boolean;
  array?: boolean;
}
export interface CreateCollectionParams {
  databaseId: string;
  collectionId: string;
  name: string;
  permissions?: string[];
  documentSecurity?: boolean;
  enabled?: boolean;
  attributes?: unknown[];
  indexes?: unknown[];
}
export interface CreateDatabaseParams {
  databaseId: string;
  name: string;
  enabled?: boolean;
}
export interface ListAttributesParams {
  databaseId: string;
  collectionId: string;
  queries?: string[];
  total?: boolean;
}
export interface ListCollectionsParams {
  databaseId: string;
  queries?: string[];
  search?: string;
  total?: boolean;
}
export interface ListDatabasesParams {
  queries?: string[];
  search?: string;
  total?: boolean;
}

/**
 * Test double for node-appwrite v26 `Databases`. Every method uses the
 * object-parameter style (`{ databaseId, collectionId, ... }`) that the SDK v26
 * supports. Calls are recorded in the `*.calls` arrays (params objects cloned);
 * responses are driven by the public config fields so each test can stage a
 * scenario (fresh, idempotent, 409 race, drift, transient failure).
 *
 * SDK-shape assumptions (critical for Task 3):
 *  - `list()`            -> `{ total, databases: [...] }`  (Models.DatabaseList)
 *  - `listCollections()` -> `{ total, collections: [...] }` (Models.CollectionList)
 *  - `listAttributes()`  -> `{ total, attributes: [...] }`  (Models.AttributeList)
 *  - list entries use `$id` for database/collection ids, `key`+`type`(+`size`) for attributes.
 *  - `create*` throws an AppwriteException-shaped error (`{ code, type, message }`) when configured.
 */
export class MockDatabases {
  // ---- response config ----
  existingDatabases: MockDatabaseEntry[] = [];
  existingCollections: MockCollectionEntry[] = [];
  existingAttributes: MockAttributeEntry[] = [];

  /** Throw this on `create()` (database create). Used for 409 race. */
  createDatabaseError: AppwriteExceptionLike | null = null;
  /** Throw this on `createCollection()`. Used for 409 race. */
  createCollectionError: AppwriteExceptionLike | null = null;
  /** Throw this on `createStringAttribute()`. */
  createStringAttributeError: AppwriteExceptionLike | null = null;
  /** Throw this on `createDatetimeAttribute()`. Used for transient 500. */
  createDatetimeAttributeError: AppwriteExceptionLike | null = null;
  /** Throw this on `createFloatAttribute()`. */
  createFloatAttributeError: AppwriteExceptionLike | null = null;
  /** Throw this on `createBooleanAttribute()`. */
  createBooleanAttributeError: AppwriteExceptionLike | null = null;

  // ---- call recording ----
  readonly listCalls: ListDatabasesParams[] = [];
  readonly listCollectionsCalls: ListCollectionsParams[] = [];
  readonly listAttributesCalls: ListAttributesParams[] = [];
  readonly createCalls: CreateDatabaseParams[] = [];
  readonly createCollectionCalls: CreateCollectionParams[] = [];
  readonly createStringAttributeCalls: CreateStringAttributeParams[] = [];
  readonly createDatetimeAttributeCalls: CreateDatetimeAttributeParams[] = [];
  readonly createFloatAttributeCalls: CreateFloatAttributeParams[] = [];
  readonly createBooleanAttributeCalls: CreateBooleanAttributeParams[] = [];

  reset(): void {
    this.existingDatabases = [];
    this.existingCollections = [];
    this.existingAttributes = [];
    this.createDatabaseError = null;
    this.createCollectionError = null;
    this.createStringAttributeError = null;
    this.createDatetimeAttributeError = null;
    this.createFloatAttributeError = null;
    this.createBooleanAttributeError = null;
    (this.listCalls as ListDatabasesParams[]).length = 0;
    (this.listCollectionsCalls as ListCollectionsParams[]).length = 0;
    (this.listAttributesCalls as ListAttributesParams[]).length = 0;
    (this.createCalls as CreateDatabaseParams[]).length = 0;
    (this.createCollectionCalls as CreateCollectionParams[]).length = 0;
    (this.createStringAttributeCalls as CreateStringAttributeParams[]).length = 0;
    (this.createDatetimeAttributeCalls as CreateDatetimeAttributeParams[]).length = 0;
    (this.createFloatAttributeCalls as CreateFloatAttributeParams[]).length = 0;
    (this.createBooleanAttributeCalls as CreateBooleanAttributeParams[]).length = 0;
  }

  list(params?: ListDatabasesParams): Promise<DatabaseListResponse> {
    this.listCalls.push({ ...(params ?? {}) });
    return Promise.resolve({
      total: this.existingDatabases.length,
      databases: [...this.existingDatabases],
    });
  }

  listCollections(params: ListCollectionsParams): Promise<CollectionListResponse> {
    this.listCollectionsCalls.push({ ...params });
    return Promise.resolve({
      total: this.existingCollections.length,
      collections: [...this.existingCollections],
    });
  }

  listAttributes(params: ListAttributesParams): Promise<AttributeListResponse> {
    this.listAttributesCalls.push({ ...params });
    return Promise.resolve({
      total: this.existingAttributes.length,
      attributes: [...this.existingAttributes],
    });
  }

  create(params: CreateDatabaseParams): Promise<MockDatabaseEntry> {
    this.createCalls.push({ ...params });
    if (this.createDatabaseError) return Promise.reject(this.createDatabaseError);
    return Promise.resolve({ $id: params.databaseId, name: params.name });
  }

  createCollection(params: CreateCollectionParams): Promise<MockCollectionEntry> {
    this.createCollectionCalls.push({ ...params });
    if (this.createCollectionError) return Promise.reject(this.createCollectionError);
    return Promise.resolve({ $id: params.collectionId, name: params.name });
  }

  createStringAttribute(params: CreateStringAttributeParams): Promise<MockAttributeEntry> {
    this.createStringAttributeCalls.push({ ...params });
    if (this.createStringAttributeError) return Promise.reject(this.createStringAttributeError);
    return Promise.resolve({
      key: params.key,
      type: "string",
      size: params.size,
      required: params.required,
      ...(params.array !== undefined ? { array: params.array } : {}),
    });
  }

  createDatetimeAttribute(params: CreateDatetimeAttributeParams): Promise<MockAttributeEntry> {
    this.createDatetimeAttributeCalls.push({ ...params });
    if (this.createDatetimeAttributeError) return Promise.reject(this.createDatetimeAttributeError);
    return Promise.resolve({
      key: params.key,
      type: "datetime",
      required: params.required,
      ...(params.array !== undefined ? { array: params.array } : {}),
    });
  }

  createFloatAttribute(params: CreateFloatAttributeParams): Promise<MockAttributeEntry> {
    this.createFloatAttributeCalls.push({ ...params });
    if (this.createFloatAttributeError) return Promise.reject(this.createFloatAttributeError);
    return Promise.resolve({
      key: params.key,
      type: "float",
      required: params.required,
      ...(params.array !== undefined ? { array: params.array } : {}),
    });
  }

  createBooleanAttribute(params: CreateBooleanAttributeParams): Promise<MockAttributeEntry> {
    this.createBooleanAttributeCalls.push({ ...params });
    if (this.createBooleanAttributeError) return Promise.reject(this.createBooleanAttributeError);
    return Promise.resolve({
      key: params.key,
      type: "boolean",
      required: params.required,
      ...(params.array !== undefined ? { array: params.array } : {}),
    });
  }
}

// ------------------------------------------------------------------ buckets --
export interface MockBucketEntry {
  $id: string;
  name: string;
}
export interface BucketListResponse {
  total: number;
  buckets: MockBucketEntry[];
}
/**
 * The exact `createBucket` object-parameter shape from node-appwrite v26.
 */
export interface CreateBucketParams {
  bucketId: string;
  name: string;
  permissions?: string[];
  fileSecurity?: boolean;
  enabled?: boolean;
  maximumFileSize?: number;
  allowedFileExtensions?: string[];
  compression?: string;
  encryption?: boolean;
  antivirus?: boolean;
}
export interface ListBucketsParams {
  queries?: string[];
  search?: string;
  total?: boolean;
}

/**
 * Test double for node-appwrite v26 `Storage`. Mirrors `MockDatabases`:
 * object-parameter style, calls recorded in `*.calls` arrays, responses driven
 * by public config fields so each test can stage a scenario.
 *
 * SDK-shape assumptions:
 *  - `listBuckets()`  -> `{ total, buckets: [...] }` (Models.BucketList)
 *  - bucket entries use `$id` for the bucket id.
 *  - `createBucket()` throws an AppwriteException-shaped error when configured.
 */
export class MockStorage {
  // ---- response config ----
  existingBuckets: MockBucketEntry[] = [];

  /** Throw this on `createBucket()`. Used for 409 race. */
  createBucketError: AppwriteExceptionLike | null = null;
  /** Throw this on `listBuckets()`. Used for transient list failures. */
  listBucketsError: AppwriteExceptionLike | null = null;

  // ---- call recording ----
  readonly listBucketsCalls: ListBucketsParams[] = [];
  readonly createBucketCalls: CreateBucketParams[] = [];

  reset(): void {
    this.existingBuckets = [];
    this.createBucketError = null;
    this.listBucketsError = null;
    (this.listBucketsCalls as ListBucketsParams[]).length = 0;
    (this.createBucketCalls as CreateBucketParams[]).length = 0;
  }

  listBuckets(params?: ListBucketsParams): Promise<BucketListResponse> {
    this.listBucketsCalls.push({ ...(params ?? {}) });
    if (this.listBucketsError) return Promise.reject(this.listBucketsError);
    return Promise.resolve({
      total: this.existingBuckets.length,
      buckets: [...this.existingBuckets],
    });
  }

  createBucket(params: CreateBucketParams): Promise<MockBucketEntry> {
    this.createBucketCalls.push({ ...params });
    if (this.createBucketError) return Promise.reject(this.createBucketError);
    return Promise.resolve({ $id: params.bucketId, name: params.name });
  }
}

/** A no-op Client stand-in; the real Client is never constructed in unit tests. */
export function fakeClient(): Client {
  return {} as Client;
}
