import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROTECTED_APP = path.resolve(__dirname, "../../app/(protected)");
const CHANNEL_PAGE = path.join(PROTECTED_APP, "newsletters/[id]/page.tsx");
const ADMIN_EDIT_PAGE = path.join(PROTECTED_APP, "admin/newsletters/[id]/page.tsx");
const INDEX_PAGE = path.join(PROTECTED_APP, "newsletters/page.tsx");

describe("reader channel page (source-read)", () => {
  it("exists and wires safe-id, newsletter load, issues, HomeInbox, and pagination", () => {
    expect(existsSync(CHANNEL_PAGE)).toBe(true);
    const source = readFileSync(CHANNEL_PAGE, "utf8");

    expect(source).toContain("isSafeNewsletterId");
    expect(source).toContain("notFound");
    expect(source).toContain("getNewsletter");
    expect(source).toContain("listIssues");
    expect(source).toContain("newsletterId");
    expect(source).toContain("resolveIssueCardMetaForRuns");
    expect(source).toContain("HomeInbox");
    expect(source).toContain("heading=");
    expect(source).toContain("PAGE_SIZE = 20");
    expect(source).toContain("parsePageParam");
    expect(source).toContain("redirect");
    expect(source).toContain("DomainListPagination");
    expect(source).toContain("buildChannelHref");
    expect(source).toContain("Back to Newsletters");

    expect(source).not.toContain("NewsletterEditForm");
    expect(source).not.toContain("GenerateNewsletterButton");
    expect(source).not.toContain("listNewsletters");
  });

  it("still calls resolveIssueCardMetaForRuns without a local extract path", () => {
    expect(existsSync(CHANNEL_PAGE)).toBe(true);
    const source = readFileSync(CHANNEL_PAGE, "utf8");

    expect(source).toContain("resolveIssueCardMetaForRuns");
    expect(source).not.toContain("extractFirstMarkdownHeading");
    expect(source).not.toContain("extractIssueDek");
    expect(source).not.toContain("storedIssueTitle");
    expect(source).not.toContain("storedIssueDek");
  });
});

describe("admin newsletter edit page (source-read)", () => {
  it("still exists and still contains NewsletterEditForm", () => {
    expect(existsSync(ADMIN_EDIT_PAGE)).toBe(true);
    const source = readFileSync(ADMIN_EDIT_PAGE, "utf8");
    expect(source).toContain("NewsletterEditForm");
  });
});

describe("reader newsletters index (source-read)", () => {
  it("wires ChannelList, sort, pagination — not factory chrome or the names-as-text stub", () => {
    expect(existsSync(INDEX_PAGE)).toBe(true);
    const source = readFileSync(INDEX_PAGE, "utf8");

    expect(source).toContain("ChannelList");
    expect(source).toContain("listNewsletters");
    expect(source).toContain("buildReaderNewslettersHref");
    expect(source).toContain("PAGE_SIZE = 20");
    expect(source).toContain("localeCompare");
    expect(source).toContain("parsePageParam");
    expect(source).toContain("redirect");
    expect(source).toContain("DomainListPagination");

    expect(source).not.toContain("NewslettersView");
    expect(source).not.toContain("GenerateNewsletterButton");
    expect(source).not.toContain("NewslettersStub");
  });
});
