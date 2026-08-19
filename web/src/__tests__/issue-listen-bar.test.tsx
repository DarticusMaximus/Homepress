/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Run } from "@newsletter/shared";
import {
  IssueReader,
  IssueReaderNotAvailable,
} from "@/components/issues/issue-reader";

const webRoot = path.resolve(__dirname, "../..");
const barPath = path.join(webRoot, "components", "issues", "issue-listen-bar.tsx");
const hookPath = path.join(webRoot, "hooks", "use-issue-listen.ts");
const issueReaderPath = path.join(webRoot, "components", "issues", "issue-reader.tsx");

const RATE_KEY = "homepress.issue-listen.rate";
const REGION_LABEL = "Listen to issue";
const ERROR_COPY = "Couldn’t start listening.";

const RATE_LABELS = ["0.75×", "1×", "1.25×", "1.5×", "2×"] as const;
const OTHER_RATE_LABELS = ["0.75×", "1.25×", "1.5×", "2×"] as const;

const ENDED_AT = "2026-03-15T14:35:00.000Z";
const STARTED_AT = "2026-03-15T14:30:00.000Z";

/** One sentence → one packed utterance (no lookahead enqueue). */
const ONE_CHUNK_MARKDOWN = "A short sentence for playback.";

/** Node 26 + jsdom may leave localStorage undefined; hook + rate test need a store. */
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

/** Minimal SpeechSynthesisUtterance stand-in — matches issue-listen-player FakeUtterance. */
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

type SpeechStub = {
  queue: FakeUtterance[];
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};

/**
 * Install window.speechSynthesis + SpeechSynthesisUtterance so the real hook
 * (Task 6) constructs createIssueListenPlayer against this fake. speak() pushes
 * utterances; tests fire onstart/onend/onerror on queue entries.
 */
