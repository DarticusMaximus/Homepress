import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Query, type Users } from "node-appwrite";

const mocks = vi.hoisted(() => ({
  uniqueId: "user-unique-id",
}));

vi.mock("node-appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-appwrite")>();
  return {
    ...actual,
    ID: {
      ...actual.ID,
      unique: () => mocks.uniqueId,
    },
  };
});

import {
  ACCOUNT_LIST_PAGE_SIZE,
  AccountAdminError,
  createReaderAccount,
  deleteAccount,
  listAccounts,
  resetAccountPassword,
  setAccountBlocked,
} from "@/lib/accounts/account-admin";

const VALIDATION_EMAIL = "Enter a valid email address";
const VALIDATION_PASSWORD = "Password must be at least 8 characters";
const ALREADY_EXISTS = "An account with this email already exists";
const NOT_FOUND = "Account not found";
const FORBIDDEN_TARGET = "Operator accounts cannot be blocked, reset, or deleted";
const SAFE_APPWRITE = "Something went wrong while updating accounts. Please try again.";

type UsersStub = {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  updatePassword: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function stubUsers(overrides: Partial<UsersStub> = {}): UsersStub {
  return {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    updateStatus: vi.fn(),
    updatePassword: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

function asUsers(stub: UsersStub): Users {
  return stub as unknown as Users;
}

function appwriteUser(overrides: Record<string, unknown> = {}) {
  return {
    $id: "user-reader-1",
    $createdAt: "2026-09-17T12:00:00.000Z",
    $updatedAt: "2026-09-17T12:00:00.000Z",
    name: "Pat Reader",
    email: "pat@example.com",
    status: true,
    labels: [] as string[],
    registration: "2026-09-17T12:00:00.000Z",
    ...overrides,
  };
}

function appwriteException(overrides: Record<string, unknown> = {}) {
  return {
    code: 500,
    type: "general_unknown",
    message: "Appwrite endpoint https://cloud.appwrite.io leaked secret sk-secret-key",
    ...overrides,
  };
}

async function expectAdminError(
  promise: Promise<unknown>,
  code: AccountAdminError["code"],
  message?: string,
): Promise<AccountAdminError> {
  return promise.then(
    () => {
      throw new Error(`Expected AccountAdminError with code ${code}`);
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(AccountAdminError);
      const adminErr = err as AccountAdminError;
      expect(adminErr.code).toBe(code);
      if (message !== undefined) {
        expect(adminErr.message).toBe(message);
      }
      expect(adminErr.message).not.toMatch(/appwrite|sk-secret|https:\/\//i);
      return adminErr;
    },
  );
}

beforeEach(() => {
  mocks.uniqueId = "user-unique-id";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountAdminError", () => {
  it("is an Error subclass named AccountAdminError that carries a code", () => {
    const error = new AccountAdminError("validation", VALIDATION_EMAIL);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AccountAdminError");
    expect(error.code).toBe("validation");
    expect(error.message).toBe(VALIDATION_EMAIL);
  });
});

describe("createReaderAccount", () => {
  it("rejects an email without @ as validation", async () => {
    const users = stubUsers();

    await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "not-an-email",
        password: "password1",
      }),
      "validation",
      VALIDATION_EMAIL,
    );
    expect(users.create).not.toHaveBeenCalled();
  });

  it("rejects an email with no domain as validation", async () => {
    const users = stubUsers();

    await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "pat@",
        password: "password1",
      }),
      "validation",
      VALIDATION_EMAIL,
    );
    expect(users.create).not.toHaveBeenCalled();
  });

  it("rejects an email whose domain has no dot as validation", async () => {
    const users = stubUsers();

    await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "pat@localhost",
        password: "password1",
      }),
      "validation",
      VALIDATION_EMAIL,
    );
    expect(users.create).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters as validation", async () => {
    const users = stubUsers();

    await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "pat@example.com",
        password: "short",
      }),
      "validation",
      VALIDATION_PASSWORD,
    );
    expect(users.create).not.toHaveBeenCalled();
  });

  it("creates via users.create with ID.unique(), trimmed email, name, password, and no labels", async () => {
    const created = appwriteUser({
      $id: "user-unique-id",
      name: "Pat Reader",
      email: "pat@example.com",
      labels: [],
      status: true,
    });
    const users = stubUsers({ create: vi.fn().mockResolvedValue(created) });

    const record = await createReaderAccount(asUsers(users), {
      name: "  Pat Reader  ",
      email: "  pat@example.com  ",
      password: "password1",
    });

    expect(users.create).toHaveBeenCalledTimes(1);
    const payload = users.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toEqual({
      userId: "user-unique-id",
      email: "pat@example.com",
      password: "password1",
      name: "Pat Reader",
    });
    expect(payload).not.toHaveProperty("labels");
    expect(record).toEqual({
      id: "user-unique-id",
      name: "Pat Reader",
      email: "pat@example.com",
      role: "reader",
      status: "active",
      registered: created.$createdAt,
    });
  });

  it("omits name when it is blank and still passes no labels", async () => {
    const created = appwriteUser({ $id: "user-unique-id", name: "", labels: [] });
    const users = stubUsers({ create: vi.fn().mockResolvedValue(created) });

    await createReaderAccount(asUsers(users), {
      name: "   ",
      email: "pat@example.com",
      password: "password1",
    });

    const payload = users.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toEqual({
      userId: "user-unique-id",
      email: "pat@example.com",
      password: "password1",
    });
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("labels");
  });

  it("accepts an 8-character password", async () => {
    const created = appwriteUser({ $id: "user-unique-id" });
    const users = stubUsers({ create: vi.fn().mockResolvedValue(created) });

    await createReaderAccount(asUsers(users), {
      email: "pat@example.com",
      password: "12345678",
    });

    expect(users.create).toHaveBeenCalled();
  });

  it("maps Appwrite create failures to a fixed safe string", async () => {
    const users = stubUsers({
      create: vi.fn().mockRejectedValue(appwriteException()),
    });

    const err = await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "pat@example.com",
        password: "password1",
      }),
      "appwrite",
      SAFE_APPWRITE,
    );
    expect(err.message).toBe(SAFE_APPWRITE);
  });

  it("maps Appwrite 409 user_already_exists to a validation already-exists message (U1)", async () => {
    const users = stubUsers({
      create: vi.fn().mockRejectedValue(
        appwriteException({ code: 409, type: "user_already_exists" }),
      ),
    });

    await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "pat@example.com",
        password: "password1",
      }),
      "validation",
      ALREADY_EXISTS,
    );
  });

  it("maps Appwrite code 409 without type to the same already-exists message (U1)", async () => {
    const users = stubUsers({
      create: vi.fn().mockRejectedValue(appwriteException({ code: 409, type: "general_unknown" })),
    });

    await expectAdminError(
      createReaderAccount(asUsers(users), {
        email: "pat@example.com",
        password: "password1",
      }),
      "validation",
      ALREADY_EXISTS,
    );
  });
});

