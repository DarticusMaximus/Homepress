import { vi, describe, it, expect, beforeEach } from "vitest";
import { Query } from "node-appwrite";
import type { Client } from "node-appwrite";

const mockHolder = vi.hoisted(() => ({
  databases: null as unknown,
  storage: null as unknown,
  uniqueId: "run-doc-unique-id",
}));

vi.mock("node-appwrite", async (importActual) => {
  const actual = await importActual<typeof import("node-appwrite")>();
  return {
    ...actual,
    ID: {
      ...actual.ID,
      unique: () => mockHolder.uniqueId,
    },
    Databases: class MockDatabasesConstructor {
      constructor() {
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

import {
  DATABASE_ID,
  RUNS_COLLECTION_ID,
  RUN_CHECKPOINTS_BUCKET_ID,
} from "../../schema/declarations";
import {
  createRun,
  getRun,
  markRunning,
  markFailed,
  markCompleted,
  requeueFailedRun,
  savePhaseCheckpoint,
  loadPhaseCheckpoint,
  loadPhaseCheckpointFromRun,
  listActiveRunsForNewsletter,
  findActiveRunForNewsletter,
  listPendingRuns,
  listRuns,
  deleteRun,
  listAllRuns,
} from "../repository";
import { RunRepositoryError, type Run } from "../types";
import {
  MockRunsDatabases,
  MockStorage,
  appwriteException,
  fakeClient,
  mockRunDocument,
} from "./mock-client";

const SECRET_API_KEY = "sk-secret-do-not-leak-1234567890";

function expectRepoError(
  promise: Promise<unknown>,
  code: RunRepositoryError["code"],
): Promise<RunRepositoryError> {
  return promise.then(
    () => {
      throw new Error(`Expected RunRepositoryError with code ${code}`);
    },
    (err) => {
      expect(err).toBeInstanceOf(RunRepositoryError);
      const repoErr = err as RunRepositoryError;
      expect(repoErr.code).toBe(code);
      return repoErr;
    },
  );
}

describe("createRun", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    mockHolder.uniqueId = "run-doc-unique-id";
    client = fakeClient();
  });

  it("creates a document with status pending, startedAt set, and no checkpoint ids", async () => {
    const before = Date.now();
    const run = await createRun(client, {
      newsletterId: "nl-1",
      newsletterName: "Weekly Tech",
    });
    const after = Date.now();

    expect(docs.createDocumentCalls).toHaveLength(1);
    const call = docs.createDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(RUNS_COLLECTION_ID);
    expect(call.documentId).toBe("run-doc-unique-id");
    expect(call.data).toMatchObject({
      newsletterId: "nl-1",
      newsletterName: "Weekly Tech",
      status: "pending",
      currentPhase: "",
      completedPhase: "",
      failedPhase: "",
      failureMessage: "",
      topicSummary: "",
      failedFeeds: "",
      checkpointFetchId: "",
      checkpointScrapeId: "",
      checkpointTagId: "",
      checkpointScoreId: "",
      checkpointSelectionId: "",
      checkpointDraftId: "",
    });
    expect(call.data.endedAt).toBeNull();

    const startedAt = new Date(String(call.data.startedAt)).getTime();
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);

    expect(run.$id).toBe("run-doc-unique-id");
    expect(run.status).toBe("pending");
    expect(run.newsletterId).toBe("nl-1");
    expect(run.newsletterName).toBe("Weekly Tech");
    expect(run.currentPhase).toBe("");
    expect(run.completedPhase).toBe("");
    expect(run.endedAt).toBeNull();
    expect(run.checkpointFetchId).toBe("");
  });

  // Feature 06 Task 1 case 3 — omit trigger → persisted/returned "manual".
  it("defaults omitted trigger to manual on create", async () => {
    const run = await createRun(client, {
      newsletterId: "nl-1",
      newsletterName: "Weekly Tech",
    });

    const call = docs.createDocumentCalls[0]!;
    expect(call.data.trigger).toBe("manual");
    expect(run).toMatchObject({ trigger: "manual" });
  });

  // Feature 06 Task 1 case 3 — explicit scheduled.
  it("persists trigger scheduled when provided on create", async () => {
    const run = await createRun(client, {
      newsletterId: "nl-1",
      newsletterName: "Weekly Tech",
      trigger: "scheduled",
    });

    const call = docs.createDocumentCalls[0]!;
    expect(call.data.trigger).toBe("scheduled");
    expect(run).toMatchObject({ trigger: "scheduled" });
  });

  // Stage 09 Feature 06 Task 1 case 3 — delivery visibility defaults on create.
  it("persists delivery visibility defaults on create", async () => {
    const run = await createRun(client, {
      newsletterId: "nl-1",
      newsletterName: "Weekly Tech",
    });

    const call = docs.createDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      emailDeliveryStatus: "none",
      emailDeliveryAt: null,
      emailDeliveryError: "",
      rssDeliveryStatus: "none",
      rssDeliveryAt: null,
      rssDeliveryError: "",
    });
    expect(run).toMatchObject({
      emailDeliveryStatus: "none",
      emailDeliveryAt: null,
      emailDeliveryError: "",
      rssDeliveryStatus: "none",
      rssDeliveryAt: null,
      rssDeliveryError: "",
    });
  });
});

describe("getRun", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const runId = "run-to-get";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns the run with correct field mapping", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        newsletterId: "nl-2",
        newsletterName: "AI Weekly",
        status: "running",
        currentPhase: "scrape",
        completedPhase: "fetch",
        startedAt: "2026-01-01T00:00:00.000Z",
        checkpointFetchId: "file-abc",
      });

    const run = await getRun(client, runId);

    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.getDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
    });
    expect(run).toMatchObject({
      $id: runId,
      newsletterId: "nl-2",
      newsletterName: "AI Weekly",
      status: "running",
      currentPhase: "scrape",
      completedPhase: "fetch",
      startedAt: "2026-01-01T00:00:00.000Z",
      checkpointFetchId: "file-abc",
    });
  });

  // Feature 06 Task 1 case 2 — coerce missing / null / empty / unknown → manual.
  it("coerces missing, null, empty, and unknown trigger to manual on read", async () => {
    const cases: Array<{ label: string; trigger?: string | null }> = [
      { label: "missing" },
      { label: "null", trigger: null },
      { label: "empty", trigger: "" },
      { label: "bogus", trigger: "bogus" },
    ];

    for (const c of cases) {
      docs.getDocumentCalls.length = 0;
      docs.getDocumentImpl = () => {
        const doc = mockRunDocument({ $id: `${runId}-${c.label}` });
        if (!("trigger" in c)) {
          delete (doc as Record<string, unknown>).trigger;
        } else {
          (doc as Record<string, unknown>).trigger = c.trigger;
        }
        return doc;
      };

      const run = await getRun(client, `${runId}-${c.label}`);
      expect(run, c.label).toMatchObject({ trigger: "manual" });
    }
  });

  // Feature 06 Task 1 case 2 — scheduled preserved.
  it("preserves trigger scheduled on read", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        trigger: "scheduled",
      } as Parameters<typeof mockRunDocument>[0]);

    const run = await getRun(client, runId);
    expect(run).toMatchObject({ trigger: "scheduled" });
  });

  // Stage 09 Feature 06 Task 1 case 2 — delivery visibility coercion on read.
  it("coerces missing/unknown delivery status to none, missing error to empty, missing at to null", async () => {
    docs.getDocumentImpl = () => {
      const doc = mockRunDocument({ $id: runId });
      delete (doc as Record<string, unknown>).emailDeliveryStatus;
      delete (doc as Record<string, unknown>).emailDeliveryAt;
      delete (doc as Record<string, unknown>).emailDeliveryError;
      delete (doc as Record<string, unknown>).rssDeliveryStatus;
      delete (doc as Record<string, unknown>).rssDeliveryAt;
      delete (doc as Record<string, unknown>).rssDeliveryError;
      return doc;
    };

    const missing = await getRun(client, runId);
    expect(missing).toMatchObject({
      emailDeliveryStatus: "none",
      emailDeliveryAt: null,
      emailDeliveryError: "",
      rssDeliveryStatus: "none",
      rssDeliveryAt: null,
      rssDeliveryError: "",
    });

    docs.getDocumentCalls.length = 0;
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        emailDeliveryStatus: "bogus",
        emailDeliveryAt: undefined,
        emailDeliveryError: undefined,
        rssDeliveryStatus: "not-a-status",
        rssDeliveryAt: undefined,
        rssDeliveryError: undefined,
      } as Parameters<typeof mockRunDocument>[0]);

    const unknown = await getRun(client, runId);
    expect(unknown).toMatchObject({
      emailDeliveryStatus: "none",
      emailDeliveryAt: null,
      emailDeliveryError: "",
      rssDeliveryStatus: "none",
      rssDeliveryAt: null,
      rssDeliveryError: "",
    });
  });

  // Stage 09 Feature 06 Task 1 case 2 — known delivery statuses preserved.
  it("preserves known delivery statuses, timestamps, and errors on read", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        emailDeliveryStatus: "sent",
        emailDeliveryAt: "2026-07-01T12:00:00.000Z",
        emailDeliveryError: "",
        rssDeliveryStatus: "failed",
        rssDeliveryAt: "2026-07-01T13:00:00.000Z",
        rssDeliveryError: "RSS write failed",
      } as Parameters<typeof mockRunDocument>[0]);

    const run = await getRun(client, runId);
    expect(run).toMatchObject({
      emailDeliveryStatus: "sent",
      emailDeliveryAt: "2026-07-01T12:00:00.000Z",
      emailDeliveryError: "",
      rssDeliveryStatus: "failed",
      rssDeliveryAt: "2026-07-01T13:00:00.000Z",
      rssDeliveryError: "RSS write failed",
    });
  });

  it("throws not_found when the document is missing (404)", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(getRun(client, runId), "not_found");
    expect(err.message).toBe("Run not found");
  });

  it("wraps other Appwrite errors as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.getDocumentError = appwriteException(
      `Request failed with key ${SECRET_API_KEY}`,
      500,
      "general_unknown",
    );

    const err = await expectRepoError(getRun(client, runId), "appwrite");
    expect(err.message).not.toContain(SECRET_API_KEY);
    expect(err.message.length).toBeGreaterThan(0);

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0]![0] as {
      phase: string;
      code: unknown;
      message: string;
    };
    expect(logged.phase).toBe("get-run");
    expect(logged.code).toBe(500);
    expect(logged.message).not.toContain(SECRET_API_KEY);
    expect(logged.message).not.toContain("sk-");
    spy.mockRestore();
  });
});

