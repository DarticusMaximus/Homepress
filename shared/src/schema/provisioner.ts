/**
 * Appwrite schema provisioner (Task 3).
 *
 * Create-if-absent only. Never drops, renames, retypes, or migrates. Drift
 * between the declared schema and the live schema is warned and skipped — it is
 * never auto-resolved. All create paths are list-before-create and treat a 409
 * ("already exists") as a benign race that counts as skipped rather than failed.
 */
import { Client, Databases, Storage } from "node-appwrite";
import {
  COLLECTIONS,
  BUCKETS,
  DATABASE_ID,
  DATABASE_NAME,
  type AttributeType,
  type SchemaAttribute,
} from "./declarations";

export interface CollectionResult {
  created: number;
  skipped: number;
  failed: number;
  drift: number;
}

export interface ProvisionResult {
  databases: { created: number; skipped: number; failed: number };
  collections: CollectionResult;
  attributes: CollectionResult;
  buckets: { created: number; skipped: number; failed: number };
  warnings?: string[];
}

/** A minimal view of an AppwriteException-shaped error: `{ code, type, message }`. */
interface AppwriteExceptionLike {
  code?: number;
  type?: string;
  message: string;
}

function isConflict(err: unknown): boolean {
  const e = err as AppwriteExceptionLike | undefined;
  return !!e && typeof e === "object" && e.code === 409;
}

/** Exhaustive check for `AttributeType`; throws if an unknown type sneaks through. */
function assertNeverType(type: never): never {
  throw new Error(`Unhandled attribute type: ${JSON.stringify(type)}`);
}

/** Minimal live-attribute shape from `listAttributes` (optional `array` defaults to false). */
type LiveAttribute = { key: string; type: string; size?: number; array?: boolean };

/**
 * Returns true if the live attribute matches the declared attribute. For string
 * attributes both `type` and `size` must match; other types only compare `type`
 * (number/boolean attributes have no `size`, so a missing size is not drift).
 * `array` is compared as `!!declared.array` vs live `array` (missing live = false).
 */
export function attributeMatches(declared: SchemaAttribute, live: LiveAttribute): boolean {
  // Appwrite stores our declared `number` attributes with live type `float`
  // or `double` (depending on version), so treat "number", "float", and
  // "double" as aliases in either direction.
  const normalizeType = (t: string): string => (t === "number" || t === "double" ? "float" : t);
  const declaredType = normalizeType(declared.type);
  const liveType = normalizeType(live.type);
  if (liveType !== declaredType) return false;
  if (!!declared.array !== !!live.array) return false;
  if (declared.type === "string") {
    // A string attribute must declare a size on both sides; a missing size is
    // drift, not a silent match.
    if (typeof declared.size !== "number" || typeof live.size !== "number") {
      return false;
    }
    return declared.size === live.size;
  }
  return true;
}