describe("listAccounts", () => {
  it("maps status:false to blocked and operator labels to role operator", async () => {
    const users = stubUsers({
      list: vi.fn().mockResolvedValue({
        total: 2,
        users: [
          appwriteUser({
            $id: "op-1",
            name: "Ada Operator",
            email: "ada@example.com",
            labels: ["operator"],
            status: true,
            $createdAt: "2026-01-01T00:00:00.000Z",
          }),
          appwriteUser({
            $id: "reader-2",
            name: "Blocked Pat",
            email: "blocked@example.com",
            labels: [],
            status: false,
            $createdAt: "2026-02-02T00:00:00.000Z",
          }),
        ],
      }),
    });

    await expect(listAccounts(asUsers(users))).resolves.toEqual([
      {
        id: "op-1",
        name: "Ada Operator",
        email: "ada@example.com",
        role: "operator",
        status: "active",
        registered: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "reader-2",
        name: "Blocked Pat",
        email: "blocked@example.com",
        role: "reader",
        status: "blocked",
        registered: "2026-02-02T00:00:00.000Z",
      },
    ]);
  });

  it("treats missing labels as reader", async () => {
    const users = stubUsers({
      list: vi.fn().mockResolvedValue({
        total: 1,
        users: [appwriteUser({ $id: "r-1", labels: undefined, status: true })],
      }),
    });

    const [record] = await listAccounts(asUsers(users));
    expect(record?.role).toBe("reader");
  });

  it("maps Appwrite list failures to a fixed safe string", async () => {
    const users = stubUsers({
      list: vi.fn().mockRejectedValue(appwriteException({ code: 401 })),
    });

    await expectAdminError(listAccounts(asUsers(users)), "appwrite", SAFE_APPWRITE);
  });

  it("paginates with cursorAfter until every user is returned (C6)", async () => {
    const page1 = Array.from({ length: ACCOUNT_LIST_PAGE_SIZE }, (_, i) =>
      appwriteUser({
        $id: `user-p1-${i}`,
        email: `p1-${i}@example.com`,
        name: `Page1 ${i}`,
      }),
    );
    const page2 = Array.from({ length: 5 }, (_, i) =>
      appwriteUser({
        $id: `user-p2-${i}`,
        email: `p2-${i}@example.com`,
        name: `Page2 ${i}`,
      }),
    );
    const lastId = page1[page1.length - 1]!.$id;
    const total = page1.length + page2.length;
    const users = stubUsers({
      list: vi.fn().mockImplementation((params?: { queries?: string[] }) => {
        const queries = params?.queries ?? [];
        const hasCursor = queries.some((q) => String(q).includes("cursorAfter"));
        if (!hasCursor) {
          return Promise.resolve({ total, users: page1 });
        }
        return Promise.resolve({ total, users: page2 });
      }),
    });

    const records = await listAccounts(asUsers(users));

    expect(records).toHaveLength(total);
    expect(records.map((r) => r.id)).toEqual([...page1, ...page2].map((u) => u.$id));
    expect(users.list).toHaveBeenCalledTimes(2);
    const firstQueries = (users.list.mock.calls[0]?.[0] as { queries: string[] }).queries;
    expect(firstQueries).toContain(Query.limit(ACCOUNT_LIST_PAGE_SIZE));
    expect(firstQueries.every((q) => !String(q).includes("cursorAfter"))).toBe(true);
    const secondQueries = (users.list.mock.calls[1]?.[0] as { queries: string[] }).queries;
    expect(secondQueries).toContain(Query.cursorAfter(lastId));
  });
});

