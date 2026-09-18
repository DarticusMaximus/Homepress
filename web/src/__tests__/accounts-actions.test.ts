import { describe, it, expect, vi, beforeEach } from "vitest";
import { Users } from "node-appwrite";
import { AccountAdminError } from "@/lib/accounts/account-admin";
import { ForbiddenError } from "@/lib/auth/require-operator";

const mocks = vi.hoisted(() => ({
  requireOperator: vi.fn(),
  createReaderAccount: vi.fn(),
  setAccountBlocked: vi.fn(),
  resetAccountPassword: vi.fn(),
  deleteAccount: vi.fn(),
  getServerAppwrite: vi.fn(),
  revalidatePath: vi.fn(),
  user: { $id: "op-1", email: "op@example.com", labels: ["operator"] },
  client: { $id: "mock-client" },
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
  };
});

vi.mock("@/lib/auth/require-operator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-operator")>();
  return {
    ...actual,
    requireOperator: mocks.requireOperator,
  };
});

vi.mock("@/lib/accounts/account-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accounts/account-admin")>();
  return {
    ...actual,
    createReaderAccount: mocks.createReaderAccount,
    setAccountBlocked: mocks.setAccountBlocked,
    resetAccountPassword: mocks.resetAccountPassword,
    deleteAccount: mocks.deleteAccount,
  };
});

import {
  createReaderAccountAction,
  deleteReaderAccountAction,
  resetReaderPasswordAction,
  setAccountBlockedAction,
} from "@/app/(protected)/admin/accounts/actions";

const FORBIDDEN_TARGET = "Operator accounts cannot be blocked, reset, or deleted";
const readerRecord = {
  id: "reader-1",
  name: "Pat Reader",
  email: "pat@example.com",
  role: "reader" as const,
  status: "active" as const,
  registered: "2026-09-17T12:00:00.000Z",
};

function createFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "Pat Reader");
  fd.set("email", "pat@example.com");
  fd.set("password", "password1");
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  mocks.requireOperator.mockReset();
  mocks.createReaderAccount.mockReset();
  mocks.setAccountBlocked.mockReset();
  mocks.resetAccountPassword.mockReset();
  mocks.deleteAccount.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.requireOperator.mockResolvedValue(mocks.user);
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.createReaderAccount.mockResolvedValue(readerRecord);
  mocks.setAccountBlocked.mockResolvedValue({ ...readerRecord, status: "blocked" });
  mocks.resetAccountPassword.mockResolvedValue(readerRecord);
  mocks.deleteAccount.mockResolvedValue(undefined);
});

