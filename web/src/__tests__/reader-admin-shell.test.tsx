import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HealthCheckResult, Run } from "@newsletter/shared";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { NewslettersStub } from "@/components/newsletters/newsletters-stub";
import { buildDeliveryHref } from "@/components/delivery/delivery-url";
import { buildFeedsHref } from "@/components/feeds/feeds-url";
import { buildIssuesHref } from "@/components/issues/issues-url";
import { buildNewslettersHref } from "@/components/newsletters/newsletters-pagination";
import { inspectRunHref } from "@/components/runs/inspect-url";
import { buildAttentionItems } from "@/lib/dashboard-data";
import { isNavItemActive } from "@/lib/nav-active";
import { navItems } from "@/lib/nav-items";
import { buildRunsHref } from "@/lib/runs-url";

vi.mock("@/components/health-card/actions", () => ({
  revalidateHealthCheck: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const PROTECTED_APP = path.resolve(__dirname, "../../app/(protected)");
const WEB_ROOT = path.resolve(__dirname, "../..");

const FACTORY_PAGE_RELATIVE_PATHS = [
  "feeds/page.tsx",
  "runs/page.tsx",
  "runs/[runId]/inspect/page.tsx",
  "schedules/page.tsx",
  "prompts/page.tsx",
  "delivery/page.tsx",
  "settings/page.tsx",
  "issues/page.tsx",
] as const;

const STARTED_AT = "2026-07-20T10:00:00.000Z";
const ENDED_AT = "2026-07-20T10:30:00.000Z";

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

function okHealth(): HealthCheckResult {
  return {
    status: "ok",
    checkedAt: "2026-07-21T12:00:00.000Z",
    documentId: "doc-1",
    steps: [
      { step: "create", status: "ok", durationMs: 12 },
      { step: "read", status: "ok", durationMs: 8 },
      { step: "delete", status: "ok", durationMs: 5 },
    ],
  };
}

function sectionOrderLabels(container: HTMLElement): string[] {
  const main = container.querySelector("main");
  if (!main) return [];
  return [...main.querySelectorAll("section[aria-label]")].map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

describe("navItems (reader shell)", () => {
  it("is exactly Home, Newsletters, Admin", () => {
    expect(navItems).toHaveLength(3);
    expect(navItems.map((item) => item.title)).toEqual(["Home", "Newsletters", "Admin"]);
    expect(navItems.map((item) => item.href)).toEqual(["/", "/newsletters", "/admin"]);
    const titles = navItems.map((item) => item.title);
    expect(titles).not.toContain("Feeds");
    expect(titles).not.toContain("Runs");
    expect(titles).not.toContain("Dashboard");
    expect(titles).not.toContain("Issues");
  });
});

describe("isNavItemActive (reader / admin)", () => {
  it("marks Admin active on /admin and every /admin/*", () => {
    expect(isNavItemActive("/admin/feeds", "/admin")).toBe(true);
    expect(isNavItemActive("/admin", "/admin")).toBe(true);
    expect(isNavItemActive("/newsletters", "/admin")).toBe(false);
  });

  it("does not mark reader Newsletters active on config /admin/newsletters", () => {
    expect(isNavItemActive("/admin/newsletters", "/newsletters")).toBe(false);
    expect(isNavItemActive("/newsletters", "/newsletters")).toBe(true);
  });

  it("keeps Home exact-only so /admin does not activate /", () => {
    expect(isNavItemActive("/admin", "/")).toBe(false);
  });
});

describe("factory URL helpers (admin prefix)", () => {
  it("emits /admin/... roots for feeds, inspect, runs, delivery, issues, newsletters, attention", () => {
    expect(buildFeedsHref({})).toBe("/admin/feeds");
    expect(inspectRunHref("run-1")).toBe("/admin/runs/run-1/inspect");
    expect(buildRunsHref({})).toBe("/admin/runs");
    expect(buildDeliveryHref({})).toBe("/admin/delivery");
    expect(buildIssuesHref({})).toBe("/admin/issues");
    expect(buildNewslettersHref(1)).toBe("/admin/newsletters");

    const attention = buildAttentionItems({
      unhealthyFeeds: 1,
      failedRuns: 1,
      failedDelivery: 1,
    });
    expect(attention.find((item) => item.kind === "unhealthy_feeds")?.href).toBe(
      "/admin/feeds?health=unhealthy",
    );
    expect(attention.find((item) => item.kind === "failed_runs")?.href).toBe(
      "/admin/runs?status=failed",
    );
    expect(attention.find((item) => item.kind === "failed_delivery")?.href).toBe(
      "/admin/delivery?outcome=any_failure",
    );
  });
});

describe("factory URL-map existsSync", () => {
  it("is gone at every old factory root and present under admin", () => {
    for (const rel of FACTORY_PAGE_RELATIVE_PATHS) {
      expect(existsSync(path.join(PROTECTED_APP, rel))).toBe(false);
      expect(existsSync(path.join(PROTECTED_APP, "admin", rel))).toBe(true);
    }
    expect(existsSync(path.join(PROTECTED_APP, "admin/newsletters/page.tsx"))).toBe(true);
  });

  it("keeps the issue reader, reader newsletters index, and reader channel [id]; admin [id] remains", () => {
    expect(existsSync(path.join(PROTECTED_APP, "issues/[runId]/page.tsx"))).toBe(true);
    expect(existsSync(path.join(PROTECTED_APP, "newsletters/page.tsx"))).toBe(true);
    expect(existsSync(path.join(PROTECTED_APP, "newsletters/[id]/page.tsx"))).toBe(true);
    expect(existsSync(path.join(PROTECTED_APP, "admin/newsletters/[id]/page.tsx"))).toBe(true);
  });
});

describe("Admin hub composition", () => {
  it("renders Needs attention → Recent runs → Health strip; heading Admin; no Factory dump", () => {
    const attentionItems = buildAttentionItems({
      unhealthyFeeds: 2,
      failedRuns: 1,
      failedDelivery: 0,
    });
    const run = makeRun({ $id: "run-recent", status: "failed" });

    const { container } = render(
      <DashboardView
        attentionItems={attentionItems}
        recentRuns={[run]}
        healthResult={okHealth()}
        feedsUnhealthyCount={0}
      />,
    );

    expect(sectionOrderLabels(container)).toEqual([
      "Needs attention",
      "Recent runs",
      "Health strip",
    ]);

    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /recent issues/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/configure newsletters, run the pipeline/i)).not.toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Factory" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Factory" })).toBeNull();

    const viewSource = readFileSync(
      path.join(WEB_ROOT, "components/dashboard/dashboard-view.tsx"),
      "utf8",
    );
    expect(viewSource).not.toContain("FACTORY" + "_DIRECTORY");

    // T1: lock destinations the hub does not use as widgets. Do not forbid
    // /admin/feeds (FeedsHealthCard / attention), /admin/runs (Recent runs),
    // or /admin/delivery (attention) — query strings on those stay allowed.
    const hubDumpHrefs = [
      "/admin/newsletters",
      "/admin/issues",
      "/admin/schedules",
      "/admin/prompts",
      "/admin/settings",
    ] as const;
    for (const href of hubDumpHrefs) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    }
  });
});

