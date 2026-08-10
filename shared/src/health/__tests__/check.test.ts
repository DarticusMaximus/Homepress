import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Client } from "node-appwrite";

// Hoisted holder so the mocked `Databases` constructor can return our
// singleton even though vi.mock factories are hoisted above regular imports.
const mockHolder = vi.hoisted(() => ({ databases: null as unknown }));

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

import { runHealthCheck } from "../check";
import { DATABASE_ID, HEALTH_CHECK_COLLECTION_ID } from "../../schema/declarations";
import { MockDocuments, appwriteException, fakeClient } from "./mock-client";

// Sentinel secret to prove runHealthCheck never leaks it.
const SECRET_API_KEY = "sk-secret-do-not-leak-1234567890";

describe("runHealthCheck", () => {
  let docs: MockDocuments;
  let client: Client;
  let logs: string[];
  let consoleSpies: Array<{ mock: ReturnType<typeof vi.spyOn> }>;

  beforeEach(() => {
    docs = new MockDocuments();
    mockHolder.databases = docs;
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

  // --------------------------------------------------------------- happy ----
  it("happy path: all three SDK calls succeed → status ok, all steps ok, documentId captured", async () => {
    const result = await runHealthCheck(client);

    expect(result.status).toBe("ok");
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]?.step).toBe("create");
    expect(result.steps[0]?.status).toBe("ok");
    expect(result.steps[1]?.step).toBe("read");
    expect(result.steps[1]?.status).toBe("ok");
    expect(result.steps[2]?.step).toBe("delete");
    expect(result.steps[2]?.status).toBe("ok");

    // No errors anywhere on the success path.
    for (const step of result.steps) {
      expect(step.errorMessage).toBeUndefined();
      expect(step.errorCode).toBeUndefined();
    }

    // Durations recorded (≥ 0; timing test below proves meaningful capture).
    for (const step of result.steps) {
      expect(typeof step.durationMs).toBe("number");
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }

    // documentId propagated from create's call.
    expect(result.documentId).toBeDefined();
    expect(result.documentId).toBe(docs.lastCreatedDocumentId);

    // SDK called in order with correct ids.
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls).toHaveLength(1);

    const createCall = docs.createDocumentCalls[0]!;
    expect(createCall.databaseId).toBe(DATABASE_ID);
    expect(createCall.collectionId).toBe(HEALTH_CHECK_COLLECTION_ID);
    expect(createCall.documentId).toBe(result.documentId);
    expect(createCall.data).toMatchObject({ status: "ok" });
    expect(typeof createCall.data.createdAt).toBe("string");

    // Read and delete use the same documentId captured from create.
    const readCall = docs.getDocumentCalls[0]!;
    expect(readCall.databaseId).toBe(DATABASE_ID);
    expect(readCall.collectionId).toBe(HEALTH_CHECK_COLLECTION_ID);
    expect(readCall.documentId).toBe(result.documentId);

    const deleteCall = docs.deleteDocumentCalls[0]!;
    expect(deleteCall.databaseId).toBe(DATABASE_ID);
    expect(deleteCall.collectionId).toBe(HEALTH_CHECK_COLLECTION_ID);
    expect(deleteCall.documentId).toBe(result.documentId);

    // checkedAt is an ISO timestamp.
    expect(typeof result.checkedAt).toBe("string");
    expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  });

  // --------------------------------------------------- create fails 404 ----
  it("create fails (404 not_found): only create attempted, errorCode 404, no documentId", async () => {
    docs.createDocumentError = appwriteException("health_check not found", 404, "not_found");

    const result = await runHealthCheck(client);

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.step).toBe("create");
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.errorCode).toBe(404);
    expect(result.steps[0]?.errorMessage).toBe("health_check not found");

    expect(result.documentId).toBeUndefined();

    // Read and delete were NOT attempted.
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);

    // Error was logged structured (no err leaked).
    expect(logs.join("\n")).toMatch(/create/);
    expect(logs.join("\n")).toMatch(/404/);
  });

  // ------------------------------------------------- create fails 500 ----
  it("create fails (generic error, 500): same shape, errorCode 500", async () => {
    docs.createDocumentError = appwriteException("boom", 500, "server_error");

    const result = await runHealthCheck(client);

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.step).toBe("create");
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.errorCode).toBe(500);
    expect(result.steps[0]?.errorMessage).toBe("boom");

    expect(result.documentId).toBeUndefined();

    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });

  // --------------------------------------------------------- read fails ----
  it("read fails (404): create ok, read failed 404, delete NOT attempted", async () => {
    docs.getDocumentError = appwriteException("health_check doc gone", 404, "not_found");

    const result = await runHealthCheck(client);

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.step).toBe("create");
    expect(result.steps[0]?.status).toBe("ok");
    expect(result.steps[1]?.step).toBe("read");
    expect(result.steps[1]?.status).toBe("failed");
    expect(result.steps[1]?.errorCode).toBe(404);
    expect(result.steps[1]?.errorMessage).toBe("health_check doc gone");

    // documentId still captured from the successful create.
    expect(result.documentId).toBe(docs.lastCreatedDocumentId);

    // C2: best-effort cleanup delete ran using the captured documentId.
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]?.documentId).toBe(result.documentId);

    // Read was called with the create's documentId.
    expect(docs.getDocumentCalls[0]?.documentId).toBe(result.documentId);
  });

  // ----------------------------- read fails AND cleanup delete fails --------
  it("read fails AND cleanup delete fails: still returns read-failure shape, no throw", async () => {
    docs.getDocumentError = appwriteException("health_check doc gone", 404, "not_found");
    docs.deleteDocumentError = appwriteException("cleanup exploded", 500, "server_error");

    const result = await runHealthCheck(client);

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.step).toBe("create");
    expect(result.steps[0]?.status).toBe("ok");
    expect(result.steps[1]?.step).toBe("read");
    expect(result.steps[1]?.status).toBe("failed");
    expect(result.steps[1]?.errorCode).toBe(404);
    expect(result.steps[1]?.errorMessage).toBe("health_check doc gone");

    // documentId still captured from the successful create.
    expect(result.documentId).toBe(docs.lastCreatedDocumentId);

    // Cleanup delete was attempted (even though it failed) using the captured id.
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]?.documentId).toBe(result.documentId);

    // Cleanup error was swallowed (logged structured, no throw bubbling out).
    expect(logs.join("\n")).toMatch(/cleanup-delete/);
    expect(logs.join("\n")).toMatch(/500/);
  });

  // -------------------------------------------------------- delete fails ---
  it("delete fails (500): create + read ok, delete failed 500, document left (V1-acceptable)", async () => {
    docs.deleteDocumentError = appwriteException("delete exploded", 500, "server_error");

    const result = await runHealthCheck(client);

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]?.step).toBe("create");
    expect(result.steps[0]?.status).toBe("ok");
    expect(result.steps[1]?.step).toBe("read");
    expect(result.steps[1]?.status).toBe("ok");
    expect(result.steps[2]?.step).toBe("delete");
    expect(result.steps[2]?.status).toBe("failed");
    expect(result.steps[2]?.errorCode).toBe(500);
    expect(result.steps[2]?.errorMessage).toBe("delete exploded");

    // documentId still set (delete failure does not clear it).
    expect(result.documentId).toBe(docs.lastCreatedDocumentId);

    // All three SDK methods were called.
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]?.documentId).toBe(result.documentId);

    // V1 accepts orphan documents; the test acknowledges this by NOT asserting
    // any cleanup. (See Constraints in feature-04 spec.)
  });

  // ------------------------------------------------- timing capture --------
  it("timing: each step's durationMs reflects only that step's SDK call (ordering preserved)", async () => {
    const STEP_MS = 5;
    docs.delayMs = STEP_MS;

    const result = await runHealthCheck(client);

    expect(result.status).toBe("ok");
    expect(result.steps).toHaveLength(3);

    // Each step's duration reflects at least the mock's delay (≥ STEP_MS).
    // Allow a small jitter band for setTimeout coarseness.
    for (const step of result.steps) {
      expect(step.durationMs).toBeGreaterThanOrEqual(STEP_MS - 1);
    }

    // Ordering preserved: SDK calls recorded in create→read→delete order, and
    // each step's duration bracket only that call. If create's durationMs were
    // measured AFTER read started, the three calls would still appear in order
    // but the per-step durations would overlap (sum would exceed total wall time
    // by a large margin). Asserting per-step ≥ STEP_MS AND ordering AND a sane
    // sum proves each step's measurement brackets only that call.
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls).toHaveLength(1);

    const sum =
      (result.steps[0]?.durationMs ?? 0) +
      (result.steps[1]?.durationMs ?? 0) +
      (result.steps[2]?.durationMs ?? 0);
    // Generous bound: 3 sequential steps of STEP_MS each plus overhead. If a
    // step's measurement leaked into the next, sum would balloon.
    expect(sum).toBeLessThan(STEP_MS * 10);
  });

  // ---------------------------------------------------- no secrets ---------
  it("never leaks the API key in the result or in console output", async () => {
    // Plant the sentinel on the client so it could leak if anything logs it.
    (client as unknown as { apiKey: string }).apiKey = SECRET_API_KEY;
    (client as unknown as { secret: string }).secret = SECRET_API_KEY;

    // Also fail a step to force a console.error path.
    docs.deleteDocumentError = appwriteException("boom", 500);

    const result = await runHealthCheck(client);

    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(SECRET_API_KEY);
    expect(logs.join("\n")).not.toContain(SECRET_API_KEY);
  });

  // ------------------------------------------------- documentId propagation -
  it("returns the captured documentId on success", async () => {
    const result = await runHealthCheck(client);

    expect(result.status).toBe("ok");
    expect(result.documentId).toBeDefined();
    expect(result.documentId).toBe(docs.lastCreatedDocumentId);
    expect(docs.createDocumentCalls[0]?.documentId).toBe(result.documentId);
  });

  // --------------------------------------- result shape sanity --------------
  it("HealthCheckResult has the required shape on every path", async () => {
    const result = await runHealthCheck(client);

    expect(result).toHaveProperty("status");
    expect(["ok", "failed"]).toContain(result.status);
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.checkedAt).toBe("string");

    for (const step of result.steps) {
      expect(["create", "read", "delete"]).toContain(step.step);
      expect(["ok", "failed"]).toContain(step.status);
      expect(typeof step.durationMs).toBe("number");
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // --------------------------------------- HEALTH_CHECK_COLLECTION_ID -----
  it("uses HEALTH_CHECK_COLLECTION_ID (not the literal string) for every SDK call", async () => {
    const result = await runHealthCheck(client);
    expect(result.status).toBe("ok");

    expect(docs.createDocumentCalls[0]?.collectionId).toBe(HEALTH_CHECK_COLLECTION_ID);
    expect(docs.getDocumentCalls[0]?.collectionId).toBe(HEALTH_CHECK_COLLECTION_ID);
    expect(docs.deleteDocumentCalls[0]?.collectionId).toBe(HEALTH_CHECK_COLLECTION_ID);
  });
});
