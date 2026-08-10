import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Client } from "node-appwrite";

// Hoisted holder so the mocked `Databases`/`Storage` constructors can return our
// singletons even though vi.mock factories are hoisted above regular imports.
const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
  storage: null as unknown,
}));

vi.mock("node-appwrite", async (importActual) => {
  const actual = await importActual<typeof import("node-appwrite")>();
  return {
    ...actual,
    Databases: class MockDatabasesConstructor {
      constructor() {
        // A constructor may return an object; return the configured singleton.
        return mockHolder.databases as unknown as MockDatabasesConstructor;
      }
    },
    Storage: class MockStorageConstructor {
      constructor() {
        return mockHolder.storage as unknown as MockStorageConstructor;
      }
    },
  };
});

import { provisionDatabase, attributeMatches } from "../provisioner";
import type { SchemaCollection } from "../declarations";
import { MockDatabases, MockStorage, appwriteException, fakeClient } from "./mock-client";

// A sentinel secret value to prove the provisioner never leaks it.
const SECRET_API_KEY = "sk-secret-do-not-leak-1234567890";

/**
 * Scope COLLECTIONS to the health_check-only slice for legacy regression cases.
 * Restores the full four-collection array in `finally`.
 *
 * Critical mock constraint: MockDatabases.existingAttributes is a single global
 * list returned for every listAttributes call. With four collections, seeding
 * only health_check attrs contaminates feeds/newsletters (phantom drift).
 * Prefer this patch over bumping create counts against a shared attribute list.
 */
async function withHealthCheckOnlyCollections<T>(
  run: (collections: SchemaCollection[]) => Promise<T>,
): Promise<T> {
  const { COLLECTIONS } = await import("../declarations");
  const snapshot = COLLECTIONS.splice(0, COLLECTIONS.length);
  COLLECTIONS.push(snapshot[0]!);
  try {
    return await run(COLLECTIONS);
  } finally {
    COLLECTIONS.splice(0, COLLECTIONS.length, ...snapshot);
  }
}

