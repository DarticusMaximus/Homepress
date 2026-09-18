import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  reader: { $id: "user-1", email: "reader@example.com" },
  operator: { $id: "user-1", email: "op@example.com", labels: ["operator"] },
}));

vi.mock("@/lib/auth/require-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-user")>();
  return {
    ...actual,
    requireUser: mocks.requireUser,
  };
});

import { UnauthorizedError } from "@/lib/auth/require-user";
import { requireOperator, ForbiddenError, isOperator } from "@/lib/auth/require-operator";

beforeEach(() => {
  mocks.requireUser.mockReset();
});

describe("requireOperator", () => {
  it("rejects with UnauthorizedError when requireUser rejects (no session)", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    await expect(requireOperator()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects with ForbiddenError when the session user lacks the operator label", async () => {
    mocks.requireUser.mockResolvedValue(mocks.reader);

    await expect(requireOperator()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves to the authenticated user when the operator label is present", async () => {
    mocks.requireUser.mockResolvedValue(mocks.operator);

    await expect(requireOperator()).resolves.toBe(mocks.operator);
  });

  it("ForbiddenError is an Error subclass named ForbiddenError", () => {
    const error = new ForbiddenError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ForbiddenError");
  });
});

describe("isOperator", () => {
  it("treats missing labels as reader", () => {
    expect(isOperator({})).toBe(false);
    expect(isOperator({ labels: undefined })).toBe(false);
  });

  it("returns false when labels are empty or do not include operator", () => {
    expect(isOperator({ labels: [] })).toBe(false);
    expect(isOperator({ labels: ["reader"] })).toBe(false);
  });

  it("returns true when labels include operator", () => {
    expect(isOperator({ labels: ["operator"] })).toBe(true);
  });
});
