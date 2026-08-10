import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Client } from "node-appwrite";

import { DATABASE_ID, RUNS_COLLECTION_ID } from "../../schema/declarations";
import {
  MockRunsDatabases,
  appwriteException,
  fakeClient,
} from "../../runs/__tests__/mock-client";

// Intentionally imports modules that do not exist yet (Task 3).
// Cases 4–7, 10 fail red for missing module / missing exports.
import { recordEmailDelivery, recordRssDelivery } from "../record-delivery";
import { DELIVERY_ERROR_MAX } from "../../schema/declarations";

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

const SECRET_API_KEY = "sk-secret-do-not-leak-1234567890";
const RUN_ID = "run-delivery-1";

describe("recordEmailDelivery", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  // Stage 09 Feature 06 Task 1 case 4 — email success.
  it("records email success as sent with timestamp and cleared error", async () => {
    const before = Date.now();
    await recordEmailDelivery(client, RUN_ID, { ok: true });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: RUN_ID,
    });
    expect(call.data).toMatchObject({
      emailDeliveryStatus: "sent",
      emailDeliveryError: "",
    });
    expect(Object.keys(call.data).sort()).toEqual(
      ["emailDeliveryAt", "emailDeliveryError", "emailDeliveryStatus"].sort(),
    );

    const at = new Date(String(call.data.emailDeliveryAt)).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });

  // Stage 09 Feature 06 Task 1 case 5 — email failure.
  it("records email failure as failed with truncated sanitized error", async () => {
    const longError = `SMTP failed with key ${SECRET_API_KEY} — ${"x".repeat(3000)}`;

    await recordEmailDelivery(client, RUN_ID, { ok: false, error: longError });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.emailDeliveryStatus).toBe("failed");
    expect(typeof call.data.emailDeliveryAt).toBe("string");
    expect(typeof call.data.emailDeliveryError).toBe("string");
    expect(String(call.data.emailDeliveryError).length).toBeLessThanOrEqual(DELIVERY_ERROR_MAX);
    expect(String(call.data.emailDeliveryError)).not.toContain(SECRET_API_KEY);
    expect(Object.keys(call.data).sort()).toEqual(
      ["emailDeliveryAt", "emailDeliveryError", "emailDeliveryStatus"].sort(),
    );
  });

  // Stage 09 Feature 06 Task 1 case 7 — overwrite email channel only.
  it("overwrites prior email delivery fields on a second record", async () => {
    await recordEmailDelivery(client, RUN_ID, {
      ok: false,
      error: "first failure",
    });
    const firstAt = String(docs.updateDocumentCalls[0]!.data.emailDeliveryAt);

    await new Promise((r) => setTimeout(r, 2));

    await recordEmailDelivery(client, RUN_ID, { ok: true });

    expect(docs.updateDocumentCalls).toHaveLength(2);
    const second = docs.updateDocumentCalls[1]!;
    expect(second.data).toMatchObject({
      emailDeliveryStatus: "sent",
      emailDeliveryError: "",
    });
    expect(String(second.data.emailDeliveryAt)).not.toBe(firstAt);
    expect(Object.keys(second.data)).not.toContain("rssDeliveryStatus");
    expect(Object.keys(second.data)).not.toContain("rssDeliveryAt");
    expect(Object.keys(second.data)).not.toContain("rssDeliveryError");
  });

  // Stage 09 Feature 06 Task 1 case 10 — swallow Appwrite errors after logging.
  it("swallows Appwrite update errors after logging (does not throw)", async () => {
    docs.updateDocumentError = appwriteException(
      `Document update failed with key ${SECRET_API_KEY}`,
      500,
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordEmailDelivery(client, RUN_ID, { ok: true })).resolves.toBeUndefined();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(SECRET_API_KEY);

    consoleError.mockRestore();
  });
});

describe("recordRssDelivery", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  // Stage 09 Feature 06 Task 1 case 6 — RSS success.
  it("records RSS success as published with timestamp and cleared error", async () => {
    const before = Date.now();
    await recordRssDelivery(client, RUN_ID, { ok: true });
    const after = Date.now();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call).toMatchObject({
      databaseId: DATABASE_ID,
      collectionId: RUNS_COLLECTION_ID,
      documentId: RUN_ID,
    });
    expect(call.data).toMatchObject({
      rssDeliveryStatus: "published",
      rssDeliveryError: "",
    });
    expect(Object.keys(call.data).sort()).toEqual(
      ["rssDeliveryAt", "rssDeliveryError", "rssDeliveryStatus"].sort(),
    );

    const at = new Date(String(call.data.rssDeliveryAt)).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });

  // Stage 09 Feature 06 Task 1 case 6 — RSS failure.
  it("records RSS failure as failed with truncated sanitized error", async () => {
    const longError = `RSS upsert failed with key ${SECRET_API_KEY} — ${"y".repeat(3000)}`;

    await recordRssDelivery(client, RUN_ID, { ok: false, error: longError });

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.data.rssDeliveryStatus).toBe("failed");
    expect(typeof call.data.rssDeliveryAt).toBe("string");
    expect(typeof call.data.rssDeliveryError).toBe("string");
    expect(String(call.data.rssDeliveryError).length).toBeLessThanOrEqual(DELIVERY_ERROR_MAX);
    expect(String(call.data.rssDeliveryError)).not.toContain(SECRET_API_KEY);
    expect(Object.keys(call.data).sort()).toEqual(
      ["rssDeliveryAt", "rssDeliveryError", "rssDeliveryStatus"].sort(),
    );
  });

  // Stage 09 Feature 06 Task 1 case 7 — overwrite RSS channel only.
  it("overwrites prior RSS delivery fields without touching email fields", async () => {
    await recordRssDelivery(client, RUN_ID, {
      ok: false,
      error: "rss first failure",
    });

    await recordRssDelivery(client, RUN_ID, { ok: true });

    expect(docs.updateDocumentCalls).toHaveLength(2);
    const second = docs.updateDocumentCalls[1]!;
    expect(second.data).toMatchObject({
      rssDeliveryStatus: "published",
      rssDeliveryError: "",
    });
    expect(Object.keys(second.data)).not.toContain("emailDeliveryStatus");
    expect(Object.keys(second.data)).not.toContain("emailDeliveryAt");
    expect(Object.keys(second.data)).not.toContain("emailDeliveryError");
  });

  // Stage 09 Feature 06 Task 1 case 10 — swallow Appwrite errors after logging.
  it("swallows Appwrite update errors after logging (does not throw)", async () => {
    docs.updateDocumentError = appwriteException(
      `Document update failed with key ${SECRET_API_KEY}`,
      500,
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordRssDelivery(client, RUN_ID, { ok: false, error: "publish failed" }),
    ).resolves.toBeUndefined();

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(SECRET_API_KEY);

    consoleError.mockRestore();
  });
});
