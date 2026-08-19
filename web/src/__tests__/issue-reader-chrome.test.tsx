/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  formatIssueFallbackTitle,
  resolveIssueDisplayTitle,
  type Run,
} from "@newsletter/shared";
import {
  INSPECT_PIPELINE_LABEL,
  IssueReader,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";
import { ISSUE_LISTEN_REGION_LABEL } from "@/components/issues/issue-listen-bar";
import { inspectRunHref } from "@/components/runs/inspect-url";

afterEach(() => {
  cleanup();
});

const ENDED_AT = "2026-03-15T14:35:00.000Z";
const STARTED_AT = "2026-03-15T14:30:00.000Z";

function makeRun(overrides: Partial<Run> = {}): Run {
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
    ...overrides,
  };
}

function expectNoFactoryOps() {
  expect(screen.queryByRole("link", { name: INSPECT_PIPELINE_LABEL })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Download Markdown" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Download HTML" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  expect(screen.queryByText("Email")).not.toBeInTheDocument();
  expect(screen.queryByText("RSS")).not.toBeInTheDocument();
}

function expectReaderColumn(container: HTMLElement) {
  const column = container.firstElementChild;
  expect(column?.className).toMatch(/max-w-3xl/);
  expect(column?.className).not.toMatch(/max-w-prose/);
}

/** C1 — digest body fills the 3xl column; Typography `prose` default is 65ch. */
function expectProseFillsColumn(container: HTMLElement) {
  const prose = container.querySelector(".prose");
  expect(prose).not.toBeNull();
  expect(prose?.className).toMatch(/max-w-none/);
}

/** Node 26 + jsdom may leave localStorage undefined; listen hook reads it. */
function ensureLocalStorage(): Storage {
  const existing = (globalThis as { localStorage?: Storage }).localStorage;
  if (existing && typeof existing.getItem === "function") {
    return existing;
  }

  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: storage,
    });
  }
  return storage;
}

class FakeUtterance {
  text: string;
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((this: FakeUtterance, ev: Event) => void) | null = null;
  onend: ((this: FakeUtterance, ev: Event) => void) | null = null;
  onerror: ((this: FakeUtterance, ev: Event) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function installSpeechApi() {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [],
      pause: vi.fn(),
      resume: vi.fn(),
      pending: false,
      speaking: false,
      paused: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
      onvoiceschanged: null,
    },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
}

function uninstallSpeechApi() {
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
}

describe("IssueReader chrome (showOps)", () => {
  it("hides factory ops on default and showOps={false} success (case 3)", () => {
    const run = makeRun();
    const dateIso = run.endedAt ?? run.startedAt;
    const dateLabel = new Date(dateIso).toLocaleDateString(undefined, { dateStyle: "short" });
    const markdown = `## Hello

Body text.`;
    const title = resolveIssueDisplayTitle({
      markdown,
      newsletterName: run.newsletterName,
      dateIso,
    });

    const { container, rerender } = render(
      <IssueReader run={run} runId={run.$id} markdown={markdown} />,
    );

    expectReaderColumn(container);
    expectProseFillsColumn(container);
    expect(title).toBe("Hello");
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText(`${run.newsletterName} · ${dateLabel}`)).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Home" });
    expect(back).toHaveAttribute("href", "/");
    expectNoFactoryOps();

    rerender(<IssueReader run={run} runId={run.$id} markdown={markdown} showOps={false} />);

    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText(`${run.newsletterName} · ${dateLabel}`)).toBeInTheDocument();
    expect(screen.getByText("Body text.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expectNoFactoryOps();
    expectReaderColumn(container);
    expectProseFillsColumn(container);
  });

  it("shows factory ops on showOps success (case 4)", () => {
    const run = makeRun({
      emailDeliveryStatus: "sent",
      rssDeliveryStatus: "published",
    });
    const markdown = "## Hello\n\nBody text.";

    render(<IssueReader run={run} runId={run.$id} markdown={markdown} showOps />);

    const back = screen.getByRole("link", { name: "Back to Issues" });
    expect(back).toHaveAttribute("href", "/admin/issues");

    const inspect = screen.getByRole("link", { name: INSPECT_PIPELINE_LABEL });
    expect(inspect).toHaveAttribute("href", inspectRunHref(run.$id));

    const md = screen.getByRole("link", { name: "Download Markdown" });
    expect(md).toHaveAttribute("href", `/api/issues/${run.$id}/export?format=md`);
    const html = screen.getByRole("link", { name: "Download HTML" });
    expect(html).toHaveAttribute("href", `/api/issues/${run.$id}/export?format=html`);

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("RSS")).toBeInTheDocument();
  });

  it("omits factory ops on showOps load-error and uses Back to Issues (case 5)", () => {
    const run = makeRun();
    const title = formatIssueFallbackTitle(run.newsletterName, run.endedAt ?? run.startedAt);

    render(<IssueReader run={run} runId={run.$id} loadError showOps />);

    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Issues" })).toHaveAttribute(
      "href",
      "/admin/issues",
    );
    expectNoFactoryOps();
  });

