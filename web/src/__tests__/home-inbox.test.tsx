/// <reference types="@testing-library/jest-dom" />

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { IssueCardMeta, Run } from "@newsletter/shared";
import { HomeInbox } from "@/components/home/home-inbox";
import { formatOperatorDate } from "@/lib/format-operator-datetime";

afterEach(() => {
  cleanup();
});

const WEB_ROOT = path.resolve(__dirname, "../..");
const PROTECTED_APP = path.resolve(__dirname, "../../app/(protected)");
const PAGE_PATH = path.join(PROTECTED_APP, "page.tsx");
const HOME_INBOX_PATH = path.join(WEB_ROOT, "components/home/home-inbox.tsx");
const HOME_ISSUE_CARD_PATH = path.join(WEB_ROOT, "components/home/home-issue-card.tsx");

const STUB_COPY = "Issues will show up here.";
const EMPTY_COPY = "No issues yet.";
const LOAD_ERROR = "Something went wrong while loading issues. Please try again.";

const STARTED_AT = "2026-03-15T14:30:00.000Z";
const ENDED_AT = "2026-03-15T14:35:00.000Z";

function makeIssue(overrides: Partial<Run> = {}): Run {
  return {
    $id: "run-1",
    newsletterId: "nl-1",
    newsletterName: "Weekly Tech",
    status: "completed",
    trigger: "manual",
    currentPhase: "",
    completedPhase: "draft",
    failedPhase: "",
    failureMessage: "",
    startedAt: STARTED_AT,
    endedAt: ENDED_AT,
    topicSummary: "",
    failedFeeds: "",
    suppressSummary: "",
    checkpointFetchId: "",
    checkpointScrapeId: "",
    checkpointTagId: "",
    checkpointScoreId: "",
    checkpointSelectionId: "",
    checkpointDraftId: "draft-1",
    emailDeliveryStatus: "none",
    emailDeliveryAt: null,
    emailDeliveryError: "",
    rssDeliveryStatus: "none",
    rssDeliveryAt: null,
    rssDeliveryError: "",
    issueTitle: "",
    issueDek: "",
    ...overrides,
  };
}

const fixtures: Run[] = [
  makeIssue({
    $id: "issue-alpha",
    newsletterName: "Weekly Tech",
    endedAt: ENDED_AT,
    startedAt: STARTED_AT,
  }),
  makeIssue({
    $id: "issue-beta",
    newsletterName: "Daily News",
    endedAt: "2026-04-01T09:02:00.000Z",
    startedAt: "2026-04-01T09:00:00.000Z",
    checkpointDraftId: "draft-2",
  }),
];

const metaByRunId = new Map<string, IssueCardMeta>([
  [
    "issue-alpha",
    {
      title: "Who Vets AI's Code?",
      dek: "Labs are racing to ship agents.",
    },
  ],
  [
    "issue-beta",
    {
      title: "The Tuesday Brief",
      dek: "Markets opened mixed after overnight futures.",
    },
  ],
]);

function issueCardLinks(container: HTMLElement): HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/issues/"]')];
}

function renderHomeInbox(props: {
  issues: Run[];
  metaByRunId: ReadonlyMap<string, IssueCardMeta>;
  loadError: string | null;
  heading?: string;
}) {
  return render(
    <HomeInbox
      issues={props.issues}
      metaByRunId={props.metaByRunId}
      loadError={props.loadError}
      heading={props.heading}
    />,
  );
}

