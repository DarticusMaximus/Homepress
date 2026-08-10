import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Client } from "node-appwrite";

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

import { DATABASE_ID, PROMPT_TEMPLATES_COLLECTION_ID } from "../../schema/declarations";
import {
  getOrCreatePromptTemplate,
  listPromptTemplates,
  resetPromptTemplate,
  updatePromptTemplate,
} from "../repository";
import { PROMPT_ROLES, PromptRepositoryError, type PromptRole } from "../types";
import {
  SHIPPED_PROMPT_DEFAULTS,
  SHIPPED_TAGGER_PROMPT,
  SHIPPED_SCORER_PROMPT,
  SHIPPED_DRAFTER_PROMPT,
  getShippedPromptDefault,
} from "../defaults";
import { MockRunsDatabases, appwriteException, fakeClient } from "../../runs/__tests__/mock-client";

/** Same pin as contract.test.ts — duplicated to avoid importing a test module. */
const PINNED_SHIPPED_DRAFTER_PROMPT = `**Goal** Write a factual markdown newsletter draft for "{newsletter_name}".

**Audience** {audience}
(If audience is empty, write for a general tech-curious reader.)

**Role** Clear technology writer. Prioritize: {topics}.

**Rules**
- Start with a single newsletter title as the first line: \`# <Title>\` (this is the issue title — make it specific to this issue’s contents, not just the newsletter name).
- Then write {count} items from the articles below (fewer only if the set is smaller).
- One featured item first (deeper), then shorter summaries for the rest.
- Plain, easy-to-understand English. Fact-based. Neutral tone.
- Include the source link under each item.
- Use Markdown (\`##\` for item headings after the title).
- No preamble before the \`#\` title. No closing sign-off.

**Articles (JSON)**

---

{articles_json}

---

Write the newsletter using the provided articles.`;

function expectPromptError(
  promise: Promise<unknown>,
  code: PromptRepositoryError["code"],
): Promise<PromptRepositoryError> {
  return promise.then(
    () => {
      throw new Error(`Expected PromptRepositoryError with code ${code}`);
    },
    (err) => {
      expect(err).toBeInstanceOf(PromptRepositoryError);
      const repoErr = err as PromptRepositoryError;
      expect(repoErr.code).toBe(code);
      return repoErr;
    },
  );
}

function mockPromptDocument(
  role: PromptRole,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const now = new Date().toISOString();
  const defaults: Record<PromptRole, string> = {
    tagger: SHIPPED_TAGGER_PROMPT,
    scorer: SHIPPED_SCORER_PROMPT,
    drafter: SHIPPED_DRAFTER_PROMPT,
  };
  return {
    $id: role,
    $collectionId: PROMPT_TEMPLATES_COLLECTION_ID,
    $databaseId: DATABASE_ID,
    $createdAt: now,
    $updatedAt: now,
    $permissions: [],
    body: defaults[role],
    updatedAt: now,
    ...overrides,
  };
}

const VALID_TAGGER_BODY = "Title: {title}\nArticle: {truncated_content}";
const VALID_TAGGER_WITH_UNKNOWN = "Title: {title}\nArticle: {truncated_content}\nExtra: {foo}";
const INVALID_TAGGER_BODY = "Title only, no truncated content placeholder";
const APPWRITE_SAFE_MESSAGE =
  "Something went wrong while talking to the database. Please try again.";

