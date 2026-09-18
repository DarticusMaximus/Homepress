import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendIssueEmail: vi.fn(),
  getServerAppwrite: vi.fn(),
  requireOperator: vi.fn(),
  client: { $id: "mock-client" },
  user: { $id: "user-1", email: "op@example.com", labels: ["operator"] },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    sendIssueEmail: mocks.sendIssueEmail,
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

import { UnauthorizedError } from "@/lib/auth/require-user";
import { sendIssueEmailAction } from "@/app/(protected)/issues/actions";

beforeEach(() => {
  mocks.sendIssueEmail.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.requireOperator.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.requireOperator.mockResolvedValue(mocks.user);
});

describe("sendIssueEmailAction", () => {
  it("rejects with UnauthorizedError and does not call sendIssueEmail when unauthenticated (S4)", async () => {
    mocks.requireOperator.mockRejectedValue(new UnauthorizedError());

    await expect(sendIssueEmailAction("run-1")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(mocks.sendIssueEmail).not.toHaveBeenCalled();
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
  });

  it("returns ok with recipientCount when shared send succeeds (case 13)", async () => {
    mocks.sendIssueEmail.mockResolvedValue({ ok: true, recipientCount: 3 });

    const result = await sendIssueEmailAction("run-1");

    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.sendIssueEmail).toHaveBeenCalledWith(mocks.client, "run-1");
    expect(result).toEqual({ ok: true, recipientCount: 3 });
  });

  it("returns ok:false with operator-facing error when shared send fails (case 14)", async () => {
    mocks.sendIssueEmail.mockResolvedValue({
      ok: false,
      error: "No recipients configured for this newsletter",
    });

    const result = await sendIssueEmailAction("run-1");

    expect(result).toEqual({
      ok: false,
      error: "No recipients configured for this newsletter",
    });
  });

  it("returns a generic error when shared send throws unexpectedly", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendIssueEmail.mockRejectedValue(new Error("boom"));

    const result = await sendIssueEmailAction("run-1");

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    consoleSpy.mockRestore();
  });
});