describe("markRunning", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const runId = "run-to-run";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("sets status running and currentPhase, clears failure fields and endedAt", async () => {
    const run = await markRunning(client, runId, "fetch");

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.documentId).toBe(runId);
    expect(call.collectionId).toBe(RUNS_COLLECTION_ID);
    expect(call.data).toMatchObject({
      status: "running",
      currentPhase: "fetch",
      failedPhase: "",
      failureMessage: "",
    });
    expect(call.data.endedAt).toBeNull();

    expect(run.status).toBe("running");
    expect(run.currentPhase).toBe("fetch");
    expect(run.failedPhase).toBe("");
    expect(run.failureMessage).toBe("");
    expect(run.endedAt).toBeNull();
  });

  it("throws not_found when the run does not exist (404)", async () => {
    docs.updateDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(markRunning(client, runId, "fetch"), "not_found");
    expect(err.message).toBe("Run not found");
  });
});

describe("markFailed", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const runId = "run-to-fail";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("sets status failed, failedPhase, and endedAt", async () => {
    const before = Date.now();
    const run = await markFailed(client, runId, {
      failedPhase: "scrape",
      failureMessage: "Connection timed out",
    });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.documentId).toBe(runId);
    expect(call.data).toMatchObject({
      status: "failed",
      failedPhase: "scrape",
      failureMessage: "Connection timed out",
    });

    const endedAt = new Date(String(call.data.endedAt)).getTime();
    expect(endedAt).toBeGreaterThanOrEqual(before);
    expect(endedAt).toBeLessThanOrEqual(after);

    expect(run.status).toBe("failed");
    expect(run.failedPhase).toBe("scrape");
    expect(run.failureMessage).toBe("Connection timed out");
  });

  it("truncates failureMessage to 2000 chars when longer", async () => {
    const longMessage = "x".repeat(2500);
    await markFailed(client, runId, {
      failedPhase: "draft",
      failureMessage: longMessage,
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(typeof call.data.failureMessage).toBe("string");
    expect(String(call.data.failureMessage).length).toBe(2000);
  });

  it("preserves a short failureMessage verbatim", async () => {
    await markFailed(client, runId, {
      failedPhase: "tag",
      failureMessage: "short error",
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.failureMessage).toBe("short error");
  });

  it("includes completedPhase in the update when provided (C5)", async () => {
    await markFailed(client, runId, {
      failedPhase: "selection",
      failureMessage: "could not finalize",
      completedPhase: "selection",
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      status: "failed",
      failedPhase: "selection",
      failureMessage: "could not finalize",
      completedPhase: "selection",
    });
  });

  it("does NOT include completedPhase when not provided", async () => {
    await markFailed(client, runId, {
      failedPhase: "tag",
      failureMessage: "halted",
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).not.toHaveProperty("completedPhase");
  });

  it("persists failedFeeds as JSON when provided", async () => {
    const failedFeeds = [
      {
        feedUrl: "https://feed.example/a",
        errorType: "HttpError" as const,
        errorMessage: "404 Not Found",
        statusCode: 404,
      },
      {
        feedUrl: "https://feed.example/b",
        errorType: "NetworkError" as const,
        errorMessage: "connection reset",
      },
    ];
    const run = await markFailed(client, runId, {
      failedPhase: "fetch",
      failureMessage: "All feeds failed",
      failedFeeds,
    });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.failedFeeds).toBe(JSON.stringify(failedFeeds));

    expect(run.failedFeeds).toBe(JSON.stringify(failedFeeds));
    expect(run.failedFeeds.length).toBeGreaterThan(0);
  });

  it("does NOT include failedFeeds in update payload when omitted", async () => {
    await markFailed(client, runId, {
      failedPhase: "fetch",
      failureMessage: "All feeds failed",
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).not.toHaveProperty("failedFeeds");
  });

  it("truncates failureMessage but NOT failedFeeds when both are large", async () => {
    const longMessage = "x".repeat(2500);
    const failedFeeds = [
      {
        feedUrl: "https://feed.example/a",
        errorType: "HttpError" as const,
        errorMessage: "404 Not Found",
        statusCode: 404,
      },
      {
        feedUrl: "https://feed.example/b",
        errorType: "NetworkError" as const,
        errorMessage: "connection reset",
      },
    ];
    await markFailed(client, runId, {
      failedPhase: "fetch",
      failureMessage: longMessage,
      failedFeeds,
    });

    const call = docs.updateDocumentCalls[0]!;
    expect(typeof call.data.failureMessage).toBe("string");
    expect(String(call.data.failureMessage).length).toBe(2000);
    expect(call.data.failedFeeds).toBe(JSON.stringify(failedFeeds));
  });
});

describe("requeueFailedRun", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const runId = "run-to-requeue";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("flips a failed run to pending, clearing failure/phase/endedAt fields and preserving checkpoints", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        status: "failed",
        failedPhase: "scrape",
        failureMessage: "Connection timed out",
        completedPhase: "fetch",
        currentPhase: "scrape",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
        failedFeeds: '[{"feedUrl":"https://x","errorType":"timeout","errorMessage":"t"}]',
        topicSummary: '[{"title":"X","tags":["a"]}]',
        checkpointFetchId: "fetch-file-1",
        checkpointScrapeId: "",
        checkpointTagId: "",
        checkpointScoreId: "",
        checkpointSelectionId: "",
        checkpointDraftId: "",
      });

    const run = await requeueFailedRun(client, runId);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.documentId).toBe(runId);
    expect(call.data).toMatchObject({
      status: "pending",
      failedPhase: "",
      failureMessage: "",
      currentPhase: "",
    });
    expect(call.data.endedAt).toBeNull();

    // Preserved fields must NOT be in the update payload
    expect(call.data).not.toHaveProperty("completedPhase");
    expect(call.data).not.toHaveProperty("checkpointFetchId");
    expect(call.data).not.toHaveProperty("checkpointScrapeId");
    expect(call.data).not.toHaveProperty("checkpointTagId");
    expect(call.data).not.toHaveProperty("checkpointScoreId");
    expect(call.data).not.toHaveProperty("checkpointSelectionId");
    expect(call.data).not.toHaveProperty("checkpointDraftId");
    expect(call.data).not.toHaveProperty("newsletterId");
    expect(call.data).not.toHaveProperty("newsletterName");
    expect(call.data).not.toHaveProperty("startedAt");
    expect(call.data).not.toHaveProperty("failedFeeds");
    expect(call.data).not.toHaveProperty("topicSummary");

    expect(run.status).toBe("pending");
  });

  // Feature 06 Task 1 cases 4 + 9 — requeue forces trigger manual even if was scheduled.
  it("sets trigger to manual on requeue even when the document was scheduled", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        status: "failed",
        failedPhase: "scrape",
        failureMessage: "boom",
        completedPhase: "fetch",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T01:00:00.000Z",
        trigger: "scheduled",
      } as Parameters<typeof mockRunDocument>[0]);

    const run = await requeueFailedRun(client, runId);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data).toMatchObject({
      status: "pending",
      trigger: "manual",
    });
    expect(run).toMatchObject({ trigger: "manual" });
  });

  it("throws validation error when the run is not in failed status", async () => {
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, status: "completed" });

    const err = await expectRepoError(requeueFailedRun(client, runId), "validation");
    expect(err.message).toContain("completed");
    // Must not have attempted an update
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("throws not_found when the run does not exist", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(requeueFailedRun(client, runId), "not_found");
    expect(err.message).toBe("Run not found");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });
});

