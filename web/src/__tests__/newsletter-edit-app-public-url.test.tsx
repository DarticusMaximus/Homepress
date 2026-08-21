/**
 * Feature 04 Task 4: newsletter edit page must resolve appPublicUrl via Stage 12
 * effective helper — not env-only resolveAppPublicUrl alone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Newsletter } from "@newsletter/shared";
import { AppPublicUrlError } from "@newsletter/shared";

const mocks = vi.hoisted(() => ({
  getServerAppwrite: vi.fn(),
  getNewsletter: vi.fn(),
  listFeeds: vi.fn(),
  listAttachmentsForNewsletter: vi.fn(),
  resolveEffectiveAppPublicUrl: vi.fn(),
  resolveAppPublicUrl: vi.fn(),
  client: { $id: "mock-client" },
  NewsletterEditForm: vi.fn(
    (_props: {
      newsletter: Newsletter;
      feeds: unknown;
      appPublicUrl?: string | null;
    }) => null,
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    getServerAppwrite: mocks.getServerAppwrite,
    getNewsletter: mocks.getNewsletter,
    listFeeds: mocks.listFeeds,
    listAttachmentsForNewsletter: mocks.listAttachmentsForNewsletter,
    resolveEffectiveAppPublicUrl: mocks.resolveEffectiveAppPublicUrl,
    resolveAppPublicUrl: mocks.resolveAppPublicUrl,
  };
});

vi.mock("@/components/newsletters/newsletter-edit-form", () => ({
  NewsletterEditForm: mocks.NewsletterEditForm,
}));

function makeNewsletter(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    $id: "nl-1",
    name: "Daily AI",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerAppwrite.mockReturnValue(mocks.client);
  mocks.getNewsletter.mockResolvedValue(makeNewsletter());
  mocks.listFeeds.mockResolvedValue([]);
  mocks.listAttachmentsForNewsletter.mockResolvedValue([]);
  mocks.resolveEffectiveAppPublicUrl.mockResolvedValue("https://gui.example.com");
  mocks.resolveAppPublicUrl.mockReturnValue("https://env.example.com");
  process.env.APP_PUBLIC_URL = "https://env.example.com";
});

afterEach(() => {
  cleanup();
  delete process.env.APP_PUBLIC_URL;
});

describe("NewsletterEditPage — Stage 12 appPublicUrl", () => {
  it("passes resolveEffectiveAppPublicUrl result to the form (not env-only)", async () => {
    const { default: NewsletterEditPage } = await import(
      "@/app/(protected)/admin/newsletters/[id]/page"
    );

    const element = await NewsletterEditPage({ params: Promise.resolve({ id: "nl-1" }) });
    render(element);

    expect(mocks.resolveEffectiveAppPublicUrl).toHaveBeenCalledWith(mocks.client);
    expect(mocks.resolveAppPublicUrl).not.toHaveBeenCalled();
    expect(mocks.NewsletterEditForm).toHaveBeenCalled();
    expect(mocks.NewsletterEditForm.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        appPublicUrl: "https://gui.example.com",
      }),
    );
  });

  it("passes null when effective public URL is unset", async () => {
    mocks.resolveEffectiveAppPublicUrl.mockRejectedValue(
      new AppPublicUrlError("Missing public URL. Set it in Settings or APP_PUBLIC_URL."),
    );

    const { default: NewsletterEditPage } = await import(
      "@/app/(protected)/admin/newsletters/[id]/page"
    );

    const element = await NewsletterEditPage({ params: Promise.resolve({ id: "nl-1" }) });
    render(element);

    expect(mocks.resolveEffectiveAppPublicUrl).toHaveBeenCalledWith(mocks.client);
    expect(mocks.resolveAppPublicUrl).not.toHaveBeenCalled();
    expect(mocks.NewsletterEditForm).toHaveBeenCalled();
    expect(mocks.NewsletterEditForm.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        appPublicUrl: null,
      }),
    );
  });
});
