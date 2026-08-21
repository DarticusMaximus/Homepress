/**
 * Feature 08 Task 2 (S2): `?edit=` must only redirect for safe document ids.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import type { Newsletter } from "@newsletter/shared";
import { isSafeNewsletterId } from "@/lib/newsletter-id";

describe("isSafeNewsletterId", () => {
  it.each(["nl-1", "abc123", "Newsletter_Doc-9", "a", "A_b-C0"])(
    "accepts well-formed id %j",
    (id) => {
      expect(isSafeNewsletterId(id)).toBe(true);
    },
  );

  it.each([
    "",
    "../schedules",
    "a/b",
    "nl.1",
    "..",
    ".",
    "a?b",
    "a#b",
    "nl 1",
    "nl%2e1",
    "/newsletters/nl-1",
    "nl-1/../schedules",
  ])("rejects malformed id %j", (id) => {
    expect(isSafeNewsletterId(id)).toBe(false);
  });
});

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  listNewsletters: vi.fn(),
  getNewsletter: vi.fn(),
  listFeeds: vi.fn(),
  listAttachmentsForNewsletter: vi.fn(),
  findActiveRunForNewsletter: vi.fn(),
  getServerAppwrite: vi.fn(() => ({ $id: "mock-client" })),
  resolveAppPublicUrl: vi.fn(() => "https://example.com"),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    listNewsletters: mocks.listNewsletters,
    getNewsletter: mocks.getNewsletter,
    listFeeds: mocks.listFeeds,
    listAttachmentsForNewsletter: mocks.listAttachmentsForNewsletter,
    findActiveRunForNewsletter: mocks.findActiveRunForNewsletter,
    getServerAppwrite: mocks.getServerAppwrite,
    resolveAppPublicUrl: mocks.resolveAppPublicUrl,
  };
});

function makeNewsletter(overrides: Partial<Newsletter> & Pick<Newsletter, "$id" | "name">): Newsletter {
  return {
    topics: ["ai"],
    dislikedTopics: [],
    audience: "engineers",
    newsItems: 16,
    dateRange: "yesterday",
    lookback: 3,
    taggerModel: "",
    scorerModel: "",
    drafterModel: "",
    embedderModel: "",
    titleDekModel: "",
    drafterPrompt: "",
    scheduleEnabled: false,
    scheduleCron: "",
    scheduleTimezone: "UTC",
    scheduleLastFiredAt: null,
    recipientEmails: [],
    autoEmail: false,
    autoRss: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const NEWSLETTER = makeNewsletter({
  $id: "nl-1",
  name: "Daily AI",
});

beforeEach(() => {
  mocks.redirect.mockClear();
  mocks.listNewsletters.mockReset();
  mocks.getNewsletter.mockReset();
  mocks.listFeeds.mockResolvedValue([]);
  mocks.listAttachmentsForNewsletter.mockResolvedValue([]);
  mocks.findActiveRunForNewsletter.mockResolvedValue(null);
  mocks.listNewsletters.mockResolvedValue([NEWSLETTER]);
});

afterEach(() => {
  cleanup();
});

describe("Newsletters page — ?edit= redirect sanitization (S2)", () => {
  it("redirects edit=nl-1 to /admin/newsletters/nl-1", async () => {
    const { default: NewslettersPage } = await import("@/app/(protected)/admin/newsletters/page");

    await expect(
      NewslettersPage({ searchParams: Promise.resolve({ edit: "nl-1" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/newsletters/nl-1");

    expect(mocks.redirect).toHaveBeenCalledWith("/admin/newsletters/nl-1");
  });

  it.each(["../schedules", "a/b", "nl.1", "a?b", "a#b", "nl 1"])(
    "ignores malformed edit=%j (no redirect / no path escape)",
    async (edit) => {
      const { default: NewslettersPage } = await import("@/app/(protected)/admin/newsletters/page");

      await NewslettersPage({ searchParams: Promise.resolve({ edit }) });

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.listNewsletters).toHaveBeenCalled();
    },
  );

  it("ignores empty edit after trim", async () => {
    const { default: NewslettersPage } = await import("@/app/(protected)/admin/newsletters/page");

    await NewslettersPage({ searchParams: Promise.resolve({ edit: "   " }) });

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
