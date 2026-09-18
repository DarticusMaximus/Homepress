import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  reader: { $id: "user-1", email: "reader@example.com", labels: [] as string[] },
  operator: { $id: "user-1", email: "op@example.com", labels: ["operator"] },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import AdminLayout from "@/app/(protected)/admin/layout";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockReset();
  mocks.redirect.mockClear();
});

describe("admin layout role gate", () => {
  const children = "factory page";

  it("redirects a reader to /", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(mocks.reader);

    await expect(AdminLayout({ children })).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("redirects an unauthenticated session to /", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    await expect(AdminLayout({ children })).rejects.toThrow("NEXT_REDIRECT:/");

    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("renders children for an operator", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(mocks.operator);

    await expect(AdminLayout({ children })).resolves.toBe(children);

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