describe("setAccountBlocked", () => {
  it("fetches the target and throws forbidden_target for an operator-labeled user", async () => {
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(appwriteUser({ $id: "op-1", labels: ["operator"] })),
    });

    await expectAdminError(
      setAccountBlocked(asUsers(users), "op-1", true),
      "forbidden_target",
      FORBIDDEN_TARGET,
    );
    expect(users.get).toHaveBeenCalledWith({ userId: "op-1" });
    expect(users.updateStatus).not.toHaveBeenCalled();
  });

  it("blocks a reader via updateStatus(false) after fetching", async () => {
    const reader = appwriteUser({ $id: "reader-1", labels: [], status: true });
    const blocked = { ...reader, status: false };
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(reader),
      updateStatus: vi.fn().mockResolvedValue(blocked),
    });

    const record = await setAccountBlocked(asUsers(users), "reader-1", true);

    expect(users.get).toHaveBeenCalledWith({ userId: "reader-1" });
    expect(users.updateStatus).toHaveBeenCalledWith({ userId: "reader-1", status: false });
    expect(record.status).toBe("blocked");
    expect(record.role).toBe("reader");
  });

  it("unblocks a reader via updateStatus(true)", async () => {
    const reader = appwriteUser({ $id: "reader-1", labels: [], status: false });
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(reader),
      updateStatus: vi.fn().mockResolvedValue({ ...reader, status: true }),
    });

    const record = await setAccountBlocked(asUsers(users), "reader-1", false);

    expect(users.updateStatus).toHaveBeenCalledWith({ userId: "reader-1", status: true });
    expect(record.status).toBe("active");
  });

  it("maps a missing target to not_found and does not mutate", async () => {
    const users = stubUsers({
      get: vi.fn().mockRejectedValue(appwriteException({ code: 404, type: "user_not_found" })),
    });

    await expectAdminError(
      setAccountBlocked(asUsers(users), "missing", true),
      "not_found",
      NOT_FOUND,
    );
    expect(users.updateStatus).not.toHaveBeenCalled();
  });
});