describe("markCompleted", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const runId = "run-to-complete";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("sets status completed, endedAt, topicSummary as JSON, and clears failure fields", async () => {
    const before = Date.now();
    const topicSummary = [
      { title: "AI breakthrough", tags: ["ai", "research"] },
      { title: "Market update", tags: ["finance"] },
    ];
    const run = await markCompleted(client, runId, { topicSummary });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.documentId).toBe(runId);
    expect(call.data).toMatchObject({
      status: "completed",
      failedPhase: "",
      failureMessage: "",
    });
    expect(call.data.topicSummary).toBe(JSON.stringify(topicSummary));

    const endedAt = new Date(String(call.data.endedAt)).getTime();
    expect(endedAt).toBeGreaterThanOrEqual(before);
    expect(endedAt).toBeLessThanOrEqual(after);

    expect(run.status).toBe("completed");
    expect(run.topicSummary).toBe(JSON.stringify(topicSummary));
    expect(run.failedPhase).toBe("");
    expect(run.failureMessage).toBe("");
  });

  it("serializes an empty topicSummary array", async () => {
    await markCompleted(client, runId, { topicSummary: [] });

    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.topicSummary).toBe("[]");
  });

  it("rejects a non-array topicSummary with validation error", async () => {
    const err = await expectRepoError(
      markCompleted(client, runId, {
        topicSummary: "not-an-array" as unknown as { title: string; tags: string[] }[],
      }),
      "validation",
    );
    expect(err.message).toContain("array");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a topicSummary item without a string title", async () => {
    const err = await expectRepoError(
      markCompleted(client, runId, {
        topicSummary: [{ tags: ["x"] }] as unknown as {
          title: string;
          tags: string[];
        }[],
      }),
      "validation",
    );
    expect(err.message).toContain("title");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a topicSummary item with non-string tags", async () => {
    const err = await expectRepoError(
      markCompleted(client, runId, {
        topicSummary: [{ title: "Ok", tags: [123] }] as unknown as {
          title: string;
          tags: string[];
        }[],
      }),
      "validation",
    );
    expect(err.message).toContain("tags");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("rejects a topicSummary item where tags is not an array", async () => {
    const err = await expectRepoError(
      markCompleted(client, runId, {
        topicSummary: [{ title: "Ok", tags: "not-array" }] as unknown as {
          title: string;
          tags: string[];
        }[],
      }),
      "validation",
    );
    expect(err.message).toContain("tags");
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });
});

describe("documentToRun mapping", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const runId = "run-mapping";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("maps absent optional fields to empty string and null datetime", async () => {
    const now = new Date().toISOString();
    docs.getDocumentImpl = () =>
      ({
        ...mockRunDocument({ $id: runId }),
        // Simulate Appwrite returning a doc with some optional fields absent
        currentPhase: undefined,
        completedPhase: undefined,
        failedPhase: undefined,
        failureMessage: undefined,
        endedAt: undefined,
        topicSummary: undefined,
        failedFeeds: undefined,
        checkpointFetchId: undefined,
        checkpointScrapeId: undefined,
        checkpointTagId: undefined,
        checkpointScoreId: undefined,
        checkpointSelectionId: undefined,
        checkpointDraftId: undefined,
        startedAt: now,
      }) as never;

    const run = await getRun(client, runId);

    expect(run.currentPhase).toBe("");
    expect(run.completedPhase).toBe("");
    expect(run.failedPhase).toBe("");
    expect(run.failureMessage).toBe("");
    expect(run.endedAt).toBeNull();
    expect(run.topicSummary).toBe("");
    expect(run.failedFeeds).toBe("");
    expect(run.checkpointFetchId).toBe("");
    expect(run.checkpointScrapeId).toBe("");
    expect(run.checkpointTagId).toBe("");
    expect(run.checkpointScoreId).toBe("");
    expect(run.checkpointSelectionId).toBe("");
    expect(run.checkpointDraftId).toBe("");
    expect(run.startedAt).toBe(now);
  });

  it("maps null optional fields to empty string and null datetime", async () => {
    const now = new Date().toISOString();
    docs.getDocumentImpl = () =>
      ({
        ...mockRunDocument({ $id: runId }),
        currentPhase: null,
        completedPhase: null,
        failedPhase: null,
        failureMessage: null,
        endedAt: null,
        topicSummary: null,
        failedFeeds: null,
        checkpointFetchId: null,
        checkpointScrapeId: null,
        checkpointTagId: null,
        checkpointScoreId: null,
        checkpointSelectionId: null,
        checkpointDraftId: null,
        startedAt: now,
      }) as never;

    const run = await getRun(client, runId);

    expect(run.currentPhase).toBe("");
    expect(run.completedPhase).toBe("");
    expect(run.failedPhase).toBe("");
    expect(run.failureMessage).toBe("");
    expect(run.endedAt).toBeNull();
    expect(run.topicSummary).toBe("");
    expect(run.failedFeeds).toBe("");
    expect(run.checkpointFetchId).toBe("");
  });

  it("maps set checkpoint ids and completedPhase correctly", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        status: "completed",
        completedPhase: "draft",
        endedAt: "2026-06-01T12:00:00.000Z",
        checkpointFetchId: "fetch-001",
        checkpointScrapeId: "scrape-001",
        checkpointTagId: "tag-001",
        checkpointScoreId: "score-001",
        checkpointSelectionId: "sel-001",
        checkpointDraftId: "draft-001",
        topicSummary: '[{"title":"X","tags":["a"]}]',
      });

    const run = await getRun(client, runId);

    expect(run.status).toBe("completed");
    expect(run.completedPhase).toBe("draft");
    expect(run.endedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(run.checkpointFetchId).toBe("fetch-001");
    expect(run.checkpointScrapeId).toBe("scrape-001");
    expect(run.checkpointTagId).toBe("tag-001");
    expect(run.checkpointScoreId).toBe("score-001");
    expect(run.checkpointSelectionId).toBe("sel-001");
    expect(run.checkpointDraftId).toBe("draft-001");
    expect(run.topicSummary).toBe('[{"title":"X","tags":["a"]}]');
  });
});

// ---------------------------------------------------------------------------
// savePhaseCheckpoint / loadPhaseCheckpoint (happy path)
// ---------------------------------------------------------------------------

const ISO_DATE = "2024-01-15T10:30:00Z";
const ISO_DATE_2 = "2024-02-20T08:00:00Z";

function baseArticle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Some headline",
    link: "https://example.com/a",
    published: ISO_DATE,
    content: "Body text",
    source: "example.com",
    ...overrides,
  };
}