describe("createReaderAccountAction", () => {
  it("rejects with ForbiddenError and does not create when the session user is a reader", async () => {
    mocks.requireOperator.mockRejectedValue(new ForbiddenError());

    await expect(createReaderAccountAction(null, createFormData())).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.createReaderAccount).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("creates a reader via the lib and revalidates after requireOperator resolves", async () => {
    const result = await createReaderAccountAction(null, createFormData());

    expect(result).toEqual({ ok: true });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.requireOperator.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createReaderAccount.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getServerAppwrite).toHaveBeenCalledTimes(1);
    expect(mocks.createReaderAccount).toHaveBeenCalledTimes(1);
    expect(mocks.createReaderAccount).toHaveBeenCalledWith(expect.any(Users), {
      name: "Pat Reader",
      email: "pat@example.com",
      password: "password1",
    });
    expect(mocks.createReaderAccount.mock.calls[0]![0]).toBeInstanceOf(Users);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/accounts");
  });

  it("maps AccountAdminError validation to the error envelope and does not revalidate", async () => {
    mocks.createReaderAccount.mockRejectedValue(
      new AccountAdminError("validation", "Password must be at least 8 characters"),
    );

    const result = await createReaderAccountAction(null, createFormData({ password: "short" }));

    expect(result).toEqual({
      ok: false,
      error: "Password must be at least 8 characters",
    });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.createReaderAccount).toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setAccountBlockedAction", () => {
  it("rejects with ForbiddenError and does not mutate when the session user is a reader", async () => {
    mocks.requireOperator.mockRejectedValue(new ForbiddenError());

    await expect(
      setAccountBlockedAction(null, createFormData({ userId: "reader-1", blocked: "true" })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.setAccountBlocked).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("blocks a reader via the lib and revalidates after requireOperator resolves", async () => {
    const result = await setAccountBlockedAction(
      null,
      createFormData({ userId: "reader-1", blocked: "true" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.requireOperator.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAccountBlocked.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getServerAppwrite).toHaveBeenCalledTimes(1);
    expect(mocks.setAccountBlocked).toHaveBeenCalledTimes(1);
    expect(mocks.setAccountBlocked).toHaveBeenCalledWith(expect.any(Users), "reader-1", true);
    expect(mocks.setAccountBlocked.mock.calls[0]![0]).toBeInstanceOf(Users);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/accounts");
  });

  it("unblocks when blocked is not the string true", async () => {
    mocks.setAccountBlocked.mockResolvedValue(readerRecord);

    const result = await setAccountBlockedAction(
      null,
      createFormData({ userId: "reader-1", blocked: "false" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.setAccountBlocked).toHaveBeenCalledWith(expect.any(Users), "reader-1", false);
  });

  it("maps forbidden_target to a fixed message and does not revalidate", async () => {
    mocks.setAccountBlocked.mockRejectedValue(
      new AccountAdminError("forbidden_target", FORBIDDEN_TARGET),
    );

    const result = await setAccountBlockedAction(
      null,
      createFormData({ userId: "op-1", blocked: "true" }),
    );

    expect(result).toEqual({ ok: false, error: FORBIDDEN_TARGET });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.setAccountBlocked).toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("resetReaderPasswordAction", () => {
  it("rejects with ForbiddenError and does not reset when the session user is a reader", async () => {
    mocks.requireOperator.mockRejectedValue(new ForbiddenError());

    await expect(
      resetReaderPasswordAction(
        null,
        createFormData({ userId: "reader-1", password: "newpassword" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.resetAccountPassword).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("resets a reader password via the lib and revalidates after requireOperator resolves", async () => {
    const result = await resetReaderPasswordAction(
      null,
      createFormData({ userId: "reader-1", password: "newpassword" }),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.requireOperator.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resetAccountPassword.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getServerAppwrite).toHaveBeenCalledTimes(1);
    expect(mocks.resetAccountPassword).toHaveBeenCalledTimes(1);
    expect(mocks.resetAccountPassword).toHaveBeenCalledWith(
      expect.any(Users),
      "reader-1",
      "newpassword",
    );
    expect(mocks.resetAccountPassword.mock.calls[0]![0]).toBeInstanceOf(Users);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/accounts");
  });

  it("maps forbidden_target to a fixed message and does not revalidate", async () => {
    mocks.resetAccountPassword.mockRejectedValue(
      new AccountAdminError("forbidden_target", FORBIDDEN_TARGET),
    );

    const result = await resetReaderPasswordAction(
      null,
      createFormData({ userId: "op-1", password: "newpassword" }),
    );

    expect(result).toEqual({ ok: false, error: FORBIDDEN_TARGET });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.resetAccountPassword).toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteReaderAccountAction", () => {
  it("rejects with ForbiddenError and does not delete when the session user is a reader", async () => {
    mocks.requireOperator.mockRejectedValue(new ForbiddenError());

    await expect(
      deleteReaderAccountAction(null, createFormData({ userId: "reader-1" })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes a reader via the lib and revalidates after requireOperator resolves", async () => {
    const result = await deleteReaderAccountAction(null, createFormData({ userId: "reader-1" }));

    expect(result).toEqual({ ok: true });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.requireOperator.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteAccount.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getServerAppwrite).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAccount).toHaveBeenCalledWith(expect.any(Users), "reader-1");
    expect(mocks.deleteAccount.mock.calls[0]![0]).toBeInstanceOf(Users);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/accounts");
  });

  it("maps forbidden_target to a fixed message and does not revalidate", async () => {
    mocks.deleteAccount.mockRejectedValue(
      new AccountAdminError("forbidden_target", FORBIDDEN_TARGET),
    );

    const result = await deleteReaderAccountAction(null, createFormData({ userId: "op-1" }));

    expect(result).toEqual({ ok: false, error: FORBIDDEN_TARGET });
    expect(mocks.requireOperator).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAccount).toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