describe("Home page vs Admin hub", () => {
  it("does not compose dashboard widgets on /", () => {
    const source = readFileSync(path.join(PROTECTED_APP, "page.tsx"), "utf8");
    expect(source).not.toContain("DashboardView");
    expect(source).not.toContain("Needs attention");
    expect(source).not.toContain("health-card");
    expect(source).not.toContain("feeds-health-card");
  });
});

describe("Newsletters stub", () => {
  it("renders newsletter names with no Create/Generate chrome", () => {
    render(
      <NewslettersStub
        newsletters={[
          { $id: "nl-1", name: "Daily AI" },
          { $id: "nl-2", name: "Weekly Tech" },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Newsletters" })).toBeInTheDocument();
    expect(screen.getByText("Daily AI")).toBeInTheDocument();
    expect(screen.getByText("Weekly Tech")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|generate|add newsletter/i })).not.toBeInTheDocument();
  });

  it("shows empty copy when the list is empty", () => {
    render(<NewslettersStub newsletters={[]} />);

    expect(screen.getByText("No newsletters yet.")).toBeInTheDocument();
  });
});

describe("health revalidate path", () => {
  it("revalidates /admin and not /", () => {
    const source = readFileSync(path.join(WEB_ROOT, "components/health-card/actions.ts"), "utf8");
    expect(source).toContain('revalidatePath("/admin")');
    expect(source).not.toContain('revalidatePath("/")');
  });
});

describe("protected layout sticky header", () => {
  it("puts sticky opaque classes on the header with SidebarTrigger and a title", () => {
    const layoutPath = path.join(PROTECTED_APP, "layout.tsx");
    expect(existsSync(layoutPath)).toBe(true);
    const source = readFileSync(layoutPath, "utf8");

    const headerOpen = source.match(/<header\b[^>]*>/);
    expect(headerOpen, "expected a <header> in protected layout").toBeTruthy();
    const headerTag = headerOpen![0];
    expect(headerTag).toMatch(/\bsticky\b/);
    expect(headerTag).toMatch(/\bbg-background\b/);

    const headerBlock = source.match(/<header\b[\s\S]*?<\/header>/);
    expect(headerBlock, "expected a closed <header> block").toBeTruthy();
    expect(headerBlock![0]).toMatch(/SidebarTrigger/);
    expect(headerBlock![0]).toMatch(/HeaderPageTitle|pageTitleForPath/);

    const titleImport = source.match(
      /from\s+["']([^"']*(?:header-page-title|page-title))["']/,
    );
    if (titleImport) {
      const imported = titleImport[1]!.replace(/^@\//, "");
      const titlePath = path.join(WEB_ROOT, `${imported}.tsx`);
      const titleTsPath = path.join(WEB_ROOT, `${imported}.ts`);
      const resolved = existsSync(titlePath) ? titlePath : titleTsPath;
      expect(existsSync(resolved)).toBe(true);
      expect(readFileSync(resolved, "utf8")).toContain("pageTitleForPath");
    } else {
      expect(source).toContain("pageTitleForPath");
    }
  });
});
