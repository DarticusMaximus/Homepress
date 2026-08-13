import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webRoot = path.resolve(__dirname, "../..");

const buildIdPath = path.join(webRoot, "lib", "build-id.ts");
const pwaUpdatePath = path.join(webRoot, "lib", "pwa-update.ts");
const routePath = path.join(webRoot, "app", "build-id", "route.ts");
const swPath = path.join(webRoot, "public", "sw.js");
const registerPath = path.join(webRoot, "components", "pwa-register.tsx");
const layoutPath = path.join(webRoot, "app", "layout.tsx");
const dockerfilePath = path.join(webRoot, "Dockerfile");

const mocks = vi.hoisted(() => ({
  readWebBuildId: vi.fn<(cwd?: string) => string>(),
}));

vi.mock("@/lib/build-id", () => ({
  readWebBuildId: (...args: unknown[]) =>
    mocks.readWebBuildId(...(args as [string?])),
}));

type BuildIdModule = {
  readWebBuildId: (cwd?: string) => string;
};

type PwaUpdateModule = {
  PWA_UPDATE_CHECK_MS: number;
  createPwaUpdateMonitor: (options: {
    bootId: string;
    fetchBuildId: () => Promise<string>;
    onUpdateAvailable: () => void;
    addVisibilityListener: (handler: () => void) => () => void;
    intervalMs?: number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
  }) => {
    start: () => void;
    stop: () => void;
    checkNow: () => Promise<void>;
  };
};

type RouteModule = {
  dynamic: string;
  GET: () => Promise<Response> | Response;
};

/**
 * File URL + @vite-ignore: Vite must not fail the whole suite at transform time
 * while build-id / pwa-update / route are still missing (Task 1 red).
 */
async function loadBuildId(): Promise<BuildIdModule> {
  expect(existsSync(buildIdPath), `missing build-id module: ${buildIdPath}`).toBe(
    true,
  );
  // vi.mock("@/lib/build-id") also intercepts pathToFileURL imports of the same
  // file — use importActual so the stamp cases exercise the real reader while
  // the route cases below still hit the hoisted mock.
  const mod = await vi.importActual<BuildIdModule>("@/lib/build-id");
  expect(typeof mod.readWebBuildId).toBe("function");
  return mod;
}

async function loadPwaUpdate(): Promise<PwaUpdateModule> {
  expect(existsSync(pwaUpdatePath), `missing pwa-update module: ${pwaUpdatePath}`).toBe(
    true,
  );
  const mod = (await import(
    /* @vite-ignore */ pathToFileURL(pwaUpdatePath).href
  )) as PwaUpdateModule;
  expect(typeof mod.createPwaUpdateMonitor).toBe("function");
  expect(mod.PWA_UPDATE_CHECK_MS).toBe(60 * 60 * 1000);
  return mod;
}

async function loadRoute(): Promise<RouteModule> {
  expect(existsSync(routePath), `missing build-id route: ${routePath}`).toBe(true);
  // pathToFileURL + @vite-ignore: missing route must not blow the suite at transform time.
  // Vitest still transforms the loaded TS module, so @/lib/build-id hits the hoisted mock.
  const mod = (await import(
    /* @vite-ignore */ pathToFileURL(routePath).href
  )) as RouteModule;
  expect(typeof mod.GET).toBe("function");
  return mod;
}

describe("PWA installed-app updates — build stamp", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempCwd(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "homepress-build-id-"));
    tempDirs.push(dir);
    return dir;
  }

  it("readWebBuildId prefers .next/BUILD_ID, falls back to web/.next/BUILD_ID, trims", async () => {
    const { readWebBuildId } = await loadBuildId();

    const primary = makeTempCwd();
    mkdirSync(path.join(primary, ".next"), { recursive: true });
    writeFileSync(path.join(primary, ".next", "BUILD_ID"), "  abc\n", "utf8");
    expect(readWebBuildId(primary)).toBe("abc");

    const nested = makeTempCwd();
    mkdirSync(path.join(nested, "web", ".next"), { recursive: true });
    writeFileSync(path.join(nested, "web", ".next", "BUILD_ID"), " def\t", "utf8");
    expect(readWebBuildId(nested)).toBe("def");

    const empty = makeTempCwd();
    expect(readWebBuildId(empty)).toBe("");
  });
});

