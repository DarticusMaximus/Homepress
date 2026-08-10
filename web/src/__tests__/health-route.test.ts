import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(),
  getAppwriteConfig: vi.fn(),
  list: vi.fn(),
  client: { $id: "mock-client" },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    getAppwriteConfig: mocks.getAppwriteConfig,
  };
});

vi.mock("node-appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-appwrite")>();
  return {
    ...actual,
    Databases: class {
      list = mocks.list;
    },
  };
});

import { GET } from "@/app/health/route";

const DISCLOSURE_KEYS = [
  "appwrite",
  "endpoint",
  "project",
  "authenticated",
  "reachable",
] as const;

beforeEach(() => {
  mocks.getServerAppwrite.mockReset();
  mocks.getAppwriteConfig.mockReset();
  mocks.list.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.getAppwriteConfig.mockReturnValue({
    endpoint: "https://cloud.appwrite.io/v1",
    projectId: "proj-secret",
    apiKey: "secret-key",
  });
});

describe("GET /health (S2 minimal public contract)", () => {
  it("returns 200 with body exactly { status: \"ok\" } when Databases.list succeeds", async () => {
    mocks.list.mockResolvedValue({ total: 0, databases: [] });

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    for (const key of DISCLOSURE_KEYS) {
      expect(body, `success body must not disclose "${key}"`).not.toHaveProperty(key);
    }
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalled();
  });

  it("returns 503 with degraded message only when Databases.list fails", async () => {
    mocks.list.mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "degraded",
      message: "Appwrite handshake failed",
    });
    for (const key of DISCLOSURE_KEYS) {
      expect(body, `degraded body must not disclose "${key}"`).not.toHaveProperty(key);
    }
  });
});