describe("schema provisioner", () => {
  let db: MockDatabases;
  let storage: MockStorage;
  let client: Client;
  let logs: string[];
  let consoleSpies: Array<{ mock: ReturnType<typeof vi.spyOn> }>;

  beforeEach(() => {
    db = new MockDatabases();
    storage = new MockStorage();
    mockHolder.databases = db;
    mockHolder.storage = storage;
    client = fakeClient();
    logs = [];
    consoleSpies = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
      consoleSpies.push({ mock: spy });
    }
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mock.mockRestore());
  });

  // ---------------------------------------------------------------- fresh ----
  it("fresh provision: creates database, collection, and both attributes in order", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [];
      db.existingCollections = [];
      db.existingAttributes = [];

      const result = await provisionDatabase(client);

      // Database list-then-create.
      expect(db.listCalls).toHaveLength(1);
      expect(db.createCalls).toHaveLength(1);
      expect(db.createCalls[0]).toMatchObject({
        databaseId: "newsletter_db",
        name: "Homepress",
      });

      // Collection list-then-create.
      expect(db.listCollectionsCalls).toHaveLength(1);
      expect(db.createCollectionCalls).toHaveLength(1);
      expect(db.createCollectionCalls[0]).toMatchObject({
        databaseId: "newsletter_db",
        collectionId: "health_check",
      });

      // Attributes created in declaration order: status (string) then createdAt (datetime).
      expect(db.listAttributesCalls).toHaveLength(1);
      expect(db.createStringAttributeCalls).toHaveLength(1);
      expect(db.createStringAttributeCalls[0]).toMatchObject({
        databaseId: "newsletter_db",
        collectionId: "health_check",
        key: "status",
        size: 255,
        required: true,
      });
      expect(db.createDatetimeAttributeCalls).toHaveLength(1);
      expect(db.createDatetimeAttributeCalls[0]).toMatchObject({
        databaseId: "newsletter_db",
        collectionId: "health_check",
        key: "createdAt",
        required: true,
      });

      // Order: string before datetime.
      expect(db.createStringAttributeCalls[0].key).toBe("status");

      expect(result.databases.created).toBe(1);
      expect(result.collections.created).toBe(1);
      expect(result.attributes.created).toBe(2);
      expect(result.attributes.skipped).toBe(0);
      expect(result.attributes.drift).toBe(0);
      expect(result.attributes.failed).toBe(0);
    });
  });

  // ------------------------------------------------------------ idempotent ----
  it("idempotent re-run: list returns existing -> no create calls, all skipped, no throw", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      db.existingAttributes = [
        { key: "status", type: "string", size: 255, required: true },
        { key: "createdAt", type: "datetime", required: true },
      ];

      const result = await provisionDatabase(client);

      expect(db.createCalls).toHaveLength(0);
      expect(db.createCollectionCalls).toHaveLength(0);
      expect(db.createStringAttributeCalls).toHaveLength(0);
      expect(db.createDatetimeAttributeCalls).toHaveLength(0);

      expect(result.databases.created).toBe(0);
      expect(result.databases.skipped).toBe(1);
      expect(result.collections.created).toBe(0);
      expect(result.collections.skipped).toBe(1);
      expect(result.attributes.created).toBe(0);
      expect(result.attributes.skipped).toBe(2);
      expect(result.attributes.drift).toBe(0);
      expect(result.attributes.failed).toBe(0);
    });
  });

  // --------------------------------------------------------- 409 race ----------
  it("409 race on collection create: swallowed, skipped, no retry", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = []; // list says absent...
      db.createCollectionError = appwriteException("already exists", 409, "conflict");

      const result = await provisionDatabase(client);

      // create was attempted exactly once (no retry).
      expect(db.createCollectionCalls).toHaveLength(1);
      // attributes were still attempted (collection effectively present).
      expect(result.collections.created).toBe(0);
      expect(result.collections.skipped).toBe(1);
      expect(result.collections.failed).toBe(0);
      expect(result.attributes.created).toBe(2);
    });
  });

  // -------------------------------------------------------- type drift --------
  it("type drift: live status is integer -> warning + skip, drift=1, no throw", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      db.existingAttributes = [
        { key: "status", type: "integer", size: 0, required: true }, // drift!
        // createdAt absent -> created normally.
      ];

      const result = await provisionDatabase(client);

      expect(db.createStringAttributeCalls).toHaveLength(0); // skipped (drift)
      expect(db.createDatetimeAttributeCalls).toHaveLength(1); // created
      expect(result.attributes.drift).toBe(1);
      expect(result.attributes.created).toBe(1);
      expect(result.attributes.failed).toBe(0);

      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/drift/i);
    });
  });

  // -------------------------------------------------------- size drift --------
  it("size drift: live status size 100 vs declared 255 -> warning + skip, drift=1", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      db.existingAttributes = [
        { key: "status", type: "string", size: 100, required: true }, // size drift!
      ];

      const result = await provisionDatabase(client);

      expect(db.createStringAttributeCalls).toHaveLength(0);
      expect(result.attributes.drift).toBe(1);
      expect(result.attributes.failed).toBe(0);

      expect(logs.join("\n")).toMatch(/drift/i);
    });
  });

  // ----------------------------------------------- missing-size drift (C1) ----
  it("missing size drift: live string with size undefined vs declared 255 -> drift=1, warning logged", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      db.existingAttributes = [
        { key: "status", type: "string", size: undefined, required: true }, // missing size!
        // createdAt absent -> created normally.
      ];

      const result = await provisionDatabase(client);

      expect(db.createStringAttributeCalls).toHaveLength(0); // skipped (drift)
      expect(db.createDatetimeAttributeCalls).toHaveLength(1); // created
      expect(result.attributes.drift).toBe(1);
      expect(result.attributes.created).toBe(1);
      expect(result.attributes.failed).toBe(0);

      expect(logs.join("\n")).toMatch(/drift/i);
    });
  });

  // --------------------------------------------------- transient failure ------
  it("transient failure on createDatetimeAttribute (500) -> logged, continues, failed=1", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      db.existingAttributes = [];
      db.createDatetimeAttributeError = appwriteException("boom", 500, "server_error");

      const result = await provisionDatabase(client);

      expect(db.createStringAttributeCalls).toHaveLength(1); // succeeded
      expect(db.createDatetimeAttributeCalls).toHaveLength(1); // attempted
      expect(result.attributes.failed).toBe(1);
      expect(result.attributes.created).toBe(1);
      expect(result.attributes.drift).toBe(0);

      const allLogs = logs.join("\n");
      expect(allLogs).toMatch(/createdAt|datetime|attribute|error|fail/i);
    });
  });

  // ------------------------------------------------------ permissions ----------
  it("createCollection is called with server-only permissions (empty arrays, no role:users)", async () => {
    await withHealthCheckOnlyCollections(async () => {
      db.existingDatabases = [];
      db.existingCollections = [];
      db.existingAttributes = [];

      await provisionDatabase(client);

      const call = db.createCollectionCalls[0];
      expect(call).toBeDefined();
      const perms = call!.permissions ?? [];
      expect(perms).toEqual([]);
      const serialized = JSON.stringify(call);
      expect(serialized).not.toMatch(/role:users/);
    });
  });

  // ------------------------------------------------------- result shape --------
  it("ProvisionResult has the required shape", async () => {
    const result = await provisionDatabase(client);

    expect(result).toHaveProperty("databases");
    expect(result.databases).toHaveProperty("created");
    expect(result.databases).toHaveProperty("skipped");
    expect(result.databases).toHaveProperty("failed");
    expect(result).toHaveProperty("collections");
    expect(result.collections).toHaveProperty("created");
    expect(result.collections).toHaveProperty("skipped");
    expect(result.collections).toHaveProperty("failed");
    expect(result.collections).toHaveProperty("drift");
    expect(result).toHaveProperty("attributes");
    expect(result.attributes).toHaveProperty("created");
    expect(result.attributes).toHaveProperty("skipped");
    expect(result.attributes).toHaveProperty("failed");
    expect(result.attributes).toHaveProperty("drift");
    expect(result).toHaveProperty("buckets");
    expect(result.buckets).toHaveProperty("created");
    expect(result.buckets).toHaveProperty("skipped");
    expect(result.buckets).toHaveProperty("failed");
    // warnings is optional but, if present, must be a string array.
    if (result.warnings !== undefined) {
      expect(Array.isArray(result.warnings)).toBe(true);
      result.warnings.forEach((w) => expect(typeof w).toBe("string"));
    }
  });

  // ----------------------------------------------------------- buckets --------
  it("fresh provision: creates the run_checkpoints bucket", async () => {
    storage.existingBuckets = [];

    const result = await provisionDatabase(client);

    expect(result.buckets.created).toBe(1);
    expect(result.buckets.skipped).toBe(0);
    expect(result.buckets.failed).toBe(0);
    expect(storage.listBucketsCalls).toHaveLength(1);
    expect(storage.createBucketCalls).toHaveLength(1);
    expect(storage.createBucketCalls[0]).toMatchObject({
      bucketId: "run_checkpoints",
      name: "Run Checkpoints",
      permissions: [],
      fileSecurity: false,
      enabled: true,
      maximumFileSize: 30000000,
      allowedFileExtensions: ["json"],
    });
  });

  it("idempotent re-run: existing bucket is skipped", async () => {
    storage.existingBuckets = [{ $id: "run_checkpoints", name: "Run Checkpoints" }];

    const result = await provisionDatabase(client);

    expect(result.buckets.created).toBe(0);
    expect(result.buckets.skipped).toBe(1);
    expect(result.buckets.failed).toBe(0);
    expect(storage.createBucketCalls).toHaveLength(0);
  });

  it("409 race on bucket create: swallowed, skipped, no retry", async () => {
    storage.existingBuckets = []; // list says absent...
    storage.createBucketError = appwriteException("already exists", 409, "conflict");

    const result = await provisionDatabase(client);

    expect(storage.createBucketCalls).toHaveLength(1); // attempted once
    expect(result.buckets.created).toBe(0);
    expect(result.buckets.skipped).toBe(1);
    expect(result.buckets.failed).toBe(0);
  });

  // ------------------------------------------------------- no secrets ---------
  it("never leaks the API key or session secret in result or logs", async () => {
    // The client/fake carries a sentinel secret; ensure it never appears in output.
    (client as unknown as { apiKey: string }).apiKey = SECRET_API_KEY;
    (client as unknown as { secret: string }).secret = SECRET_API_KEY;

    const result = await provisionDatabase(client);

    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(SECRET_API_KEY);
    expect(logs.join("\n")).not.toContain(SECRET_API_KEY);
  });

  // ----------------------------------------- string default -> xdefault --------
  it("string attribute with default passes xdefault to createStringAttribute", async () => {
    await withHealthCheckOnlyCollections(async (collections) => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      const original = collections[0]!.attributes;
      collections[0]!.attributes = [
        { key: "greeting", type: "string", size: 64, required: false, default: "hello" },
      ];
      db.existingAttributes = [];
      try {
        await provisionDatabase(client);
        expect(db.createStringAttributeCalls).toHaveLength(1);
        expect(db.createStringAttributeCalls[0]).toMatchObject({
          databaseId: "newsletter_db",
          collectionId: "health_check",
          key: "greeting",
          size: 64,
          required: false,
          xdefault: "hello",
        });
      } finally {
        collections[0]!.attributes = original;
      }
    });
  });

  // -------------------------------------------------- number create -----------
  it("number attribute: createFloatAttribute receives correct params", async () => {
    await withHealthCheckOnlyCollections(async (collections) => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      const original = collections[0]!.attributes;
      collections[0]!.attributes = [{ key: "score", type: "number", required: false }];
      db.existingAttributes = [];
      try {
        await provisionDatabase(client);
        expect(db.createFloatAttributeCalls).toHaveLength(1);
        expect(db.createFloatAttributeCalls[0]).toMatchObject({
          databaseId: "newsletter_db",
          collectionId: "health_check",
          key: "score",
          required: false,
        });
        // xdefault must be absent (no default declared).
        expect(db.createFloatAttributeCalls[0]).not.toHaveProperty("xdefault");
      } finally {
        collections[0]!.attributes = original;
      }
    });
  });

  // ------------------------------------------------ boolean default=false -----
  it("boolean attribute with default false passes xdefault: false to createBooleanAttribute", async () => {
    await withHealthCheckOnlyCollections(async (collections) => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      const original = collections[0]!.attributes;
      collections[0]!.attributes = [
        { key: "active", type: "boolean", required: false, default: false },
      ];
      db.existingAttributes = [];
      try {
        await provisionDatabase(client);
        expect(db.createBooleanAttributeCalls).toHaveLength(1);
        expect(db.createBooleanAttributeCalls[0]).toMatchObject({
          databaseId: "newsletter_db",
          collectionId: "health_check",
          key: "active",
          required: false,
          xdefault: false,
        });
      } finally {
        collections[0]!.attributes = original;
      }
    });
  });

  // ------------------------- attributeMatches: number/boolean no false drift --
  it("attributeMatches: number/boolean with absent sizes match (no false drift); type mismatch still caught", () => {
    const numberDeclared = { key: "score", type: "number" as const, required: false };
    const booleanDeclared = { key: "active", type: "boolean" as const, required: false };

    // number vs number, sizes absent on both sides -> match.
    expect(attributeMatches(numberDeclared, { key: "score", type: "number" })).toBe(true);
    // number vs live "float" (Appwrite's internal type name) -> match (alias).
    expect(attributeMatches(numberDeclared, { key: "score", type: "float" })).toBe(true);
    // boolean vs boolean -> match.
    expect(attributeMatches(booleanDeclared, { key: "active", type: "boolean" })).toBe(true);

    // type mismatch: declared number, live string -> drift (false).
    expect(attributeMatches(numberDeclared, { key: "score", type: "string", size: 255 })).toBe(
      false,
    );
    // declared string vs live float -> drift (false) (alias only applies to number).
    expect(
      attributeMatches(
        { key: "name", type: "string", size: 255, required: false },
        { key: "name", type: "float" },
      ),
    ).toBe(false);
    // declared boolean, live number -> drift (false).
    expect(attributeMatches(booleanDeclared, { key: "active", type: "number" })).toBe(false);
  });

  // ------------------------------------------------------- array create -------
  it("array create: string attr with array:true passes array:true and omits xdefault", async () => {
    await withHealthCheckOnlyCollections(async (collections) => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      const original = collections[0]!.attributes;
      collections[0]!.attributes = [
        { key: "topics", type: "string", size: 128, required: false, array: true },
      ];
      db.existingAttributes = [];
      try {
        await provisionDatabase(client);
        expect(db.createStringAttributeCalls).toHaveLength(1);
        expect(db.createStringAttributeCalls[0]).toMatchObject({
          databaseId: "newsletter_db",
          collectionId: "health_check",
          key: "topics",
          size: 128,
          required: false,
          array: true,
        });
        expect(db.createStringAttributeCalls[0]).not.toHaveProperty("xdefault");
      } finally {
        collections[0]!.attributes = original;
      }
    });
  });

  // -------------------------------------------------------- array drift -------
  it("array drift: live array false/missing vs declared true -> drift warning, no create", async () => {
    await withHealthCheckOnlyCollections(async (collections) => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      const original = collections[0]!.attributes;
      collections[0]!.attributes = [
        { key: "topics", type: "string", size: 128, required: false, array: true },
      ];
      try {
        // Case A: live array explicitly false.
        db.existingAttributes = [
          { key: "topics", type: "string", size: 128, required: false, array: false },
        ];
        db.createStringAttributeCalls.length = 0;
        logs.length = 0;

        const resultFalse = await provisionDatabase(client);
        expect(db.createStringAttributeCalls).toHaveLength(0);
        expect(resultFalse.attributes.drift).toBeGreaterThanOrEqual(1);
        expect(logs.join("\n")).toMatch(/drift/i);

        // Case B: live array missing (treated as false).
        db.existingAttributes = [{ key: "topics", type: "string", size: 128, required: false }];
        db.createStringAttributeCalls.length = 0;
        logs.length = 0;
        // Reset counters by re-running; result is per-call.
        const resultMissing = await provisionDatabase(client);
        expect(db.createStringAttributeCalls).toHaveLength(0);
        expect(resultMissing.attributes.drift).toBeGreaterThanOrEqual(1);
        expect(logs.join("\n")).toMatch(/drift/i);
      } finally {
        collections[0]!.attributes = original;
      }
    });
  });

  // --------------------------------------------------- array match skip -------
  it("array match skip: live matches array:true -> skipped, not created", async () => {
    await withHealthCheckOnlyCollections(async (collections) => {
      db.existingDatabases = [{ $id: "newsletter_db", name: "Homepress" }];
      db.existingCollections = [{ $id: "health_check", name: "Health Check" }];
      const original = collections[0]!.attributes;
      collections[0]!.attributes = [
        { key: "topics", type: "string", size: 128, required: false, array: true },
      ];
      db.existingAttributes = [
        { key: "topics", type: "string", size: 128, required: false, array: true },
      ];
      try {
        const result = await provisionDatabase(client);
        expect(db.createStringAttributeCalls).toHaveLength(0);
        expect(result.attributes.skipped).toBeGreaterThanOrEqual(1);
        expect(result.attributes.created).toBe(0);
        expect(result.attributes.drift).toBe(0);
      } finally {
        collections[0]!.attributes = original;
      }
    });
  });
});