describe("savePhaseCheckpoint / loadPhaseCheckpoint", () => {
  let docs: MockRunsDatabases;
  let storage: MockStorage;
  let client: Client;
  const runId = "run-chk";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    storage = new MockStorage();
    mockHolder.databases = docs;
    mockHolder.storage = storage;
    mockHolder.uniqueId = "file-unique-id";
    client = fakeClient();
  });

  // ---- fetch ----
  it("fetch: round-trips articles, sets checkpointFetchId + completedPhase, persists failedFeeds", async () => {
    const failedFeeds = [
      { feedUrl: "https://feed.example/x", errorType: "timeout", errorMessage: "timed out" },
    ];
    const run = await savePhaseCheckpoint(
      client,
      runId,
      "fetch",
      {
        articles: [
          baseArticle(),
          baseArticle({ link: "https://example.com/b", published: ISO_DATE_2 }),
        ],
      },
      { failedFeeds },
    );

    expect(storage.createFileCalls).toHaveLength(1);
    const createCall = storage.createFileCalls[0]!;
    expect(createCall.bucketId).toBe(RUN_CHECKPOINTS_BUCKET_ID);
    expect(createCall.fileId).toBe("file-unique-id");
    expect(createCall.file.filename).toBe("run-chk-fetch.json");

    expect(storage.files.get("file-unique-id")!.content).toBe(
      JSON.stringify({
        articles: [
          baseArticle(),
          baseArticle({ link: "https://example.com/b", published: ISO_DATE_2 }),
        ],
      }),
    );

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const updateCall = docs.updateDocumentCalls[0]!;
    expect(updateCall.documentId).toBe(runId);
    expect(updateCall.data).toMatchObject({
      checkpointFetchId: "file-unique-id",
      completedPhase: "fetch",
      failedFeeds: JSON.stringify(failedFeeds),
    });

    expect(run.checkpointFetchId).toBe("file-unique-id");
    expect(run.completedPhase).toBe("fetch");

    // load back: documents the run has the checkpoint id stored
    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointFetchId: "file-unique-id" });

    const loaded = await loadPhaseCheckpoint(client, runId, "fetch");
    const fetchLoaded = loaded as { articles: { published: Date; link: string }[] };
    expect(fetchLoaded.articles).toHaveLength(2);
    expect(fetchLoaded.articles[0]!.published).toBeInstanceOf(Date);
    expect(fetchLoaded.articles[0]!.published.getTime()).toBe(new Date(ISO_DATE).getTime());
    expect(fetchLoaded.articles[1]!.published.getTime()).toBe(new Date(ISO_DATE_2).getTime());
    expect(fetchLoaded.articles[0]!.link).toBe("https://example.com/a");
  });

  it("fetch: defaults failedFeeds to '[]' when opts omitted", async () => {
    await savePhaseCheckpoint(client, runId, "fetch", { articles: [] });

    const updateCall = docs.updateDocumentCalls[0]!;
    expect(updateCall.data.failedFeeds).toBe("[]");
  });

  // ---- scrape ----
  it("scrape: round-trips articles with revived Dates and summary", async () => {
    const summary = { total: 3, extracted: 2, fallback: 1 };
    await savePhaseCheckpoint(client, runId, "scrape", {
      articles: [baseArticle()],
      summary,
    });

    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      checkpointScrapeId: "file-unique-id",
      completedPhase: "scrape",
    });
    const stored = JSON.parse(storage.files.get("file-unique-id")!.content);
    expect(stored.summary).toEqual(summary);
    expect(stored.articles[0].published).toBe(ISO_DATE);

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointScrapeId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "scrape")) as {
      articles: { published: Date }[];
      summary: typeof summary;
    };
    expect(loaded.articles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.summary).toEqual(summary);
  });

  // ---- tag ----
  it("tag: round-trips tagged articles with revived Dates", async () => {
    const tagged = [
      { ...baseArticle(), tags: ["ai", "research"] },
      {
        ...baseArticle({ link: "https://example.com/b", published: ISO_DATE_2 }),
        tags: ["finance"],
      },
    ];
    await savePhaseCheckpoint(client, runId, "tag", { taggedArticles: tagged });

    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      checkpointTagId: "file-unique-id",
      completedPhase: "tag",
    });

    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointTagId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "tag")) as {
      taggedArticles: { published: Date; tags: string[] }[];
    };
    expect(loaded.taggedArticles).toHaveLength(2);
    expect(loaded.taggedArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.taggedArticles[0]!.published.getTime()).toBe(new Date(ISO_DATE).getTime());
    expect(loaded.taggedArticles[1]!.published.getTime()).toBe(new Date(ISO_DATE_2).getTime());
    expect(loaded.taggedArticles[0]!.tags).toEqual(["ai", "research"]);
  });

  // ---- score (strip embedding) ----
  it("score: persisted JSON has NO embedding key even when input carries one", async () => {
    const scoredInput = [
      { ...baseArticle(), tags: ["ai"], score: 0.92, embedding: [0.1, 0.2, 0.3] },
    ];
    await savePhaseCheckpoint(client, runId, "score", {
      // Cast: pipeline objects may carry vectors the wire type omits.
      scoredArticles: scoredInput as unknown as never[],
    });

    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      checkpointScoreId: "file-unique-id",
      completedPhase: "score",
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content);
    expect(stored.scoredArticles).toHaveLength(1);
    expect(stored.scoredArticles[0]).not.toHaveProperty("embedding");
    expect(stored.scoredArticles[0].score).toBe(0.92);

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointScoreId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "score")) as {
      scoredArticles: { published: Date; score: number }[];
    };
    expect(loaded.scoredArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.scoredArticles[0]!.score).toBe(0.92);
    expect(loaded.scoredArticles[0]).not.toHaveProperty("embedding");
  });

  // ---- selection (strip embedding + failures audit) ----
  it("selection: persisted JSON has NO embedding key even when input carries one", async () => {
    const selectedInput = [{ ...baseArticle(), tags: ["ai"], score: 0.88, embedding: [0.4, 0.5] }];
    await savePhaseCheckpoint(client, runId, "selection", {
      selectedArticles: selectedInput as unknown as never[],
      failures: [],
    });

    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      checkpointSelectionId: "file-unique-id",
      completedPhase: "selection",
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content);
    expect(stored.selectedArticles).toHaveLength(1);
    expect(stored.selectedArticles[0]).not.toHaveProperty("embedding");
    expect(stored.selectedArticles[0].score).toBe(0.88);
    // Always emit failures key, including empty array.
    expect(stored).toHaveProperty("failures");
    expect(stored.failures).toEqual([]);

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointSelectionId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "selection")) as {
      selectedArticles: { published: Date; score: number }[];
      failures?: unknown[];
    };
    expect(loaded.selectedArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.selectedArticles[0]).not.toHaveProperty("embedding");
    expect(loaded.failures).toEqual([]);
  });

  it("selection: round-trips failures with selected articles (Dates, no embedding)", async () => {
    const failures = [
      {
        articleTitle: "Dropped",
        articleLink: "https://example.com/dropped",
        reason: "below-threshold" as const,
      },
      {
        articleTitle: "Embed fail",
        articleLink: "https://example.com/embed-fail",
        reason: "embedding-failed" as const,
        error: "timeout",
      },
    ];
    await savePhaseCheckpoint(client, runId, "selection", {
      selectedArticles: [
        { ...baseArticle(), tags: ["ai"], score: 0.9, embedding: [1, 2] } as unknown as never,
      ],
      failures,
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content);
    expect(stored.failures).toEqual(failures);
    expect(stored.selectedArticles[0]).not.toHaveProperty("embedding");

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointSelectionId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "selection")) as {
      selectedArticles: { published: Date; score: number; embedding?: number[] }[];
      failures?: typeof failures;
    };
    expect(loaded.selectedArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.selectedArticles[0]).not.toHaveProperty("embedding");
    expect(loaded.failures).toEqual(failures);
  });

  it("selection: legacy JSON without failures key loads with failures undefined", async () => {
    // Simulate a pre-feature checkpoint file (selectedArticles only).
    storage.files.set("file-legacy-selection", {
      name: "run-chk-selection.json",
      content: JSON.stringify({
        selectedArticles: [{ ...baseArticle(), tags: ["ai"], score: 0.77 }],
      }),
    });
    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointSelectionId: "file-legacy-selection" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "selection")) as {
      selectedArticles: { published: Date; score: number }[];
      failures?: unknown[];
    };
    expect(loaded.selectedArticles).toHaveLength(1);
    expect(loaded.selectedArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.selectedArticles[0]!.score).toBe(0.77);
    // Legacy: key missing → drops were not recorded.
    expect(loaded.failures).toBeUndefined();
  });

  // ---- draft (no raw / no retryError) ----
  it("draft: persisted JSON has markdown/empty/reason/articleCount/attempts but NO raw/retryError", async () => {
    const draftPayload = {
      markdown: "# Hello\n\nworld",
      empty: false,
      reason: null,
      articleCount: 5,
      attempts: 1,
      // Caller might pass extras that must never be persisted:
      raw: { secret: "should-not-leak" },
      retryError: "boom",
    } as unknown as {
      markdown: string;
      empty: boolean;
      reason: "no-articles" | "empty-after-retry" | null;
      articleCount: number;
      attempts: number;
    };

    await savePhaseCheckpoint(client, runId, "draft", draftPayload);

    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      checkpointDraftId: "file-unique-id",
      completedPhase: "draft",
    });

    const stored = JSON.parse(storage.files.get("file-unique-id")!.content);
    expect(stored).toEqual({
      markdown: "# Hello\n\nworld",
      empty: false,
      reason: null,
      articleCount: 5,
      attempts: 1,
    });
    expect(stored).not.toHaveProperty("raw");
    expect(stored).not.toHaveProperty("retryError");

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointDraftId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "draft")) as typeof draftPayload;
    expect(loaded.markdown).toBe("# Hello\n\nworld");
    expect(loaded.articleCount).toBe(5);
    expect(loaded.attempts).toBe(1);
    expect(loaded.empty).toBe(false);
    expect(loaded).not.toHaveProperty("raw");
  });

  it("draft: round-trips an empty draft (empty: true, reason set)", async () => {
    await savePhaseCheckpoint(client, runId, "draft", {
      markdown: "",
      empty: true,
      reason: "no-articles",
      articleCount: 0,
      attempts: 0,
    });

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointDraftId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "draft")) as {
      markdown: string;
      empty: boolean;
      reason: string | null;
    };
    expect(loaded.empty).toBe(true);
    expect(loaded.reason).toBe("no-articles");
    expect(loaded.markdown).toBe("");
  });

  // ---- checkpoint_missing ----
  it("load throws checkpoint_missing when the run has no checkpoint id for the phase", async () => {
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointFetchId: "" });

    const err = await expectRepoError(
      loadPhaseCheckpoint(client, runId, "fetch"),
      "checkpoint_missing",
    );
    expect(err.message).toContain("fetch");
    expect(storage.getFileDownloadCalls).toHaveLength(0);
  });

  it("load throws checkpoint_missing when the stored file is gone (404)", async () => {
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointScoreId: "ghost-file" });

    await expectRepoError(loadPhaseCheckpoint(client, runId, "score"), "checkpoint_missing");
  });

  it("load throws checkpoint_missing when the file contains invalid JSON (C2)", async () => {
    storage.files.set("corrupt-json", {
      name: "run-chk-fetch.json",
      content: "{not valid json<<<",
    });
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointFetchId: "corrupt-json" });

    const err = await expectRepoError(
      loadPhaseCheckpoint(client, runId, "fetch"),
      "checkpoint_missing",
    );
    expect(err.message).toContain("corrupted");
    expect(err.message).toContain("fetch");
  });

  it("load accepts already-parsed JSON from getFileDownload (node-appwrite Content-Type behavior)", async () => {
    // Live node-appwrite parses application/json downloads into objects instead
    // of ArrayBuffer — regression for issue-reader draft load failures.
    const originalDownload = storage.getFileDownload.bind(storage);
    storage.getFileDownload = async (params) => {
      storage.getFileDownloadCalls.push({ ...params });
      return {
        markdown: "# From parsed object\n",
        empty: false,
        reason: null,
        articleCount: 1,
        attempts: 1,
      } as unknown as Uint8Array;
    };

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointDraftId: "parsed-object-file" });

    try {
      const loaded = (await loadPhaseCheckpoint(client, runId, "draft")) as {
        markdown: string;
        articleCount: number;
      };
      expect(loaded.markdown).toBe("# From parsed object\n");
      expect(loaded.articleCount).toBe(1);
    } finally {
      storage.getFileDownload = originalDownload;
    }
  });

  it("load throws checkpoint_missing when the file has a wrong shape (C2)", async () => {
    storage.files.set("wrong-shape", {
      name: "run-chk-fetch.json",
      content: JSON.stringify({ wrongKey: "unexpected" }),
    });
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointFetchId: "wrong-shape" });

    const err = await expectRepoError(
      loadPhaseCheckpoint(client, runId, "fetch"),
      "checkpoint_missing",
    );
    expect(err.message).toContain("corrupted");
  });

  // ---- draft checkpoint schema validation (C2 / Feature 08 Task 4) ----
  const VALID_DRAFT_PAYLOAD = {
    markdown: "# Valid draft\n",
    empty: false,
    reason: null as string | null,
    articleCount: 2,
    attempts: 1,
  };

  it("draft: revives a complete valid DraftCheckpointPayload unchanged", async () => {
    storage.files.set("draft-valid", {
      name: "run-chk-draft.json",
      content: JSON.stringify(VALID_DRAFT_PAYLOAD),
    });
    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointDraftId: "draft-valid" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "draft")) as typeof VALID_DRAFT_PAYLOAD;
    expect(loaded).toEqual(VALID_DRAFT_PAYLOAD);
  });

  it.each([
    { label: "null", payload: null },
    { label: "primitive string", payload: "not-a-draft" },
    { label: "primitive number", payload: 42 },
    { label: "primitive boolean", payload: true },
    { label: "empty object", payload: {} },
    {
      label: "missing markdown",
      payload: { empty: false, reason: null, articleCount: 1, attempts: 1 },
    },
    {
      label: "missing empty",
      payload: { markdown: "", reason: null, articleCount: 1, attempts: 1 },
    },
    {
      label: "missing reason",
      payload: { markdown: "", empty: false, articleCount: 1, attempts: 1 },
    },
    {
      label: "missing articleCount",
      payload: { markdown: "", empty: false, reason: null, attempts: 1 },
    },
    {
      label: "missing attempts",
      payload: { markdown: "", empty: false, reason: null, articleCount: 1 },
    },
    {
      label: "markdown wrong type",
      payload: { ...VALID_DRAFT_PAYLOAD, markdown: 123 },
    },
    {
      label: "empty wrong type",
      payload: { ...VALID_DRAFT_PAYLOAD, empty: "false" },
    },
    {
      label: "reason wrong type (number)",
      payload: { ...VALID_DRAFT_PAYLOAD, reason: 0 },
    },
    {
      label: "articleCount wrong type (string)",
      payload: { ...VALID_DRAFT_PAYLOAD, articleCount: "2" },
    },
    {
      label: "attempts wrong type (string)",
      payload: { ...VALID_DRAFT_PAYLOAD, attempts: "1" },
    },
    {
      label: "articleCount negative",
      payload: { ...VALID_DRAFT_PAYLOAD, articleCount: -1 },
    },
    {
      label: "attempts negative",
      payload: { ...VALID_DRAFT_PAYLOAD, attempts: -1 },
    },
  ] as const)(
    "draft: throws checkpoint_missing for malformed payload ($label)",
    async ({ payload }) => {
      storage.files.set("draft-malformed", {
        name: "run-chk-draft.json",
        content: JSON.stringify(payload),
      });
      docs.getDocumentImpl = () =>
        mockRunDocument({ $id: runId, checkpointDraftId: "draft-malformed" });

      const err = await expectRepoError(
        loadPhaseCheckpoint(client, runId, "draft"),
        "checkpoint_missing",
      );
      expect(err.message).toContain("corrupted");
      expect(err.message).toContain("draft");
    },
  );

  it.each([
    {
      label: "articleCount NaN",
      payload: { ...VALID_DRAFT_PAYLOAD, articleCount: Number.NaN },
    },
    {
      label: "attempts Infinity",
      payload: { ...VALID_DRAFT_PAYLOAD, attempts: Number.POSITIVE_INFINITY },
    },
  ] as const)(
    "draft: throws checkpoint_missing for non-finite number ($label) via already-parsed download",
    async ({ payload }) => {
      // JSON.stringify collapses NaN/Infinity to null — exercise the revive guard
      // via the live SDK's already-parsed object path instead.
      const originalDownload = storage.getFileDownload.bind(storage);
      storage.getFileDownload = async (params) => {
        storage.getFileDownloadCalls.push({ ...params });
        return payload as unknown as Uint8Array;
      };
      docs.getDocumentImpl = () =>
        mockRunDocument({ $id: runId, checkpointDraftId: "draft-nonfinite" });

      try {
        const err = await expectRepoError(
          loadPhaseCheckpoint(client, runId, "draft"),
          "checkpoint_missing",
        );
        expect(err.message).toContain("corrupted");
        expect(err.message).toContain("draft");
      } finally {
        storage.getFileDownload = originalDownload;
      }
    },
  );

  // ---- explicit Date revive ----
  it("revives a published ISO string into a Date object after load", async () => {
    await savePhaseCheckpoint(client, runId, "fetch", {
      articles: [baseArticle({ published: "2024-01-15T10:30:00Z" })],
    });

    docs.getDocumentImpl = () =>
      mockRunDocument({ $id: runId, checkpointFetchId: "file-unique-id" });

    const loaded = (await loadPhaseCheckpoint(client, runId, "fetch")) as {
      articles: { published: unknown }[];
    };
    expect(loaded.articles[0]!.published).toBeInstanceOf(Date);
    expect((loaded.articles[0]!.published as Date).getTime()).toBe(
      new Date("2024-01-15T10:30:00Z").getTime(),
    );
  });

  it("uses the run_checkpoints bucket for upload and download", async () => {
    await savePhaseCheckpoint(client, runId, "tag", { taggedArticles: [] });

    expect(storage.createFileCalls[0]!.bucketId).toBe(RUN_CHECKPOINTS_BUCKET_ID);

    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointTagId: "file-unique-id" });

    await loadPhaseCheckpoint(client, runId, "tag");
    expect(storage.getFileDownloadCalls[0]!.bucketId).toBe(RUN_CHECKPOINTS_BUCKET_ID);
  });
});

