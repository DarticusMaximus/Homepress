import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NewsletterRepositoryError } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(),
  getNewsletter: vi.fn(),
  listRssPublications: vi.fn(),
  client: { $id: "mock-client" },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    getNewsletter: mocks.getNewsletter,
    listRssPublications: mocks.listRssPublications,
  };
});

import { GET } from "@/app/rss/[newsletterId]/route";

const NEWSLETTER_ID = "nl-feed-1";
const APP_PUBLIC_URL = "https://news.example.test";

beforeEach(() => {
  mocks.getServerAppwrite.mockReset();
  mocks.getNewsletter.mockReset();
  mocks.listRssPublications.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  process.env.APP_PUBLIC_URL = APP_PUBLIC_URL;
});

afterEach(() => {
  delete process.env.APP_PUBLIC_URL;
});

describe("GET /rss/[newsletterId] (cases 15–16)", () => {
  it("returns 200 with RSS XML and application/rss+xml when publications exist (case 15)", async () => {
    mocks.getNewsletter.mockResolvedValue({
      $id: NEWSLETTER_ID,
      name: "Daily AI",
    });
    mocks.listRssPublications.mockResolvedValue([
      {
        $id: "run-1",
        newsletterId: NEWSLETTER_ID,
        runId: "run-1",
        title: "Issue One",
        htmlBody: "<p>Hello</p>",
        pubDate: "2026-07-15T12:00:00.000Z",
        updatedAt: "2026-07-15T12:05:00.000Z",
      },
    ]);

    const response = await GET(new Request("http://localhost/rss/nl-feed-1"), {
      params: Promise.resolve({ newsletterId: NEWSLETTER_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/application\/rss\+xml/);

    const body = await response.text();
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain("<rss ");
    expect(body).toContain("Daily AI");
    expect(body).toContain("Issue One");
    expect(body).toContain(`${APP_PUBLIC_URL}/rss/${NEWSLETTER_ID}.xml`);
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.getNewsletter).toHaveBeenCalledWith(mocks.client, NEWSLETTER_ID);
    expect(mocks.listRssPublications).toHaveBeenCalledWith(mocks.client, NEWSLETTER_ID);
  });

  it("returns 404 when the newsletter is missing (case 16)", async () => {
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const response = await GET(new Request("http://localhost/rss/missing"), {
      params: Promise.resolve({ newsletterId: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.listRssPublications).not.toHaveBeenCalled();
  });

  it("returns 404 when there are zero publication snapshots (case 16)", async () => {
    mocks.getNewsletter.mockResolvedValue({
      $id: NEWSLETTER_ID,
      name: "Daily AI",
    });
    mocks.listRssPublications.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/rss/nl-feed-1"), {
      params: Promise.resolve({ newsletterId: NEWSLETTER_ID }),
    });

    expect(response.status).toBe(404);
  });
});