describe("PWA installed-app updates — monitor", () => {
  it("start() is a no-op when bootId is empty", async () => {
    const { createPwaUpdateMonitor } = await loadPwaUpdate();
    const fetchBuildId = vi.fn().mockResolvedValue("anything");
    const onUpdateAvailable = vi.fn();
    const addVisibilityListener = vi.fn(() => () => {});

    const monitor = createPwaUpdateMonitor({
      bootId: "",
      fetchBuildId,
      onUpdateAvailable,
      addVisibilityListener,
    });
    monitor.start();

    expect(fetchBuildId).not.toHaveBeenCalled();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(addVisibilityListener).not.toHaveBeenCalled();
  });

  it("calls onUpdateAvailable only on non-empty mismatch", async () => {
    const { createPwaUpdateMonitor } = await loadPwaUpdate();

    const mismatchFetch = vi.fn().mockResolvedValue("bbb");
    const mismatchCb = vi.fn();
    const mismatch = createPwaUpdateMonitor({
      bootId: "aaa",
      fetchBuildId: mismatchFetch,
      onUpdateAvailable: mismatchCb,
      addVisibilityListener: () => () => {},
    });
    await mismatch.checkNow();
    expect(mismatchCb).toHaveBeenCalledTimes(1);

    const matchFetch = vi.fn().mockResolvedValue("aaa");
    const matchCb = vi.fn();
    const match = createPwaUpdateMonitor({
      bootId: "aaa",
      fetchBuildId: matchFetch,
      onUpdateAvailable: matchCb,
      addVisibilityListener: () => () => {},
    });
    await match.checkNow();
    expect(matchCb).not.toHaveBeenCalled();

    const emptyFetch = vi.fn().mockResolvedValue("");
    const emptyCb = vi.fn();
    const empty = createPwaUpdateMonitor({
      bootId: "aaa",
      fetchBuildId: emptyFetch,
      onUpdateAvailable: emptyCb,
      addVisibilityListener: () => () => {},
    });
    await empty.checkNow();
    expect(emptyCb).not.toHaveBeenCalled();

    const rejectFetch = vi.fn().mockRejectedValue(new Error("network"));
    const rejectCb = vi.fn();
    const reject = createPwaUpdateMonitor({
      bootId: "aaa",
      fetchBuildId: rejectFetch,
      onUpdateAvailable: rejectCb,
      addVisibilityListener: () => () => {},
    });
    await reject.checkNow();
    expect(rejectCb).not.toHaveBeenCalled();
  });

  it("checks on start, visibility, and interval; stop unsubscribes and clears", async () => {
    const { createPwaUpdateMonitor, PWA_UPDATE_CHECK_MS } = await loadPwaUpdate();
    expect(PWA_UPDATE_CHECK_MS).toBe(60 * 60 * 1000);

    const fetchBuildId = vi.fn().mockResolvedValue("aaa");
    const onUpdateAvailable = vi.fn();
    let visibilityHandler: (() => void) | null = null;
    const unsubscribe = vi.fn();
    const addVisibilityListener = vi.fn((handler: () => void) => {
      visibilityHandler = handler;
      return unsubscribe;
    });

    const timers: Array<{ id: number; cb: () => void; ms: number }> = [];
    let nextId = 1;
    const setIntervalFn = vi.fn((cb: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, cb, ms });
      return id as unknown as ReturnType<typeof setInterval>;
    });
    const clearIntervalFn = vi.fn((id: ReturnType<typeof setInterval>) => {
      const idx = timers.findIndex((t) => t.id === (id as unknown as number));
      if (idx >= 0) timers.splice(idx, 1);
    });

    const monitor = createPwaUpdateMonitor({
      bootId: "aaa",
      fetchBuildId,
      onUpdateAvailable,
      addVisibilityListener,
      intervalMs: 1000,
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
    });

    monitor.start();
    await vi.waitFor(() => expect(fetchBuildId).toHaveBeenCalledTimes(1));

    expect(addVisibilityListener).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(visibilityHandler).toBeTypeOf("function");

    visibilityHandler!();
    await vi.waitFor(() => expect(fetchBuildId).toHaveBeenCalledTimes(2));

    expect(timers).toHaveLength(1);
    timers[0]!.cb();
    await vi.waitFor(() => expect(fetchBuildId).toHaveBeenCalledTimes(3));

    const intervalId = setIntervalFn.mock.results[0]!.value;
    monitor.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(intervalId);

    const callsAfterStop = fetchBuildId.mock.calls.length;
    // Further ticks must not fetch (interval cleared; handler unsubscribed).
    expect(timers).toHaveLength(0);
    // Local copy + typeof guard: after toBeTypeOf, TS can narrow the outer
    // binding to `never` for a later optional call.
    const handlerAfterStop: (() => void) | null = visibilityHandler as
      | (() => void)
      | null;
    if (typeof handlerAfterStop === "function") {
      handlerAfterStop();
    }
    await Promise.resolve();
    expect(fetchBuildId).toHaveBeenCalledTimes(callsAfterStop);
  });
});