// ---------------------------------------------------------------------------
// loadPhaseCheckpointFromRun (Feature 05 Task 1)
// ---------------------------------------------------------------------------

function fixtureRun(overrides: Partial<Run> = {}): Run {
  const now = new Date().toISOString();
  return {
    $id: "run-from-run",
    newsletterId: "newsletter-1",
    newsletterName: "Test Newsletter",
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "fetch",
    failedPhase: "",
    failureMessage: "",
    startedAt: now,
    endedAt: now,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    ...overrides,
  };
}

describe("loadPhaseCheckpointFromRun", () => {
  let docs: MockRunsDatabases;
  let storage: MockStorage;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    storage = new MockStorage();
    mockHolder.databases = docs;
    mockHolder.storage = storage;
    mockHolder.uniqueId = "file-unique-id";
    client = fakeClient();
  });

  it("throws checkpoint_missing when the run has an empty checkpoint id", async () => {
    const run = fixtureRun({ checkpointFetchId: "" });

    const err = await expectRepoError(
      loadPhaseCheckpointFromRun(client, run, "fetch"),
      "checkpoint_missing",
    );
    expect(err.message).toContain("fetch");
    expect(storage.getFileDownloadCalls).toHaveLength(0);
    expect(docs.getDocumentCalls).toHaveLength(0);
  });

  it("revives a FetchCheckpoint from a fixture Run without calling getRun", async () => {
    storage.files.set("fetch-file-id", {
      name: "run-from-run-fetch.json",
      content: JSON.stringify({
        articles: [baseArticle({ published: ISO_DATE })],
      }),
    });
    const run = fixtureRun({ checkpointFetchId: "fetch-file-id" });

    const loaded = (await loadPhaseCheckpointFromRun(client, run, "fetch")) as {
      articles: { published: Date; link: string; title: string }[];
    };

    expect(loaded.articles).toHaveLength(1);
    expect(loaded.articles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.articles[0]!.published.getTime()).toBe(new Date(ISO_DATE).getTime());
    expect(loaded.articles[0]!.link).toBe("https://example.com/a");
    expect(loaded.articles[0]!.title).toBe("Some headline");

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(storage.getFileDownloadCalls).toHaveLength(1);
    expect(storage.getFileDownloadCalls[0]).toMatchObject({
      bucketId: RUN_CHECKPOINTS_BUCKET_ID,
      fileId: "fetch-file-id",
    });
  });

  it("revives a SelectionCheckpoint (with failures) from a fixture Run without getRun", async () => {
    storage.files.set("selection-file-id", {
      name: "run-from-run-selection.json",
      content: JSON.stringify({
        selectedArticles: [
          {
            ...baseArticle({ published: ISO_DATE, title: "Picked", link: "https://example.com/p" }),
            tags: ["ai"],
            score: 0.9,
          },
        ],
        failures: [
          {
            articleTitle: "Dropped",
            articleLink: "https://example.com/d",
            reason: "below-threshold",
          },
        ],
      }),
    });
    const run = fixtureRun({ checkpointSelectionId: "selection-file-id" });

    const loaded = (await loadPhaseCheckpointFromRun(client, run, "selection")) as {
      selectedArticles: { published: Date; title: string; score: number }[];
      failures?: { reason: string; articleTitle: string }[];
    };

    expect(loaded.selectedArticles).toHaveLength(1);
    expect(loaded.selectedArticles[0]!.published).toBeInstanceOf(Date);
    expect(loaded.selectedArticles[0]!.title).toBe("Picked");
    expect(loaded.selectedArticles[0]!.score).toBe(0.9);
    expect(loaded.failures).toHaveLength(1);
    expect(loaded.failures![0]!.reason).toBe("below-threshold");
    expect(loaded.failures![0]!.articleTitle).toBe("Dropped");

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(storage.getFileDownloadCalls).toHaveLength(1);
    expect(storage.getFileDownloadCalls[0]).toMatchObject({
      bucketId: RUN_CHECKPOINTS_BUCKET_ID,
      fileId: "selection-file-id",
    });
  });

  it("throws checkpoint_missing for selection when the run has an empty checkpoint id", async () => {
    const run = fixtureRun({ checkpointSelectionId: "" });

    const err = await expectRepoError(
      loadPhaseCheckpointFromRun(client, run, "selection"),
      "checkpoint_missing",
    );
    expect(err.message).toContain("selection");
    expect(storage.getFileDownloadCalls).toHaveLength(0);
    expect(docs.getDocumentCalls).toHaveLength(0);
  });

  it("throws checkpoint_missing for draft when the run has an empty checkpointDraftId", async () => {
    const run = fixtureRun({ checkpointDraftId: "" });

    const err = await expectRepoError(
      loadPhaseCheckpointFromRun(client, run, "draft"),
      "checkpoint_missing",
    );
    expect(err.message).toContain("draft");
    expect(storage.getFileDownloadCalls).toHaveLength(0);
    expect(docs.getDocumentCalls).toHaveLength(0);
  });

  it("revives a DraftCheckpointPayload from a fixture Run without calling getRun", async () => {
    storage.files.set("draft-file-id", {
      name: "run-from-run-draft.json",
      content: JSON.stringify({
        markdown: "## Featured\n\nBody copy.",
        empty: false,
        reason: null,
        articleCount: 3,
        attempts: 1,
      }),
    });
    const run = fixtureRun({ checkpointDraftId: "draft-file-id" });

    const loaded = await loadPhaseCheckpointFromRun(client, run, "draft");

    expect(loaded.markdown).toBe("## Featured\n\nBody copy.");
    expect(loaded.empty).toBe(false);
    expect(loaded.reason).toBeNull();
    expect(loaded.articleCount).toBe(3);
    expect(loaded.attempts).toBe(1);

    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(storage.getFileDownloadCalls).toHaveLength(1);
    expect(storage.getFileDownloadCalls[0]).toMatchObject({
      bucketId: RUN_CHECKPOINTS_BUCKET_ID,
      fileId: "draft-file-id",
    });
  });
});