describe("resetAccountPassword", () => {
  it("rejects a password shorter than 8 characters before fetching", async () => {
    const users = stubUsers();

    await expectAdminError(
      resetAccountPassword(asUsers(users), "reader-1", "short"),
      "validation",
      VALIDATION_PASSWORD,
    );
    expect(users.get).not.toHaveBeenCalled();
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it("fetches the target and throws forbidden_target for an operator-labeled user", async () => {
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(appwriteUser({ $id: "op-1", labels: ["operator", "other"] })),
    });

    await expectAdminError(
      resetAccountPassword(asUsers(users), "op-1", "newpassword"),
      "forbidden_target",
      FORBIDDEN_TARGET,
    );
    expect(users.get).toHaveBeenCalledWith({ userId: "op-1" });
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it("resets a reader's password after fetching", async () => {
    const reader = appwriteUser({ $id: "reader-1", labels: [] });
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(reader),
      updatePassword: vi.fn().mockResolvedValue(reader),
    });

    await resetAccountPassword(asUsers(users), "reader-1", "newpassword");

    expect(users.get).toHaveBeenCalledWith({ userId: "reader-1" });
    expect(users.updatePassword).toHaveBeenCalledWith({
      userId: "reader-1",
      password: "newpassword",
    });
  });

  it("maps a missing target to not_found", async () => {
    const users = stubUsers({
      get: vi.fn().mockRejectedValue(appwriteException({ code: 404 })),
    });

    await expectAdminError(
      resetAccountPassword(asUsers(users), "missing", "newpassword"),
      "not_found",
      NOT_FOUND,
    );
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});

describe("deleteAccount", () => {
  it("fetches the target and throws forbidden_target for an operator-labeled user", async () => {
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(appwriteUser({ $id: "op-1", labels: ["operator"] })),
    });

    await expectAdminError(
      deleteAccount(asUsers(users), "op-1"),
      "forbidden_target",
      FORBIDDEN_TARGET,
    );
    expect(users.get).toHaveBeenCalledWith({ userId: "op-1" });
    expect(users.delete).not.toHaveBeenCalled();
  });

  it("deletes a reader after fetching", async () => {
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(appwriteUser({ $id: "reader-1", labels: [] })),
      delete: vi.fn().mockResolvedValue({}),
    });

    await deleteAccount(asUsers(users), "reader-1");

    expect(users.get).toHaveBeenCalledWith({ userId: "reader-1" });
    expect(users.delete).toHaveBeenCalledWith({ userId: "reader-1" });
  });

  it("maps a missing target to not_found", async () => {
    const users = stubUsers({
      get: vi.fn().mockRejectedValue(appwriteException({ code: 404 })),
    });

    await expectAdminError(deleteAccount(asUsers(users), "missing"), "not_found", NOT_FOUND);
    expect(users.delete).not.toHaveBeenCalled();
  });

  it("maps Appwrite delete failures to a fixed safe string", async () => {
    const users = stubUsers({
      get: vi.fn().mockResolvedValue(appwriteUser({ $id: "reader-1", labels: [] })),
      delete: vi.fn().mockRejectedValue(appwriteException()),
    });

    await expectAdminError(deleteAccount(asUsers(users), "reader-1"), "appwrite", SAFE_APPWRITE);
  });
});