describe("HomeInbox", () => {
  it("defaults the heading to Home and uses the heading prop when provided", async () => {
    await renderHomeInbox({
      issues: fixtures,
      metaByRunId,
      loadError: null,
    });

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();

    cleanup();

    await renderHomeInbox({
      issues: fixtures,
      metaByRunId,
      loadError: null,
      heading: "Tech Digest",
    });

    expect(screen.getByRole("heading", { name: "Tech Digest" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
  });

  it("renders Home heading, card fields, and issue links", async () => {
    const { container } = await renderHomeInbox({
      issues: fixtures,
      metaByRunId,
      loadError: null,
    });

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();

    for (const issue of fixtures) {
      const meta = metaByRunId.get(issue.$id)!;
      const dateLabel = formatOperatorDate(issue.endedAt ?? issue.startedAt);

      expect(screen.getByRole("heading", { name: meta.title })).toBeInTheDocument();
      expect(container).toHaveTextContent(issue.newsletterName);
      expect(container).toHaveTextContent(dateLabel);
      expect(screen.getByText(meta.dek!)).toBeInTheDocument();

      const link = container.querySelector(`a[href="/issues/${issue.$id}"]`);
      expect(link).not.toBeNull();
    }
  });

  it("is a card stack, not the Admin domain-list table/card split", async () => {
    const inboxSource = readFileSync(HOME_INBOX_PATH, "utf8");
    const cardSource = readFileSync(HOME_ISSUE_CARD_PATH, "utf8");
    expect(inboxSource).not.toMatch(/\bResponsiveList\b/);
    expect(inboxSource).not.toMatch(/\bDomainListCard\b/);
    expect(cardSource).not.toMatch(/\bResponsiveList\b/);
    expect(cardSource).not.toMatch(/\bDomainListCard\b/);

    await renderHomeInbox({
      issues: fixtures,
      metaByRunId,
      loadError: null,
    });

    expect(document.querySelector('[data-slot="domain-list-table"]')).toBeNull();
  });

  it("does not show factory chrome on the inbox", async () => {
    await renderHomeInbox({
      issues: fixtures,
      metaByRunId,
      loadError: null,
    });

    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("RSS")).not.toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
    expect(screen.queryByText("Publish")).not.toBeInTheDocument();
  });

  it("shows empty copy and no card links when there are no issues", async () => {
    const { container } = await renderHomeInbox({
      issues: [],
      metaByRunId: new Map(),
      loadError: null,
    });

    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(issueCardLinks(container)).toHaveLength(0);
  });

  it("shows the passed load error in an alert without empty copy or cards", async () => {
    const { container } = await renderHomeInbox({
      issues: fixtures,
      metaByRunId,
      loadError: LOAD_ERROR,
    });

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(LOAD_ERROR);
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
    expect(issueCardLinks(container)).toHaveLength(0);
  });

  it("does not keep the Feature 01 stub sentence on Home", () => {
    const pageSource = readFileSync(PAGE_PATH, "utf8");
    const inboxSource = readFileSync(HOME_INBOX_PATH, "utf8");
    expect(pageSource).not.toContain(STUB_COPY);
    expect(inboxSource).not.toContain(STUB_COPY);
  });
});

describe("Home page load path (source-read)", () => {
  it("wires listIssues, card meta, HomeInbox, and home pagination — not newsletter filter", () => {
    const source = readFileSync(PAGE_PATH, "utf8");

    expect(source).toContain("listIssues");
    expect(source).toContain("resolveIssueCardMetaForRuns");
    expect(source).toContain("HomeInbox");
    expect(source).toContain("buildHomeHref");
    expect(source).toContain("DomainListPagination");
    expect(source).toContain("PAGE_SIZE = 20");
    expect(source).toContain("parsePageParam");
    expect(source).toContain("redirect");

    expect(source).not.toContain("listNewsletters");
    expect(source).not.toContain("newsletterId");
    expect(source).not.toContain("ResponsiveList");
  });

  it("still calls resolveIssueCardMetaForRuns without a local extract path", () => {
    const source = readFileSync(PAGE_PATH, "utf8");

    expect(source).toContain("resolveIssueCardMetaForRuns");
    expect(source).not.toContain("extractFirstMarkdownHeading");
    expect(source).not.toContain("extractIssueDek");
    expect(source).not.toContain("storedIssueTitle");
    expect(source).not.toContain("storedIssueDek");
  });
});