export async function provisionDatabase(client: Client): Promise<ProvisionResult> {
  const databases = new Databases(client);

  const result: ProvisionResult = {
    databases: { created: 0, skipped: 0, failed: 0 },
    collections: { created: 0, skipped: 0, failed: 0, drift: 0 },
    attributes: { created: 0, skipped: 0, failed: 0, drift: 0 },
    buckets: { created: 0, skipped: 0, failed: 0 },
    warnings: [],
  };

  const warn = (msg: string) => {
    result.warnings!.push(msg);
    console.warn(msg);
  };

  // ---------------------------------------------------------------- database --
  try {
    const existing = await databases.list();
    const found = existing.databases?.some((d) => d.$id === DATABASE_ID) ?? false;
    if (found) {
      result.databases.skipped += 1;
    } else {
      try {
        await databases.create({ databaseId: DATABASE_ID, name: DATABASE_NAME });
        result.databases.created += 1;
      } catch (err) {
        if (isConflict(err)) {
          result.databases.skipped += 1;
        } else {
          console.error({
            message: "Failed to create database",
            databaseId: DATABASE_ID,
            name: DATABASE_NAME,
            error: err instanceof Error ? err.message : String(err),
          });
          result.databases.failed += 1;
        }
      }
    }
  } catch (err) {
    console.error({
      message: "Failed to list databases",
      error: err instanceof Error ? err.message : String(err),
    });
    result.databases.failed += 1;
  }

  // --------------------------------------------------------------- collections --
  for (const collection of COLLECTIONS) {
    let collectionExists: boolean;
    try {
      const existing = await databases.listCollections({ databaseId: DATABASE_ID });
      collectionExists = existing.collections?.some((c) => c.$id === collection.id) ?? false;
    } catch (err) {
      console.error({
        message: "Failed to list collections",
        databaseId: DATABASE_ID,
        collectionId: collection.id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.collections.failed += 1;
      continue;
    }

    if (collectionExists) {
      result.collections.skipped += 1;
    } else {
      try {
        await databases.createCollection({
          databaseId: DATABASE_ID,
          collectionId: collection.id,
          name: collection.name,
          permissions: [],
        });
        result.collections.created += 1;
      } catch (err) {
        if (isConflict(err)) {
          result.collections.skipped += 1;
        } else {
          console.error({
            message: "Failed to create collection",
            databaseId: DATABASE_ID,
            collectionId: collection.id,
            name: collection.name,
            error: err instanceof Error ? err.message : String(err),
          });
          result.collections.failed += 1;
          continue;
        }
      }
    }

    // -------------------------------------------------------------- attributes --
    let liveAttributes: LiveAttribute[];
    try {
      const attrList = await databases.listAttributes({
        databaseId: DATABASE_ID,
        collectionId: collection.id,
      });
      liveAttributes = (attrList.attributes ?? []) as LiveAttribute[];
    } catch (err) {
      console.error({
        message: "Failed to list attributes",
        databaseId: DATABASE_ID,
        collectionId: collection.id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.attributes.failed += collection.attributes.length;
      continue;
    }

    const liveByKey = new Map<string, LiveAttribute>();
    for (const a of liveAttributes) liveByKey.set(a.key, a);

    for (const declared of collection.attributes) {
      const live = liveByKey.get(declared.key);
      if (live) {
        if (attributeMatches(declared, live)) {
          result.attributes.skipped += 1;
        } else {
          const driftMsg = `Schema drift detected for collection "${collection.id}" attribute "${declared.key}": declared type "${declared.type}"${
            declared.type === "string" ? ` (size ${declared.size ?? "?"})` : ""
          } differs from live type "${live.type}"${
            live.type === "string" ? ` (size ${live.size ?? "?"})` : ""
          }; skipping without modifying.`;
          warn(driftMsg);
          result.attributes.drift += 1;
        }
        continue;
      }

      try {
        const isArray = declared.array === true;
        const type: AttributeType = declared.type;
        switch (type) {
          case "string": {
            const params: {
              databaseId: string;
              collectionId: string;
              key: string;
              size: number;
              required: boolean;
              array: boolean;
              xdefault?: string;
            } = {
              databaseId: DATABASE_ID,
              collectionId: collection.id,
              key: declared.key,
              size: declared.size ?? 1,
              required: declared.required,
              array: isArray,
            };
            if (!isArray && declared.default !== undefined) {
              params.xdefault = declared.default as string;
            }
            await databases.createStringAttribute(params);
            break;
          }
          case "datetime": {
            const params: {
              databaseId: string;
              collectionId: string;
              key: string;
              required: boolean;
              array: boolean;
              xdefault?: string;
            } = {
              databaseId: DATABASE_ID,
              collectionId: collection.id,
              key: declared.key,
              required: declared.required,
              array: isArray,
            };
            if (!isArray && declared.default !== undefined) {
              params.xdefault = declared.default as string;
            }
            await databases.createDatetimeAttribute(params);
            break;
          }
          case "number": {
            const params: {
              databaseId: string;
              collectionId: string;
              key: string;
              required: boolean;
              array: boolean;
              xdefault?: number;
            } = {
              databaseId: DATABASE_ID,
              collectionId: collection.id,
              key: declared.key,
              required: declared.required,
              array: isArray,
            };
            if (!isArray && declared.default !== undefined) {
              params.xdefault = declared.default as number;
            }
            await databases.createFloatAttribute(params);
            break;
          }
          case "boolean": {
            const params: {
              databaseId: string;
              collectionId: string;
              key: string;
              required: boolean;
              array: boolean;
              xdefault?: boolean;
            } = {
              databaseId: DATABASE_ID,
              collectionId: collection.id,
              key: declared.key,
              required: declared.required,
              array: isArray,
            };
            if (!isArray && declared.default !== undefined) {
              params.xdefault = declared.default as boolean;
            }
            await databases.createBooleanAttribute(params);
            break;
          }
          default:
            assertNeverType(type);
        }
        result.attributes.created += 1;
      } catch (err) {
        if (isConflict(err)) {
          result.attributes.skipped += 1;
        } else {
          console.error({
            message: "Failed to create attribute",
            databaseId: DATABASE_ID,
            collectionId: collection.id,
            key: declared.key,
            type: declared.type,
            error: err instanceof Error ? err.message : String(err),
          });
          result.attributes.failed += 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------ buckets --
  const storage = new Storage(client);
  for (const bucket of BUCKETS) {
    let bucketExists: boolean;
    try {
      const existing = await storage.listBuckets();
      bucketExists = existing.buckets?.some((b) => b.$id === bucket.id) ?? false;
    } catch (err) {
      console.error({
        message: "Failed to list buckets",
        bucketId: bucket.id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.buckets.failed += 1;
      continue;
    }

    if (bucketExists) {
      result.buckets.skipped += 1;
    } else {
      try {
        await storage.createBucket({
          bucketId: bucket.id,
          name: bucket.name,
          permissions: bucket.permissions,
          fileSecurity: bucket.fileSecurity,
          enabled: bucket.enabled,
          maximumFileSize: bucket.maximumFileSize,
          allowedFileExtensions: bucket.allowedFileExtensions,
        });
        result.buckets.created += 1;
      } catch (err) {
        if (isConflict(err)) {
          result.buckets.skipped += 1;
        } else {
          console.error({
            message: "Failed to create bucket",
            bucketId: bucket.id,
            name: bucket.name,
            error: err instanceof Error ? err.message : String(err),
          });
          result.buckets.failed += 1;
        }
      }
    }
  }

  return result;
}