// ---------------------------------------------------------------------------
// savePhaseCheckpoint — persist-failure path (Task 5)
// ---------------------------------------------------------------------------

describe("savePhaseCheckpoint persist-failure", () => {
  let docs: MockRunsDatabases;
  let storage: MockStorage;
  let client: Client;
  const runId = "run-chk-fail";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    storage = new MockStorage();
    mockHolder.databases = docs;
    mockHolder.storage = storage;
    mockHolder.uniqueId = "file-unique-id";
    client = fakeClient();
  });

  // 1. Upload failure
  it("upload failure: marks run failed with the phase, does not advance completedPhase, rethrows appwrite", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });

    storage.createFileError = appwriteException("upload blew up", 500);

    await expectRepoError(
      savePhaseCheckpoint(client, runId, "scrape", {
        articles: [],
        summary: { total: 0, extracted: 0, fallback: 0 },
      }),
      "appwrite",
    );

    // Upload was attempted but no file stored
    expect(storage.createFileCalls).toHaveLength(1);
    expect(storage.files.size).toBe(0);

    // No orphan cleanup needed (upload didn't succeed)
    expect(storage.deleteFileCalls).toHaveLength(0);

    // markFailed was called and succeeded (updateDocumentError is null)
    expect(docs.updateDocumentCalls).toHaveLength(1);
    const markFailedCall = docs.updateDocumentCalls[0]!;
    expect(markFailedCall.documentId).toBe(runId);
    expect(markFailedCall.data).toMatchObject({
      status: "failed",
      failedPhase: "scrape",
      failureMessage: "Failed to save scrape checkpoint",
    });
    // markFailed must NOT advance completedPhase
    expect(markFailedCall.data).not.toHaveProperty("completedPhase");

    spy.mockRestore();
  });

  // 2. Doc update failure (orphan cleanup)
  it("doc update failure: best-effort deletes orphan file, marks run failed, rethrows appwrite", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });

    // Fail only the first updateDocument call (checkpoint update);
    // let markFailed's updateDocument (second call) succeed.
    docs.updateDocumentErrorFn = (_params, callIndex) =>
      callIndex === 0 ? appwriteException("doc update failed", 500) : null;

    await expectRepoError(
      savePhaseCheckpoint(client, runId, "scrape", {
        articles: [],
        summary: { total: 0, extracted: 0, fallback: 0 },
      }),
      "appwrite",
    );

    // File WAS uploaded before the doc update failed
    expect(storage.createFileCalls).toHaveLength(1);
    expect(storage.createFileCalls[0]!.fileId).toBe("file-unique-id");

    // Orphan file was best-effort deleted
    expect(storage.deleteFileCalls).toHaveLength(1);
    expect(storage.deleteFileCalls[0]!.fileId).toBe("file-unique-id");
    expect(storage.deleteFileCalls[0]!.bucketId).toBe(RUN_CHECKPOINTS_BUCKET_ID);
    expect(storage.files.has("file-unique-id")).toBe(false);

    // Two updateDocument calls: checkpoint update (failed) + markFailed (succeeded)
    expect(docs.updateDocumentCalls).toHaveLength(2);
    const checkpointCall = docs.updateDocumentCalls[0]!;
    expect(checkpointCall.data).toMatchObject({
      checkpointScrapeId: "file-unique-id",
      completedPhase: "scrape",
    });

    const markFailedCall = docs.updateDocumentCalls[1]!;
    expect(markFailedCall.data).toMatchObject({
      status: "failed",
      failedPhase: "scrape",
      failureMessage: "Failed to save scrape checkpoint",
    });
    // markFailed must NOT advance completedPhase
    expect(markFailedCall.data).not.toHaveProperty("completedPhase");

    spy.mockRestore();
  });

  // 3. Upload failure leaves completedPhase unchanged
  it("upload failure: preserves prior completedPhase (does not advance to the failed phase)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });

    storage.createFileError = appwriteException("upload failed", 500);

    await expectRepoError(
      savePhaseCheckpoint(client, runId, "score", {
        scoredArticles: [] as unknown as never[],
      }),
      "appwrite",
    );

    // No updateDocument call may have set completedPhase to the failed phase
    for (const call of docs.updateDocumentCalls) {
      expect(String(call.data.completedPhase ?? "")).not.toBe("score");
    }

    spy.mockRestore();
  });

  // 4. markFailed itself fails
  it("markFailed failure: function still throws appwrite (does not silently succeed)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });

    // Both upload and ALL updateDocument calls fail — markFailed will also fail
    storage.createFileError = appwriteException("upload failed", 500);
    docs.updateDocumentError = appwriteException("db down", 500);

    await expectRepoError(
      savePhaseCheckpoint(client, runId, "fetch", { articles: [] }),
      "appwrite",
    );

    // Upload was attempted
    expect(storage.createFileCalls).toHaveLength(1);

    // markFailed was attempted (updateDocument called) even though it also failed
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      status: "failed",
      failedPhase: "fetch",
    });

    spy.mockRestore();
  });

  // 5. Happy path still works (regression guard)
  it("happy path: when upload + update succeed, behavior is identical to before (no markFailed, no deleteFile)", async () => {
    const run = await savePhaseCheckpoint(client, runId, "tag", {
      taggedArticles: [],
    });

    // No deleteFile, no markFailed
    expect(storage.deleteFileCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data).toMatchObject({
      checkpointTagId: "file-unique-id",
      completedPhase: "tag",
    });
    expect(run.checkpointTagId).toBe("file-unique-id");
    expect(run.completedPhase).toBe("tag");
  });
});

