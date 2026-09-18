import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  publishIssueToRss: vi.fn(),
  getServerAppwrite: vi.fn(),
  requireOperator: vi.fn(),
  client: { $id: "mock-client" },
  user: { $id: "user-1", email: "op@example.com", labels: ["operator"] },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    publishIssueToRss: mocks.publishIssueToRss,
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
import { publishIssueToRssAction } from "@/app/(protected)/issues/actions";

beforeEach(() => {
  mocks.publishIssueToRss.mockReset();
  mocks.getServerAppwrite.mockReset();
  mocks.requireOperator.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.requireOperator.mockResolvedValue(mocks.user);
});

describe("publishIssueToRssAction (case 18)", () => {
  it("rejects with UnauthorizedError and does not call publishIssueToRss when unauthenticated (S4)", async () => {
    mocks.requireOperator.mockRejectedValue(new UnauthorizedError());

    await expect(publishIssueToRssAction("run-1")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(mocks.publishIssueToRss).not.toHaveBeenCalled();
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
  });

  it("returns ok with newsletterId and runId when shared publish succeeds", async () => {
    mocks.publishIssueToRss.mockResolvedValue({
      ok: true,
      newsletterId: "nl-1",
      runId: "run-1",
    });

    const result = await publishIssueToRssAction("run-1");

    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.publishIssueToRss).toHaveBeenCalledWith(mocks.client, "run-1");
    expect(result).toEqual({
      ok: true,
      newsletterId: "nl-1",
      runId: "run-1",
    });
  });

  it("returns ok:false with operator-facing error when shared publish fails", async () => {
    mocks.publishIssueToRss.mockResolvedValue({
      ok: false,
      error: "Failed to publish to RSS",
    });

    const result = await publishIssueToRssAction("run-1");

    expect(result).toEqual({
      ok: false,
      error: "Failed to publish to RSS",
    });
  });

  it("returns a generic error when shared publish throws unexpectedly", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.publishIssueToRss.mockRejectedValue(new Error("boom"));

    const result = await publishIssueToRssAction("run-1");

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    consoleSpy.mockRestore();
  });
});