  it("switches not-available back link with showOps without adding ops (case 6)", () => {
    const { unmount } = render(<IssueReaderNotAvailable />);

    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expectNoFactoryOps();
    unmount();

    render(<IssueReaderNotAvailable showOps />);

    expect(screen.getByRole("link", { name: "Back to Issues" })).toHaveAttribute(
      "href",
      "/admin/issues",
    );
    expectNoFactoryOps();
  });
});

describe("IssueReader chrome listen (case 7)", () => {
  beforeEach(() => {
    uninstallSpeechApi();
    ensureLocalStorage();
    installSpeechApi();
  });

  afterEach(() => {
    uninstallSpeechApi();
  });

  it("keeps Listen on success with showOps={false}; omits it on load-error and not-available", async () => {
    const run = makeRun();
    const markdown = "## Hello\n\nBody text for listening.";

    const { unmount } = render(
      <IssueReader run={run} runId={run.$id} markdown={markdown} showOps={false} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: ISSUE_LISTEN_REGION_LABEL })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    unmount();

    const { unmount: unmountError } = render(
      <IssueReader run={run} runId={run.$id} loadError showOps={false} />,
    );
    expect(screen.queryByRole("region", { name: ISSUE_LISTEN_REGION_LABEL })).not.toBeInTheDocument();
    unmountError();

    render(<IssueReaderNotAvailable />);
    expect(screen.queryByRole("region", { name: ISSUE_LISTEN_REGION_LABEL })).not.toBeInTheDocument();
  });
});

const PROTECTED_APP = path.resolve(__dirname, "../../app/(protected)");
const WEB_ROOT = path.resolve(__dirname, "../..");
const READER_ISSUE_PAGE = path.join(PROTECTED_APP, "issues/[runId]/page.tsx");
const ADMIN_ISSUE_PAGE = path.join(PROTECTED_APP, "admin/issues/[runId]/page.tsx");
const ISSUE_DETAIL_VIEW = path.join(WEB_ROOT, "components/issues/issue-detail-view.tsx");

const SHOW_OPS_FALSE_RE = /showOps=\{\s*false\s*\}/;
const SHOW_OPS_TRUE_RE = /showOps=\{\s*true\s*\}/;
/** JSX boolean shorthand `showOps` — not `showOps={…}`. */
const SHOW_OPS_BARE_RE = /\bshowOps\b(?!\s*=)/;

function jsxOpeningTags(source: string, tag: string): string[] {
  return source.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
}

function everyTagPassesShowOps(source: string, tag: string): boolean {
  const tags = jsxOpeningTags(source, tag);
  return tags.length > 0 && tags.every((open) => /\bshowOps\b/.test(open));
}

describe("Issue reader dual-route pages (source-read, cases 8–10)", () => {
  it("reader /issues/[runId] exists and wires IssueDetailView with showOps={false} (case 8)", () => {
    expect(existsSync(READER_ISSUE_PAGE)).toBe(true);
    const source = readFileSync(READER_ISSUE_PAGE, "utf8");

    expect(source).toContain("IssueDetailView");
    expect(source).toMatch(SHOW_OPS_FALSE_RE);
    expect(source).not.toMatch(SHOW_OPS_TRUE_RE);
    expect(source).not.toMatch(SHOW_OPS_BARE_RE);
  });

  it("factory /admin/issues/[runId] exists and wires IssueDetailView with showOps on (case 9)", () => {
    expect(
      existsSync(ADMIN_ISSUE_PAGE),
      "expected web/app/(protected)/admin/issues/[runId]/page.tsx",
    ).toBe(true);
    const source = readFileSync(ADMIN_ISSUE_PAGE, "utf8");

    expect(source).toContain("IssueDetailView");
    expect(SHOW_OPS_TRUE_RE.test(source) || SHOW_OPS_BARE_RE.test(source)).toBe(true);
    expect(source).not.toMatch(SHOW_OPS_FALSE_RE);
  });

  it("IssueDetailView loads the draft and passes showOps through; no searchParams (case 10)", () => {
    expect(
      existsSync(ISSUE_DETAIL_VIEW),
      "expected web/components/issues/issue-detail-view.tsx",
    ).toBe(true);
    const source = readFileSync(ISSUE_DETAIL_VIEW, "utf8");

    expect(source).toContain("loadIssueDraft");
    expect(source).toContain("IssueReader");
    expect(everyTagPassesShowOps(source, "IssueReader")).toBe(true);
    expect(everyTagPassesShowOps(source, "IssueReaderNotAvailable")).toBe(true);
    expect(everyTagPassesShowOps(source, "IssueReaderLoadErrorBare")).toBe(true);
    expect(source).not.toContain("searchParams");
  });
});

const LISTEN_BAR = path.join(WEB_ROOT, "components/issues/issue-listen-bar.tsx");
const READER_LAYOUT = path.join(WEB_ROOT, "lib/issue-reader-layout.ts");

describe("IssueListenBar inner wrap (case 13)", () => {
  it("uses max-w-3xl and does not use max-w-prose", () => {
    const source = readFileSync(LISTEN_BAR, "utf8");
    const layout = readFileSync(READER_LAYOUT, "utf8");
    expect(source).toMatch(/ISSUE_READER_COLUMN_CLASS/);
    expect(layout).toMatch(/max-w-3xl/);
    expect(source).not.toMatch(/max-w-prose/);
    expect(layout).not.toMatch(/max-w-prose/);
  });
});

