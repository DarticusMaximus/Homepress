/// <reference types="@testing-library/jest-dom" />

/**
 * Feature 02 Task 5: `?edit=` redirects to `/newsletters/[id]`.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import type { Newsletter } from "@newsletter/shared";

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
  updatedAt: "2026-07-01T00:00:00.000Z",
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

describe("Newsletters page — ?edit= redirect", () => {
  it("redirects /newsletters?edit=<id> to /newsletters/<id>", async () => {
    const { default: NewslettersPage } = await import("@/app/(protected)/newsletters/page");

    await expect(
      NewslettersPage({ searchParams: Promise.resolve({ edit: NEWSLETTER.$id }) }),
    ).rejects.toThrow(`NEXT_REDIRECT:/newsletters/${NEWSLETTER.$id}`);

    expect(mocks.redirect).toHaveBeenCalledWith(`/newsletters/${NEWSLETTER.$id}`);
  });

  it("redirects even when the id is not on the current list page slice", async () => {
    const offPage = makeNewsletter({
      $id: "nl-off-page",
      name: "AAA Off Page",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    mocks.listNewsletters.mockResolvedValue([NEWSLETTER, offPage]);

    const { default: NewslettersPage } = await import("@/app/(protected)/newsletters/page");

    await expect(
      NewslettersPage({ searchParams: Promise.resolve({ edit: offPage.$id }) }),
    ).rejects.toThrow(`NEXT_REDIRECT:/newsletters/${offPage.$id}`);

    expect(mocks.redirect).toHaveBeenCalledWith(`/newsletters/${offPage.$id}`);
  });

  it("does not redirect when edit search param is absent", async () => {
    const { default: NewslettersPage } = await import("@/app/(protected)/newsletters/page");

    await NewslettersPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects before loading when edit is present (whitespace trimmed)", async () => {
    const { default: NewslettersPage } = await import("@/app/(protected)/newsletters/page");

    await expect(
      NewslettersPage({ searchParams: Promise.resolve({ edit: `  ${NEWSLETTER.$id}  ` }) }),
    ).rejects.toThrow(`NEXT_REDIRECT:/newsletters/${NEWSLETTER.$id}`);

    expect(mocks.listNewsletters).not.toHaveBeenCalled();
  });
});