describe("PWA installed-app updates — SW / register / layout / Docker (source-read)", () => {
  it("sw.js has skipWaiting + clients.claim, passthrough fetch, no Cache Storage", () => {
    expect(existsSync(swPath), `missing service worker: ${swPath}`).toBe(true);
    const source = readFileSync(swPath, "utf8");

    expect(source).toMatch(/skipWaiting/);
    expect(source).toMatch(/clients\.claim/);
    expect(source).toMatch(/respondWith\s*\(/);
    expect(source).toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/caches\.open/);
    expect(source).not.toMatch(/cache\.put/);
    expect(source).not.toMatch(/cache\.addAll/);
  });

  it("pwa-register still registers /sw.js and calls registration.update on the check schedule", () => {
    expect(existsSync(registerPath), `missing PWA registrar: ${registerPath}`).toBe(
      true,
    );
    const source = readFileSync(registerPath, "utf8");

    expect(source).toMatch(/navigator\.serviceWorker\.register/);
    expect(source).toMatch(/["']\/sw\.js["']/);
    expect(source).toMatch(/scope:\s*["']\/["']/);
    expect(source).toMatch(/updateViaCache:\s*["']none["']/);
    expect(source).toMatch(/PWA_UPDATE_CHECK_MS/);
    expect(source).toMatch(/registration\.update|\.update\s*\(/);
    expect(source).not.toMatch(/controllerchange/);
  });

  it("root layout mounts PwaUpdateBar with bootId before children", () => {
    // Source-read only — importing layout.tsx pulls globals.css / Tailwind and blows the harness.
    expect(existsSync(layoutPath), `missing root layout: ${layoutPath}`).toBe(true);
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).toMatch(/from\s+["']@\/components\/pwa-update-bar["']/);
    expect(layoutSource).toMatch(/from\s+["']@\/lib\/build-id["']/);
    expect(layoutSource).toMatch(/readWebBuildId/);
    expect(layoutSource).toMatch(/<PwaUpdateBar\b/);
    expect(layoutSource).toMatch(/bootId=\{/);

    const barIdx = layoutSource.search(/<PwaUpdateBar\b/);
    const childrenIdx = layoutSource.indexOf("{children}");
    expect(barIdx, "PwaUpdateBar JSX missing").toBeGreaterThanOrEqual(0);
    expect(childrenIdx, "{children} missing").toBeGreaterThanOrEqual(0);
    expect(barIdx).toBeLessThan(childrenIdx);
  });

  it("Dockerfile runner stage copies web/public before chown and USER node", () => {
    expect(existsSync(dockerfilePath), `missing Dockerfile: ${dockerfilePath}`).toBe(
      true,
    );
    const source = readFileSync(dockerfilePath, "utf8");

    const runnerMatch = source.match(/AS\s+runner\b/i);
    expect(runnerMatch, "missing AS runner stage").toBeTruthy();
    const runnerIdx = runnerMatch!.index!;
    const userIdx = source.indexOf("USER node", runnerIdx);
    expect(userIdx, "USER node must follow AS runner").toBeGreaterThan(runnerIdx);

    const copyRe = /COPY\s+--from=builder\s+\/app\/web\/public\s+\.\/web\/public/;
    const copyIdx = source.search(copyRe);
    expect(copyIdx, "public COPY missing").toBeGreaterThanOrEqual(0);
    expect(copyIdx).toBeGreaterThan(runnerIdx);

    const chownIdx = source.indexOf("chown", runnerIdx);
    expect(chownIdx, "chown must follow AS runner").toBeGreaterThan(runnerIdx);

    expect(copyIdx).toBeLessThan(chownIdx);
    expect(copyIdx).toBeLessThan(userIdx);
  });
});

describe("PWA installed-app updates — GET /build-id", () => {
  beforeEach(() => {
    mocks.readWebBuildId.mockReset();
  });

  it("is force-dynamic and returns text/plain stamp with no-cache headers", async () => {
    expect(existsSync(routePath), `missing build-id route: ${routePath}`).toBe(true);

    mocks.readWebBuildId.mockReturnValue("stamp-1");
    const { GET, dynamic } = await loadRoute();
    expect(dynamic).toBe("force-dynamic");

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const cacheControl = response.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toMatch(/no-cache/);
    expect(cacheControl).toMatch(/no-store/);
    expect(cacheControl).toMatch(/must-revalidate/);
    expect(await response.text()).toBe("stamp-1");
  });

  it("returns 200 with empty body when stamp is missing", async () => {
    expect(existsSync(routePath), `missing build-id route: ${routePath}`).toBe(true);

    mocks.readWebBuildId.mockReturnValue("");
    const { GET } = await loadRoute();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});