// ---------------------------------------------------------------------------
// listActiveRunsForNewsletter / findActiveRunForNewsletter / listPendingRuns
// ---------------------------------------------------------------------------

describe("listActiveRunsForNewsletter", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const newsletterId = "nl-active";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns [] when no active runs match", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    const runs = await listActiveRunsForNewsletter(client, newsletterId);
    expect(runs).toEqual([]);
  });

  it("queries with newsletterId equal, status equal [pending, running], and limit 5", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listActiveRunsForNewsletter(client, newsletterId);
    expect(docs.listDocumentsCalls).toHaveLength(1);
    const call = docs.listDocumentsCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(RUNS_COLLECTION_ID);
    const queries = call.queries!;
    expect(queries).toContain(Query.equal("newsletterId", newsletterId));
    expect(queries).toContain(Query.equal("status", ["pending", "running"]));
    expect(queries).toContain(Query.limit(5));
  });

  it("returns all pending+running matches sorted oldest-first by startedAt then $id asc", async () => {
    docs.listDocumentsImpl = () => ({
      total: 3,
      documents: [
        mockRunDocument({
          $id: "run-c",
          newsletterId,
          status: "running",
          startedAt: "2026-03-01T00:00:00.000Z",
        }),
        mockRunDocument({
          $id: "run-a",
          newsletterId,
          status: "pending",
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
        mockRunDocument({
          $id: "run-b",
          newsletterId,
          status: "running",
          startedAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
    });
    const runs = await listActiveRunsForNewsletter(client, newsletterId);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.$id)).toEqual(["run-a", "run-b", "run-c"]);
    expect(runs.every((r) => r.newsletterId === newsletterId)).toBe(true);
  });

  it("breaks startedAt ties by $id ascending", async () => {
    docs.listDocumentsImpl = () => ({
      total: 2,
      documents: [
        mockRunDocument({
          $id: "run-z",
          newsletterId,
          status: "pending",
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
        mockRunDocument({
          $id: "run-a",
          newsletterId,
          status: "pending",
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    const runs = await listActiveRunsForNewsletter(client, newsletterId);
    expect(runs.map((r) => r.$id)).toEqual(["run-a", "run-z"]);
  });

  it("wraps Appwrite errors as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException("db down", 500);
    const err = await expectRepoError(
      listActiveRunsForNewsletter(client, newsletterId),
      "appwrite",
    );
    expect(err.message.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe("findActiveRunForNewsletter", () => {
  let docs: MockRunsDatabases;
  let client: Client;
  const newsletterId = "nl-find";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns null when no active runs match", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    const run = await findActiveRunForNewsletter(client, newsletterId);
    expect(run).toBeNull();
  });

  it("returns the first (oldest) active run when matches exist", async () => {
    docs.listDocumentsImpl = () => ({
      total: 2,
      documents: [
        mockRunDocument({
          $id: "run-newer",
          newsletterId,
          status: "running",
          startedAt: "2026-02-01T00:00:00.000Z",
        }),
        mockRunDocument({
          $id: "run-older",
          newsletterId,
          status: "pending",
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    const run = await findActiveRunForNewsletter(client, newsletterId);
    expect(run).not.toBeNull();
    expect(run!.$id).toBe("run-older");
  });
});

describe("listPendingRuns", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns [] when no pending runs exist", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    const runs = await listPendingRuns(client);
    expect(runs).toEqual([]);
  });

  it("queries with status equal pending, orderAsc startedAt, and default limit 10", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listPendingRuns(client);
    expect(docs.listDocumentsCalls).toHaveLength(1);
    const call = docs.listDocumentsCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(RUNS_COLLECTION_ID);
    const queries = call.queries!;
    expect(queries).toContain(Query.equal("status", "pending"));
    expect(queries).toContain(Query.orderAsc("startedAt"));
    expect(queries).toContain(Query.limit(10));
  });

  it("accepts a custom limit", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listPendingRuns(client, { limit: 3 });
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.limit(3));
  });

  it("returns pending runs oldest-first (FIFO claim order)", async () => {
    docs.listDocumentsImpl = () => ({
      total: 3,
      documents: [
        mockRunDocument({ $id: "run-3", status: "pending", startedAt: "2026-03-01T00:00:00.000Z" }),
        mockRunDocument({ $id: "run-1", status: "pending", startedAt: "2026-01-01T00:00:00.000Z" }),
        mockRunDocument({ $id: "run-2", status: "pending", startedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });
    const runs = await listPendingRuns(client);
    expect(runs.map((r) => r.$id)).toEqual(["run-1", "run-2", "run-3"]);
  });

  it("wraps Appwrite errors as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException("db down", 500);
    const err = await expectRepoError(listPendingRuns(client), "appwrite");
    expect(err.message.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});

describe("listRuns", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns [] when no runs exist", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    const runs = await listRuns(client);
    expect(runs).toEqual([]);
  });

  it("queries with default limit 100 and no filters when no opts", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client);
    expect(docs.listDocumentsCalls).toHaveLength(1);
    const call = docs.listDocumentsCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(RUNS_COLLECTION_ID);
    const queries = call.queries!;
    expect(queries).toContain(Query.limit(100));
    expect(queries).toHaveLength(1);
  });

  it("accepts a newsletterId filter", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client, { newsletterId: "nl-filter" });
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.equal("newsletterId", "nl-filter"));
    expect(queries).toContain(Query.limit(100));
    expect(queries).toHaveLength(2);
  });

  it("accepts a single status filter", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client, { status: "completed" });
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.equal("status", "completed"));
    expect(queries).toContain(Query.limit(100));
  });

  it("accepts a status array filter", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client, { status: ["completed", "failed"] });
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.equal("status", ["completed", "failed"]));
    expect(queries).toContain(Query.limit(100));
  });

  it("accepts newsletterId + status filters together", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client, { newsletterId: "nl-both", status: "failed" });
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.equal("newsletterId", "nl-both"));
    expect(queries).toContain(Query.equal("status", "failed"));
    expect(queries).toContain(Query.limit(100));
  });

  it("accepts a custom limit", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client, { limit: 25 });
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.limit(25));
    expect(queries).not.toContain(Query.limit(100));
  });

  it("returns runs newest-first by startedAt", async () => {
    docs.listDocumentsImpl = () => ({
      total: 3,
      documents: [
        mockRunDocument({ $id: "run-1", startedAt: "2026-01-01T00:00:00.000Z" }),
        mockRunDocument({ $id: "run-3", startedAt: "2026-03-01T00:00:00.000Z" }),
        mockRunDocument({ $id: "run-2", startedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });
    const runs = await listRuns(client);
    expect(runs.map((r) => r.$id)).toEqual(["run-3", "run-2", "run-1"]);
  });

  it("breaks startedAt ties by $id descending", async () => {
    docs.listDocumentsImpl = () => ({
      total: 2,
      documents: [
        mockRunDocument({ $id: "run-a", startedAt: "2026-01-01T00:00:00.000Z" }),
        mockRunDocument({ $id: "run-z", startedAt: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    const runs = await listRuns(client);
    expect(runs.map((r) => r.$id)).toEqual(["run-z", "run-a"]);
  });

  it("maps document fields correctly through documentToRun", async () => {
    docs.listDocumentsImpl = () => ({
      total: 1,
      documents: [
        mockRunDocument({
          $id: "run-map",
          newsletterId: "nl-x",
          newsletterName: "Mapped Newsletter",
          status: "failed",
          failedPhase: "draft",
          failureMessage: "boom",
          startedAt: "2026-05-01T00:00:00.000Z",
          endedAt: "2026-05-01T01:00:00.000Z",
        }),
      ],
    });
    const runs = await listRuns(client);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      $id: "run-map",
      newsletterId: "nl-x",
      newsletterName: "Mapped Newsletter",
      status: "failed",
      failedPhase: "draft",
      failureMessage: "boom",
    });
  });

  it("does not use Query.orderDesc (no index dependency)", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listRuns(client);
    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries.some((q) => q.startsWith("orderDesc"))).toBe(false);
  });

  it("wraps Appwrite errors as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException("db down", 500);
    const err = await expectRepoError(listRuns(client), "appwrite");
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message).not.toContain("db down");
    spy.mockRestore();
  });

  it("redacts secrets from the logged Appwrite error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException(`Request failed with key ${SECRET_API_KEY}`, 500);
    await expectRepoError(listRuns(client), "appwrite");
    const logged = spy.mock.calls[0]![0] as {
      phase: string;
      code: unknown;
      message: string;
    };
    expect(logged.phase).toBe("list-runs");
    expect(logged.code).toBe(500);
    expect(logged.message).not.toContain(SECRET_API_KEY);
    expect(logged.message).not.toContain("sk-");
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// deleteRun (Feature 06 — Run retention, Task 2)
// ---------------------------------------------------------------------------

describe("deleteRun", () => {
  let docs: MockRunsDatabases;
  let storage: MockStorage;
  let client: Client;
  const runId = "run-to-delete";

  beforeEach(() => {
    docs = new MockRunsDatabases();
    storage = new MockStorage();
    mockHolder.databases = docs;
    mockHolder.storage = storage;
    client = fakeClient();
  });

  it("deletes all present checkpoint file ids then the document", async () => {
    const ids = {
      checkpointFetchId: "file-fetch",
      checkpointScrapeId: "file-scrape",
      checkpointTagId: "file-tag",
      checkpointScoreId: "file-score",
      checkpointSelectionId: "file-sel",
      checkpointDraftId: "file-draft",
    };
    for (const id of Object.values(ids)) {
      storage.files.set(id, { name: `${id}.json`, content: "{}" });
    }
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, ...ids });

    await deleteRun(client, runId);

    expect(storage.deleteFileCalls).toHaveLength(6);
    const deletedIds = storage.deleteFileCalls.map((c) => c.fileId).sort();
    expect(deletedIds).toEqual(
      ["file-fetch", "file-scrape", "file-tag", "file-score", "file-sel", "file-draft"].sort(),
    );
    for (const c of storage.deleteFileCalls) {
      expect(c.bucketId).toBe(RUN_CHECKPOINTS_BUCKET_ID);
    }
    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: runId,
    });
  });

  it("missing checkpoint files do not fail deleteRun (best-effort)", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        checkpointFetchId: "ghost-fetch",
        checkpointScrapeId: "ghost-scrape",
      });

    await deleteRun(client, runId);

    expect(storage.deleteFileCalls).toHaveLength(2);
    expect(docs.deleteDocumentCalls).toHaveLength(1);
  });

  it("document delete failure throws appwrite", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.getDocumentImpl = () => mockRunDocument({ $id: runId, checkpointFetchId: "file-1" });
    storage.files.set("file-1", { name: "f.json", content: "{}" });
    docs.deleteDocumentError = appwriteException("db down", 500);

    await expectRepoError(deleteRun(client, runId), "appwrite");

    expect(docs.deleteDocumentCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("throws not_found when the run does not exist (404) and makes no delete calls", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const err = await expectRepoError(deleteRun(client, runId), "not_found");
    expect(err.message).toBe("Run not found");
    expect(storage.deleteFileCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });

  it("checkpoint deleteFile error does not fail deleteRun", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        checkpointFetchId: "file-1",
        checkpointScrapeId: "file-2",
      });
    storage.files.set("file-1", { name: "f.json", content: "{}" });
    storage.files.set("file-2", { name: "g.json", content: "{}" });
    storage.deleteFileError = appwriteException("storage error", 500);

    await deleteRun(client, runId);

    expect(storage.deleteFileCalls).toHaveLength(2);
    expect(docs.deleteDocumentCalls).toHaveLength(1);
    expect(docs.deleteDocumentCalls[0]!.documentId).toBe(runId);
    spy.mockRestore();
  });

  it("skips empty checkpoint ids (no deleteFile calls)", async () => {
    docs.getDocumentImpl = () =>
      mockRunDocument({
        $id: runId,
        checkpointFetchId: "",
        checkpointScrapeId: "",
        checkpointTagId: "",
        checkpointScoreId: "",
        checkpointSelectionId: "",
        checkpointDraftId: "",
      });

    await deleteRun(client, runId);

    expect(storage.deleteFileCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// listAllRuns (Feature 06 — Run retention, Task 2)
// ---------------------------------------------------------------------------

describe("listAllRuns", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("concatenates two pages of fixtures into the full array", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => mockRunDocument({ $id: `run-p1-${i}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => mockRunDocument({ $id: `run-p2-${i}` }));
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      if (callCount === 1) return { total: 150, documents: page1 };
      return { total: 150, documents: page2 };
    };

    const runs = await listAllRuns(client);

    expect(runs).toHaveLength(150);
    expect(docs.listDocumentsCalls).toHaveLength(2);
  });

  it("returns a single page when total <= pageSize", async () => {
    const fixtures = Array.from({ length: 3 }, (_, i) => mockRunDocument({ $id: `run-${i}` }));
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      return { total: 3, documents: fixtures };
    };

    const runs = await listAllRuns(client);

    expect(runs).toHaveLength(3);
    expect(callCount).toBe(1);
  });

  it("returns [] when the collection is empty", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });

    const runs = await listAllRuns(client);

    expect(runs).toEqual([]);
    expect(docs.listDocumentsCalls).toHaveLength(1);
  });

  it("uses a default pageSize of 100 on the first call", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listAllRuns(client);

    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.limit(100));
    // first page must not include a cursor
    expect(queries.every((q) => !q.startsWith("cursorAfter"))).toBe(true);
  });

  it("respects a custom pageSize", async () => {
    docs.listDocumentsImpl = () => ({ total: 0, documents: [] });
    await listAllRuns(client, { pageSize: 25 });

    const queries = docs.listDocumentsCalls[0]!.queries!;
    expect(queries).toContain(Query.limit(25));
    expect(queries).not.toContain(Query.limit(100));
  });

  it("uses cursorAfter on the second page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => mockRunDocument({ $id: `run-p1-${i}` }));
    const lastId = page1[page1.length - 1]!.$id;
    let callCount = 0;
    docs.listDocumentsImpl = () => {
      callCount++;
      if (callCount === 1) return { total: 100, documents: page1 };
      return { total: 100, documents: [] };
    };

    await listAllRuns(client);

    expect(docs.listDocumentsCalls).toHaveLength(2);
    const secondQueries = docs.listDocumentsCalls[1]!.queries!;
    expect(secondQueries).toContain(Query.cursorAfter(lastId));
  });

  it("wraps Appwrite errors as appwrite code with a safe message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      /* swallow */
    });
    docs.listDocumentsError = appwriteException("db down", 500);
    const err = await expectRepoError(listAllRuns(client), "appwrite");
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message).not.toContain("db down");
    spy.mockRestore();
  });
});
