import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  user: { $id: "user-1", email: "op@example.com" },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

import { requireUser, UnauthorizedError } from "@/lib/auth/require-user";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockReset();
});

describe("requireUser", () => {
  it("rejects with UnauthorizedError when getAuthenticatedUser returns null", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("resolves to the authenticated user when the session is valid", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(mocks.user);

    await expect(requireUser()).resolves.toBe(mocks.user);
  });

  it("UnauthorizedError is an Error subclass named UnauthorizedError", () => {
    const error = new UnauthorizedError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UnauthorizedError");
  });
});
