import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueLoadError } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(),
  prepareIssueExport: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  client: { $id: "mock-client" },
  user: { $id: "user-1", email: "op@example.com" },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    prepareIssueExport: mocks.prepareIssueExport,
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

import { GET } from "@/app/api/issues/[runId]/export/route";

const RUN_ID = "run-export-1";

function exportRequest(format?: string): Request {
  const url =
    format === undefined
      ? `http://localhost/api/issues/${RUN_ID}/export`
      : `http://localhost/api/issues/${RUN_ID}/export?format=${format}`;
  return new Request(url);
}

beforeEach(() => {
  mocks.getServerAppwrite.mockReset();
  mocks.prepareIssueExport.mockReset();
  mocks.getAuthenticatedUser.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.getAuthenticatedUser.mockResolvedValue(mocks.user);
});

describe("GET /api/issues/[runId]/export (cases 7–11)", () => {
  it("returns 401 and does not call prepareIssueExport when unauthenticated (S3)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await GET(exportRequest("md"), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(await response.text()).toBe("Unauthorized");
    expect(mocks.prepareIssueExport).not.toHaveBeenCalled();
    expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
  });

  it("returns 200 markdown attachment with Content-Disposition .md (case 7)", async () => {
    mocks.prepareIssueExport.mockResolvedValue({
      body: "# Hello\n\nBody text.",
      contentType: "text/markdown; charset=utf-8",
      filename: "tech-digest-2026-07-17.md",
    });

    const response = await GET(exportRequest("md"), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="tech-digest-2026-07-17.md"',
    );
    expect(await response.text()).toBe("# Hello\n\nBody text.");
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.prepareIssueExport).toHaveBeenCalledWith(mocks.client, RUN_ID, "md");
  });

  it("returns 200 HTML attachment with body equal to mocked HTML (case 8)", async () => {
    const htmlBody = "<p>Hello <strong>world</strong></p>";
    mocks.prepareIssueExport.mockResolvedValue({
      body: htmlBody,
      contentType: "text/html; charset=utf-8",
      filename: "tech-digest-2026-07-17.html",
    });

    const response = await GET(exportRequest("html"), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="tech-digest-2026-07-17.html"',
    );
    expect(await response.text()).toBe(htmlBody);
    expect(mocks.prepareIssueExport).toHaveBeenCalledWith(mocks.client, RUN_ID, "html");
  });

  it("returns 400 Invalid export format for pdf or missing format (case 9)", async () => {
    const pdfResponse = await GET(exportRequest("pdf"), {
      params: Promise.resolve({ runId: RUN_ID }),
    });
    expect(pdfResponse.status).toBe(400);
    expect(pdfResponse.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(await pdfResponse.text()).toBe("Invalid export format");
    expect(mocks.prepareIssueExport).not.toHaveBeenCalled();

    const missingResponse = await GET(exportRequest(), {
      params: Promise.resolve({ runId: RUN_ID }),
    });
    expect(missingResponse.status).toBe(400);
    expect(missingResponse.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(await missingResponse.text()).toBe("Invalid export format");
    expect(mocks.prepareIssueExport).not.toHaveBeenCalled();
  });

  it("returns 404 when prepare/load fails (case 10)", async () => {
    mocks.prepareIssueExport.mockRejectedValue(
      new IssueLoadError("not_found", "Run not found"),
    );

    const response = await GET(exportRequest("md"), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(await response.text()).toBe("Couldn’t load this issue for export");
  });

  it("returns 400 when the draft is empty (case 11)", async () => {
    mocks.prepareIssueExport.mockRejectedValue(new Error("Issue draft is empty"));

    const response = await GET(exportRequest("html"), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(await response.text()).toBe("Issue draft is empty");
  });
});