describe("getOrCreatePromptTemplate", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates with shipped default body when the document is missing", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const template = await getOrCreatePromptTemplate(client, "tagger");

    expect(docs.createDocumentCalls).toHaveLength(1);
    const call = docs.createDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(PROMPT_TEMPLATES_COLLECTION_ID);
    expect(call.documentId).toBe("tagger");
    expect(call.data.body).toBe(SHIPPED_TAGGER_PROMPT);
    expect(call.data.updatedAt).toEqual(expect.any(String));

    expect(template.role).toBe("tagger");
    expect(template.body).toBe(SHIPPED_TAGGER_PROMPT);
    expect(template.updatedAt).toEqual(expect.any(String));
  });

  it("returns stored body when the document already exists (does not overwrite)", async () => {
    const stored = "Custom tagger body with {title} and {truncated_content}";
    docs.getDocumentImpl = () =>
      mockPromptDocument("tagger", {
        body: stored,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as never;

    const template = await getOrCreatePromptTemplate(client, "tagger");

    expect(template.role).toBe("tagger");
    expect(template.body).toBe(stored);
    expect(template.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(docs.getDocumentCalls).toHaveLength(1);
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("throws validation for an invalid role", async () => {
    await expectPromptError(
      getOrCreatePromptTemplate(client, "editor" as PromptRole),
      "validation",
    );
    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("recovers via re-get when createDocument loses a 409 race (no throw)", async () => {
    const reGetBody = "winner-from-reget {title} {truncated_content}";
    docs.createDocumentError = appwriteException("document already exists", 409, "conflict");
    docs.getDocumentImpl = () => {
      if (docs.getDocumentCalls.length === 1) {
        throw appwriteException("not found", 404);
      }
      return mockPromptDocument("tagger", {
        body: reGetBody,
        updatedAt: "2026-03-01T00:00:00.000Z",
      }) as never;
    };

    const template = await getOrCreatePromptTemplate(client, "tagger");

    expect(template.role).toBe("tagger");
    expect(template.body).toBe(reGetBody);
    expect(template.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(docs.getDocumentCalls).toHaveLength(2);
    expect(docs.createDocumentCalls).toHaveLength(1);
  });

  it("wraps to appwrite error when the create-race re-get also 404s", async () => {
    docs.createDocumentError = appwriteException("document already exists", 409, "conflict");
    docs.getDocumentImpl = () => {
      throw appwriteException("not found", 404);
    };

    const err = await expectPromptError(
      getOrCreatePromptTemplate(client, "tagger"),
      "appwrite",
    );
    expect(err.message).toBe(APPWRITE_SAFE_MESSAGE);
    expect(docs.getDocumentCalls).toHaveLength(2);
    expect(docs.createDocumentCalls).toHaveLength(1);
  });

  it("wraps a non-404/non-409 getDocument Appwrite error to an operator-safe appwrite error (no raw leak)", async () => {
    const raw = "Database internal failure sk-live-SECRETKEY123";
    docs.getDocumentError = appwriteException(raw, 500, "internal_server_error");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = await expectPromptError(
      getOrCreatePromptTemplate(client, "tagger"),
      "appwrite",
    );
    expect(err.message).toBe(APPWRITE_SAFE_MESSAGE);
    expect(err.message).not.toContain(raw);
    expect(docs.createDocumentCalls).toHaveLength(0);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0]![0] as {
      phase: string;
      code?: number;
      message: string;
    };
    expect(logged.phase).toBe("get-prompt-template");
    expect(logged.code).toBe(500);
    expect(logged.message).toContain("[redacted]");
    expect(logged.message).not.toContain("sk-live-SECRETKEY123");

    errorSpy.mockRestore();
  });
});

describe("listPromptTemplates", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("returns three templates in role order, seeding any missing", async () => {
    docs.getDocumentImpl = (params) => {
      if (params.documentId === "scorer") {
        throw appwriteException("not found", 404);
      }
      return mockPromptDocument(params.documentId as PromptRole, {
        body: `stored-${params.documentId}`,
        updatedAt: "2026-02-01T00:00:00.000Z",
      }) as never;
    };

    const list = await listPromptTemplates(client);

    expect(list.map((t) => t.role)).toEqual(["tagger", "scorer", "drafter"]);
    expect(list[0]!.body).toBe("stored-tagger");
    expect(list[1]!.body).toBe(SHIPPED_SCORER_PROMPT);
    expect(list[2]!.body).toBe("stored-drafter");
    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.createDocumentCalls[0]!.documentId).toBe("scorer");
    expect(docs.createDocumentCalls[0]!.data.body).toBe(SHIPPED_SCORER_PROMPT);
  });
});

describe("updatePromptTemplate", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it("throws validation and does not write when a required placeholder is missing", async () => {
    docs.getDocumentImpl = () => mockPromptDocument("tagger") as never;

    const err = await expectPromptError(
      updatePromptTemplate(client, "tagger", INVALID_TAGGER_BODY),
      "validation",
    );
    expect(err.message).toMatch(/truncated_content/);
    expect(docs.updateDocumentCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("writes body and returns warnings for unknown placeholders", async () => {
    docs.getDocumentImpl = () => mockPromptDocument("tagger") as never;

    const result = await updatePromptTemplate(client, "tagger", VALID_TAGGER_WITH_UNKNOWN);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(PROMPT_TEMPLATES_COLLECTION_ID);
    expect(call.documentId).toBe("tagger");
    expect(call.data.body).toBe(VALID_TAGGER_WITH_UNKNOWN);
    expect(call.data.updatedAt).toEqual(expect.any(String));

    expect(result.template.role).toBe("tagger");
    expect(result.template.body).toBe(VALID_TAGGER_WITH_UNKNOWN);
    expect(result.warnings).toContain("foo");
  });

  it("succeeds when the role document is missing: seed then write (no 404)", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const result = await updatePromptTemplate(client, "tagger", VALID_TAGGER_BODY);

    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.createDocumentCalls[0]!.documentId).toBe("tagger");
    expect(docs.createDocumentCalls[0]!.data.body).toBe(SHIPPED_TAGGER_PROMPT);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.body).toBe(VALID_TAGGER_BODY);

    expect(result.template.role).toBe("tagger");
    expect(result.template.body).toBe(VALID_TAGGER_BODY);
    expect(result.warnings).toEqual([]);
  });

  it("throws validation for an invalid role", async () => {
    await expectPromptError(
      updatePromptTemplate(client, "editor" as PromptRole, VALID_TAGGER_BODY),
      "validation",
    );
    expect(docs.updateDocumentCalls).toHaveLength(0);
  });

  it("wraps a non-404/non-409 updateDocument Appwrite error to an operator-safe appwrite error (no raw leak)", async () => {
    const raw = "Storage backend unavailable Bearer tokensecret";
    docs.getDocumentImpl = () => mockPromptDocument("tagger") as never;
    docs.updateDocumentError = appwriteException(raw, 500, "internal_server_error");

    const err = await expectPromptError(
      updatePromptTemplate(client, "tagger", VALID_TAGGER_BODY),
      "appwrite",
    );
    expect(err.message).toBe(APPWRITE_SAFE_MESSAGE);
    expect(err.message).not.toContain(raw);
    expect(docs.updateDocumentCalls).toHaveLength(1);
  });
});

describe("resetPromptTemplate", () => {
  let docs: MockRunsDatabases;
  let client: Client;

  beforeEach(() => {
    docs = new MockRunsDatabases();
    mockHolder.databases = docs;
    client = fakeClient();
  });

  it.each(PROMPT_ROLES)(
    "writes body equal to SHIPPED_PROMPT_DEFAULTS[%s]",
    async (role) => {
      docs.getDocumentImpl = () =>
        mockPromptDocument(role, {
          body: `custom-${role} body with placeholders mutated`,
        }) as never;

      const result = await resetPromptTemplate(client, role);

      expect(result.template.role).toBe(role);
      expect(result.template.body).toBe(SHIPPED_PROMPT_DEFAULTS[role]);
      expect(result.warnings).toEqual([]);
      expect(docs.updateDocumentCalls).toHaveLength(1);
      expect(docs.updateDocumentCalls[0]!.documentId).toBe(role);
      expect(docs.updateDocumentCalls[0]!.data.body).toBe(SHIPPED_PROMPT_DEFAULTS[role]);
    },
  );

  it("succeeds when the document is missing (get-or-create then update)", async () => {
    docs.getDocumentError = appwriteException("not found", 404);

    const result = await resetPromptTemplate(client, "tagger");

    expect(docs.createDocumentCalls).toHaveLength(1);
    expect(docs.createDocumentCalls[0]!.documentId).toBe("tagger");
    expect(docs.createDocumentCalls[0]!.data.body).toBe(SHIPPED_PROMPT_DEFAULTS.tagger);

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.body).toBe(SHIPPED_PROMPT_DEFAULTS.tagger);

    expect(result.template.role).toBe("tagger");
    expect(result.template.body).toBe(SHIPPED_PROMPT_DEFAULTS.tagger);
    expect(result.warnings).toEqual([]);
  });

  it("succeeds when body is already the shipped default (idempotent)", async () => {
    docs.getDocumentImpl = () =>
      mockPromptDocument("scorer", {
        body: SHIPPED_PROMPT_DEFAULTS.scorer,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as never;

    const result = await resetPromptTemplate(client, "scorer");

    expect(docs.updateDocumentCalls).toHaveLength(1);
    expect(docs.updateDocumentCalls[0]!.data.body).toBe(SHIPPED_PROMPT_DEFAULTS.scorer);
    expect(result.template.body).toBe(SHIPPED_PROMPT_DEFAULTS.scorer);
    expect(result.warnings).toEqual([]);
  });

  it("throws validation for an invalid role", async () => {
    await expectPromptError(resetPromptTemplate(client, "editor" as PromptRole), "validation");
    expect(docs.getDocumentCalls).toHaveLength(0);
    expect(docs.updateDocumentCalls).toHaveLength(0);
    expect(docs.createDocumentCalls).toHaveLength(0);
  });

  it("goes through update semantics (updateDocument with shipped body, not delete+create)", async () => {
    docs.getDocumentImpl = () =>
      mockPromptDocument("drafter", {
        body: "Custom drafter body {newsletter_name} {topics} {articles_json} {count}",
      }) as never;

    await resetPromptTemplate(client, "drafter");

    expect(docs.updateDocumentCalls).toHaveLength(1);
    const call = docs.updateDocumentCalls[0]!;
    expect(call.databaseId).toBe(DATABASE_ID);
    expect(call.collectionId).toBe(PROMPT_TEMPLATES_COLLECTION_ID);
    expect(call.documentId).toBe("drafter");
    expect(call.data.body).toBe(SHIPPED_PROMPT_DEFAULTS.drafter);
    expect(call.data.updatedAt).toEqual(expect.any(String));

    expect(docs.createDocumentCalls).toHaveLength(0);
    expect(docs.deleteDocumentCalls).toHaveLength(0);
  });

  // Feature 03 Task 1 — item 4 (reset path exact pin)
  it("reset drafter writes the pinned SHIPPED_DRAFTER_PROMPT body exactly", async () => {
    docs.getDocumentImpl = () =>
      mockPromptDocument("drafter", {
        body: "Custom drafter body {newsletter_name} {topics} {articles_json} {count}",
      }) as never;

    const result = await resetPromptTemplate(client, "drafter");

    expect(getShippedPromptDefault("drafter")).toBe(PINNED_SHIPPED_DRAFTER_PROMPT);
    expect(SHIPPED_DRAFTER_PROMPT).toBe(PINNED_SHIPPED_DRAFTER_PROMPT);
    expect(result.template.body).toBe(PINNED_SHIPPED_DRAFTER_PROMPT);
    expect(docs.updateDocumentCalls[0]!.data.body).toBe(PINNED_SHIPPED_DRAFTER_PROMPT);
  });
});
