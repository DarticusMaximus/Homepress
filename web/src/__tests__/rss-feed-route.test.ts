import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NewsletterRepositoryError,
  sanitizeAppwriteMessageForLog,
} from "@newsletter/shared";
import type { ResolvedOperatorSettings } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(),
  getNewsletter: vi.fn(),
  listRssPublications: vi.fn(),
  resolveEffectiveAppPublicUrl: vi.fn(),
  resolveOperatorSettings: vi.fn(),
  client: { $id: "mock-client" },
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    getNewsletter: mocks.getNewsletter,
    listRssPublications: mocks.listRssPublications,
    resolveEffectiveAppPublicUrl: mocks.resolveEffectiveAppPublicUrl,
    resolveOperatorSettings: mocks.resolveOperatorSettings,
  };
});

import { GET } from "@/app/rss/[newsletterId]/route";

const NEWSLETTER_ID = "nl-feed-1";
const ENV_PUBLIC_URL = "https://env.example.test";
const GUI_PUBLIC_URL = "https://gui.example.test";

function baseResolved(
  overrides: Partial<ResolvedOperatorSettings> = {},
): ResolvedOperatorSettings {
  return {
    openRouterApiKey: { value: null, source: "none" },
    smtp: { value: null, source: "none" },
    appPublicUrl: { value: GUI_PUBLIC_URL, source: "gui" },
    scoreThreshold: { value: 5, source: "default" },
    crossRunSimilarityThreshold: { value: 0.85, source: "default" },
    rssFeedMaxItems: { value: 10, source: "default" },
    drafterReasoningEffort: { value: "high", source: "default" },
    drafterMaxCompletionTokens: { value: 32000, source: "default" },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getServerAppwrite.mockReset();
  mocks.getNewsletter.mockReset();
  mocks.listRssPublications.mockReset();
  mocks.resolveEffectiveAppPublicUrl.mockReset();
  mocks.resolveOperatorSettings.mockReset();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  // Intentionally unresolved — route must not rely on a second Appwrite-backed resolve.
  mocks.resolveEffectiveAppPublicUrl.mockRejectedValue(
    new Error("resolveEffectiveAppPublicUrl must not be called on the RSS path"),
  );
  mocks.resolveOperatorSettings.mockResolvedValue(baseResolved());
  process.env.APP_PUBLIC_URL = ENV_PUBLIC_URL;
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
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");

    const body = await response.text();
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain("<rss ");
    expect(body).toContain("Daily AI");
    expect(body).toContain("Issue One");
    expect(body).toContain(`${GUI_PUBLIC_URL}/rss/${NEWSLETTER_ID}.xml`);
    expect(body).not.toContain(ENV_PUBLIC_URL);
    expect(mocks.getServerAppwrite).toHaveBeenCalled();
    expect(mocks.getNewsletter).toHaveBeenCalledWith(mocks.client, NEWSLETTER_ID);
    // C3/N3: single cascade read — limit + feed URL from that snapshot.
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledWith(mocks.client);
    expect(mocks.resolveEffectiveAppPublicUrl).not.toHaveBeenCalled();
    expect(mocks.listRssPublications).toHaveBeenCalledWith(mocks.client, NEWSLETTER_ID, {
      limit: 10,
    });
  });

  it("lists with resolved rssFeedMaxItems limit (Stage 12)", async () => {
    mocks.getNewsletter.mockResolvedValue({
      $id: NEWSLETTER_ID,
      name: "Daily AI",
    });
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        rssFeedMaxItems: { value: 3, source: "gui" },
      }),
    );
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
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.resolveEffectiveAppPublicUrl).not.toHaveBeenCalled();
    expect(mocks.listRssPublications).toHaveBeenCalledWith(mocks.client, NEWSLETTER_ID, {
      limit: 3,
    });
  });

  it("builds feed URLs from the same resolve snapshot as last-N (C3/N3)", async () => {
    mocks.getNewsletter.mockResolvedValue({
      $id: NEWSLETTER_ID,
      name: "Daily AI",
    });
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        appPublicUrl: { value: GUI_PUBLIC_URL, source: "gui" },
        rssFeedMaxItems: { value: 7, source: "gui" },
      }),
    );
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

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.resolveEffectiveAppPublicUrl).not.toHaveBeenCalled();
    expect(mocks.listRssPublications).toHaveBeenCalledWith(mocks.client, NEWSLETTER_ID, {
      limit: 7,
    });
    expect(body).toContain(`${GUI_PUBLIC_URL}/rss/${NEWSLETTER_ID}.xml`);
    expect(body).not.toContain(ENV_PUBLIC_URL);
  });

  it("returns 500 with a fixed generic body when resolved public URL is missing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    mocks.resolveOperatorSettings.mockResolvedValue(
      baseResolved({
        appPublicUrl: { value: null, source: "none" },
      }),
    );

    const response = await GET(new Request("http://localhost/rss/nl-feed-1"), {
      params: Promise.resolve({ newsletterId: NEWSLETTER_ID }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(body).toBe("RSS feed is temporarily unavailable.");
    expect(body).not.toMatch(/APP_PUBLIC_URL|Settings|gui\.example|env\.example/i);

    expect(consoleError).toHaveBeenCalled();
    const loggedText = consoleError.mock.calls
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    expect(loggedText).toContain(
      sanitizeAppwriteMessageForLog(
        "Missing public URL. Set it in Settings or APP_PUBLIC_URL.",
      ),
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "rss-route-public-url" }),
    );

    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.resolveEffectiveAppPublicUrl).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns 404 when the newsletter is missing (case 16)", async () => {
    mocks.getNewsletter.mockRejectedValue(
      new NewsletterRepositoryError("not_found", "Newsletter not found"),
    );

    const response = await GET(new Request("http://localhost/rss/missing"), {
      params: Promise.resolve({ newsletterId: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listRssPublications).not.toHaveBeenCalled();
    expect(mocks.resolveOperatorSettings).not.toHaveBeenCalled();
    expect(mocks.resolveEffectiveAppPublicUrl).not.toHaveBeenCalled();
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
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.resolveOperatorSettings).toHaveBeenCalledTimes(1);
    expect(mocks.resolveEffectiveAppPublicUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["dot-dot", ".."],
    ["slash", "a/b"],
    ["600-char alphanumeric", "a".repeat(600)],
    ["URL-encoded slash", "%2F"],
  ] as const)(
    "returns 404 with no-store and never constructs Appwrite for malformed id (%s)",
    async (_label, newsletterId) => {
      const response = await GET(new Request(`http://localhost/rss/${newsletterId}`), {
        params: Promise.resolve({ newsletterId }),
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.getServerAppwrite).not.toHaveBeenCalled();
      expect(mocks.getNewsletter).not.toHaveBeenCalled();
      expect(mocks.listRssPublications).not.toHaveBeenCalled();
      expect(mocks.resolveOperatorSettings).not.toHaveBeenCalled();
    },
  );
});