function installSpeechApi(): SpeechStub {
  const queue: FakeUtterance[] = [];
  const speak = vi.fn((utterance: FakeUtterance) => {
    queue.push(utterance);
  });
  const cancel = vi.fn(() => {
    queue.length = 0;
  });

  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: {
      speak,
      cancel,
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

  return { queue, speak, cancel };
}

function uninstallSpeechApi() {
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
}

type BarModule = {
  IssueListenBar: ComponentType<{ markdown: string }>;
  ISSUE_LISTEN_REGION_LABEL?: string;
  ISSUE_LISTEN_ERROR_COPY?: string;
};

/**
 * File URL + @vite-ignore: Vite must not fail the suite at transform time while
 * the bar/hook are still missing (Task 5 red). existsSync surfaces missing wiring.
 */
async function loadIssueListenBar(): Promise<BarModule> {
  expect(existsSync(barPath), `missing IssueListenBar: ${barPath}`).toBe(true);
  expect(existsSync(hookPath), `missing use-issue-listen hook: ${hookPath}`).toBe(true);

  const mod = (await import(/* @vite-ignore */ pathToFileURL(barPath).href)) as BarModule;
  expect(typeof mod.IssueListenBar).toBe("function");
  return mod;
}

function extractExportedFunction(src: string, name: string): string {
  // Word boundary so "IssueReader" does not match "IssueReaderNotAvailable".
  const re = new RegExp(`export function ${name}\\b`);
  const match = re.exec(src);
  if (!match || match.index < 0) return "";
  const start = match.index;
  // Skip param list (may contain destructuring `{ ... }`) before the body brace.
  const parenStart = src.indexOf("(", start);
  if (parenStart < 0) return "";
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  if (parenEnd < 0) return "";
  const braceStart = src.indexOf("{", parenEnd);
  if (braceStart < 0) return "";
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return src.slice(braceStart);
}

function expectIdleChrome() {
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  for (const label of RATE_LABELS) {
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  }
}

function expectActiveThreeControls(playPause: "Play" | "Pause") {
  expect(screen.getByRole("button", { name: playPause })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  const currentRate = screen.getByRole("button", { name: "1×" });
  expect(currentRate).toHaveAttribute("aria-pressed", "true");
  for (const label of OTHER_RATE_LABELS) {
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  }
}

let speechStub: SpeechStub | null = null;

beforeEach(() => {
  uninstallSpeechApi();
  speechStub = null;
  ensureLocalStorage().removeItem(RATE_KEY);
});

afterEach(() => {
  cleanup();
  uninstallSpeechApi();
  speechStub = null;
  ensureLocalStorage().removeItem(RATE_KEY);
});

describe("Issue listen bar", () => {
  it("hides without speechSynthesis API", async () => {
    uninstallSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nBody." />);

    expect(screen.queryByRole("region", { name: REGION_LABEL })).not.toBeInTheDocument();
  });

  it("idle chrome is Play only (no Stop, no rates)", async () => {
    speechStub = installSpeechApi();
    const run = makeRun();
    const markdown = "## Hello\n\nBody text for listening.";

    render(<IssueReader run={run} runId={run.$id} markdown={markdown} />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: REGION_LABEL })).toBeInTheDocument();
    });
    expectIdleChrome();
  });

  it("load-error and not-available hide the listen bar", () => {
    speechStub = installSpeechApi();
    const run = makeRun();

    const { unmount } = render(<IssueReader run={run} runId={run.$id} loadError />);
    expect(screen.queryByRole("region", { name: REGION_LABEL })).not.toBeInTheDocument();
    unmount();

    render(<IssueReaderNotAvailable />);
    expect(screen.queryByRole("region", { name: REGION_LABEL })).not.toBeInTheDocument();
  });

  it("Play label toggles to Pause and back", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    const playPause = screen.getByRole("button", { name: "Play" });
    fireEvent.click(playPause);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
  });

  it("after Play shows Pause, enabled Stop, and current rate only", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
    expectActiveThreeControls("Pause");
  });

  it("paused chrome stays three controls", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    expectActiveThreeControls("Play");
  });

  it("Stop returns to idle Play-only chrome", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    expectIdleChrome();
  });

  it("last-chunk end returns to idle Play-only chrome", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown={ONE_CHUNK_MARKDOWN} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(speechStub!.queue).toHaveLength(1);
    });

    const utterance = speechStub!.queue[0]!;
    utterance.onstart?.call(utterance, new Event("start"));
    utterance.onend?.call(utterance, new Event("end"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    expectIdleChrome();
  });

  it("shows error copy on utterance error, returns to idle, and clears on next Play", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    const barSource = readFileSync(barPath, "utf8");
    expect(barSource).not.toMatch(/from\s+["']@\/lib\/toast["']/);
    expect(barSource).not.toMatch(/\btoast\b/);

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(speechStub!.queue.length).toBeGreaterThan(0);
    });

    const utterance = speechStub!.queue[0]!;
    utterance.onerror?.call(utterance, new Event("error"));

    await waitFor(() => {
      expect(screen.getByText(ERROR_COPY)).toBeInTheDocument();
    });
    const region = screen.getByRole("region", { name: REGION_LABEL });
    expect(region).toContainElement(screen.getByText(ERROR_COPY));
    expectIdleChrome();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.queryByText(ERROR_COPY)).not.toBeInTheDocument();
    });
  });

  it("expand / collapse rates", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "1×" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toHaveAttribute("aria-expanded", "true");
    });
    const group = screen.getByRole("group", { name: "Playback speed" });
    expect(group).toHaveAttribute("id", "issue-listen-rates");
    for (const label of OTHER_RATE_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "1×" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "1×" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.queryByRole("group", { name: "Playback speed" })).not.toBeInTheDocument();
    for (const label of OTHER_RATE_LABELS) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    const stored = ensureLocalStorage().getItem(RATE_KEY);
    expect(stored === null || stored === "1").toBe(true);
  });

  it("pick rate applies and closes", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "1×" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1.5×" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "1.5×" }));

    await waitFor(() => {
      expect(ensureLocalStorage().getItem(RATE_KEY)).toBe("1.5");
    });
    const currentRate = screen.getByRole("button", { name: "1.5×" });
    expect(currentRate).toHaveAttribute("aria-pressed", "true");
    expect(currentRate).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Playback speed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "0.75×" })).not.toBeInTheDocument();
  });

  it("bar container is fixed at bottom with safe-area inset", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nBody." />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: REGION_LABEL })).toBeInTheDocument();
    });
    const region = screen.getByRole("region", { name: REGION_LABEL });
    expect(region.className).toMatch(/\bfixed\b/);
    expect(region.className).toMatch(/\bbottom-0\b/);

    const styleAndClass = `${region.className} ${region.getAttribute("style") ?? ""}`;
    expect(styleAndClass).toMatch(/safe-area-inset-bottom/);
  });

  it("spacer and inner use min-h-14 with max-w-3xl, not min-h-28", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nBody." />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: REGION_LABEL })).toBeInTheDocument();
    });

    const region = screen.getByRole("region", { name: REGION_LABEL });
    const inner = region.firstElementChild as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.className).toMatch(/min-h-14/);
    expect(inner.className).not.toMatch(/min-h-28/);
    expect(inner.className.split(/\s+/)).not.toContain("h-16");
    expect(inner.className).toMatch(/max-w-3xl/);
    expect(inner.className).not.toMatch(/max-w-prose/);
    // Containing block for the upward panel — not on the region.
    // `relative` + `fixed` on the same node lets Tailwind keep `relative` and
    // drops the bar into document flow at the end of the issue.
    expect(inner.className).toMatch(/\brelative\b/);

    const spacer = region.previousElementSibling as HTMLElement;
    expect(spacer).toBeTruthy();
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(spacer.className).toMatch(/min-h-14/);
    expect(spacer.className).not.toMatch(/min-h-28/);
    expect(spacer.className.split(/\s+/)).not.toContain("h-16");

    expect(region.className).not.toMatch(/\brelative\b/);
    expect(region.className).toMatch(/\bfixed\b/);
    expect(region.className).toMatch(/\bbottom-0\b/);
    expect(region.className).not.toMatch(/\boverflow-hidden\b/);
  });

  it("panel placement is absolute bottom-full without overlay primitives", () => {
    expect(existsSync(barPath), `missing IssueListenBar: ${barPath}`).toBe(true);
    const src = readFileSync(barPath, "utf8");

    expect(src).toMatch(/\babsolute\b/);
    expect(src).toMatch(/\bbottom-full\b/);
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/popover["']/);
    expect(src).not.toMatch(/dropdown-menu/);
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/select["']/);
  });

  it("idle closes expander for the next Play", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown="## Hello\n\nA short sentence for playback." />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "1×" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toHaveAttribute("aria-expanded", "true");
    });
    expect(screen.getByRole("group", { name: "Playback speed" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    expectIdleChrome();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    const currentRate = screen.getByRole("button", { name: "1×" });
    expect(currentRate).toHaveAttribute("aria-expanded", "false");
    for (const label of OTHER_RATE_LABELS) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("hook imports ISSUE_LISTEN_RATES and ISSUE_LISTEN_ERROR_COPY from shared constants", () => {
    expect(existsSync(hookPath), `missing use-issue-listen hook: ${hookPath}`).toBe(true);
    const src = readFileSync(hookPath, "utf8");

    const importMatch = src.match(
      /import\s*\{([^}]+)\}\s*from\s*["']@\/lib\/issue-listen-constants["']/,
    );
    expect(importMatch, "hook must import from @/lib/issue-listen-constants").not.toBeNull();
    const imported = importMatch![1]!;
    expect(imported).toMatch(/\bISSUE_LISTEN_RATES\b/);
    expect(imported).toMatch(/\bISSUE_LISTEN_ERROR_COPY\b/);

    expect(src).not.toMatch(/\bALLOWED_RATES\b/);
    expect(src).not.toMatch(/\bERROR_COPY\b/);
    expect(src).not.toMatch(/\[0\.75,\s*1,\s*1\.25,\s*1\.5,\s*2\]/);
    expect(src).not.toMatch(/Couldn[\u2019']t start listening/);
  });

  it("source-read IssueReader mounts IssueListenBar on success only", () => {
    expect(existsSync(issueReaderPath), `missing IssueReader: ${issueReaderPath}`).toBe(true);
    const src = readFileSync(issueReaderPath, "utf8");

    expect(src).toMatch(/IssueListenBar/);
    expect(src).toMatch(/from\s+["']@\/components\/issues\/issue-listen-bar["']/);

    const readerBody = extractExportedFunction(src, "IssueReader");
    const notAvailableBody = extractExportedFunction(src, "IssueReaderNotAvailable");
    const loadErrorBareBody = extractExportedFunction(src, "IssueReaderLoadErrorBare");

    expect(readerBody).toMatch(/IssueListenBar/);
    expect(readerBody).toMatch(/markdown=\{\s*markdown\s*\?\?\s*""\s*\}/);
    expect(notAvailableBody).not.toMatch(/IssueListenBar/);
    expect(loadErrorBareBody).not.toMatch(/IssueListenBar/);
  });
});

describe("U2 listen focus restore", () => {
  it("Stop moves focus to Play and returns idle Play-only", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown={ONE_CHUNK_MARKDOWN} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    });
    const stop = screen.getByRole("button", { name: "Stop" });
    stop.focus();
    expect(document.activeElement).toBe(stop);
    fireEvent.click(stop);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Play" }));
    });
    expectIdleChrome();
  });

  it("picking 1.5× moves focus to the transport current-rate button", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown={ONE_CHUNK_MARKDOWN} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1×" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "1×" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1.5×" })).toBeInTheDocument();
    });
    const panelRate = screen.getByRole("button", { name: "1.5×" });
    panelRate.focus();
    fireEvent.click(panelRate);

    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "Playback speed" })).not.toBeInTheDocument();
    });
    const currentRate = screen.getByRole("button", { name: "1.5×" });
    expect(currentRate).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(currentRate);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("last-chunk onend with Stop focused restores Play (not Pause)", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown={ONE_CHUNK_MARKDOWN} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(speechStub!.queue).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    });

    const stop = screen.getByRole("button", { name: "Stop" });
    stop.focus();
    expect(document.activeElement).toBe(stop);

    const utterance = speechStub!.queue[0]!;
    utterance.onstart?.call(utterance, new Event("start"));
    utterance.onend?.call(utterance, new Event("end"));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Play" }));
    });
    expectIdleChrome();
  });

  it("TTS onerror with current-rate focused restores Play", async () => {
    speechStub = installSpeechApi();
    const { IssueListenBar } = await loadIssueListenBar();

    render(<IssueListenBar markdown={ONE_CHUNK_MARKDOWN} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(speechStub!.queue.length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "1×" })).toBeInTheDocument();
    });

    const currentRate = screen.getByRole("button", { name: "1×" });
    currentRate.focus();
    expect(document.activeElement).toBe(currentRate);

    const utterance = speechStub!.queue[0]!;
    utterance.onerror?.call(utterance, new Event("error"));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Play" }));
    });
    expectIdleChrome();
    expect(screen.getByText(ERROR_COPY)).toBeInTheDocument();
  });

  it("does not yank heading focus outside the listen region when TTS ends", async () => {
    speechStub = installSpeechApi();
    const run = makeRun();

    render(<IssueReader run={run} runId={run.$id} markdown={ONE_CHUNK_MARKDOWN} />);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: REGION_LABEL })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => {
      expect(speechStub!.queue).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    });

    const heading = screen.getByRole("heading", { level: 1 });
    heading.tabIndex = -1;
    heading.focus();
    expect(document.activeElement).toBe(heading);

    const utterance = speechStub!.queue[0]!;
    utterance.onstart?.call(utterance, new Event("start"));
    utterance.onend?.call(utterance, new Event("end"));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(heading);
    expectIdleChrome();
  });
});
