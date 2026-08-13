/// <reference types="@testing-library/jest-dom" />

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const webRoot = path.resolve(__dirname, "../..");
const barPath = path.join(webRoot, "components", "pwa-update-bar.tsx");

type BarModule = {
  PwaUpdateBar: ComponentType<{ bootId: string }>;
};

/**
 * File URL + @vite-ignore: Vite must not fail the whole suite at transform time
 * while pwa-update-bar.tsx is still missing (Task 1 red). existsSync surfaces
 * the missing component as a clear TDD failure.
 */
async function loadBar(): Promise<BarModule> {
  expect(existsSync(barPath), `missing PwaUpdateBar: ${barPath}`).toBe(true);

  const mod = (await import(/* @vite-ignore */ pathToFileURL(barPath).href)) as BarModule;
  expect(typeof mod.PwaUpdateBar).toBe("function");
  return mod;
}

function mockFetchOk(body: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "text/plain" }),
    text: async () => body,
  });
}

function mockFetchHtmlOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
    text: async () => "<html><body>login</body></html>",
  });
}

function mockFetchNotOk() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => "<html>login</html>",
  });
}

function expectBuildIdFetch(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledWith(
    "/build-id",
    expect.objectContaining({ cache: "no-store", redirect: "error" }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PwaUpdateBar", () => {
  it("stays hidden when fetched stamp matches bootId", async () => {
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchOk("boot-equal");
    vi.stubGlobal("fetch", fetchMock);

    render(<PwaUpdateBar bootId="boot-equal" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expectBuildIdFetch(fetchMock);
    expect(screen.queryByTestId("pwa-update-bar")).not.toBeInTheDocument();
  });

  it("shows exact copy and Reload on mismatch with no dismiss", async () => {
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchOk("new-stamp");
    vi.stubGlobal("fetch", fetchMock);

    render(<PwaUpdateBar bootId="old-stamp" />);

    const bar = await screen.findByTestId("pwa-update-bar");
    expectBuildIdFetch(fetchMock);
    expect(bar).toHaveAttribute("aria-label", "App update");
    const role = bar.getAttribute("role");
    expect(role === "status" || role === "region").toBe(true);
    expect(bar).toHaveTextContent("A new version is ready.");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toHaveAttribute(
      "id",
      "pwa-update-reload",
    );

    expect(screen.queryByRole("button", { name: /close|dismiss|later/i })).not.toBeInTheDocument();
    expect(bar.querySelector('[aria-label*="close" i]')).toBeNull();
  });

  it("Reload calls window.location.reload once", async () => {
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchOk("new-stamp");
    vi.stubGlobal("fetch", fetchMock);

    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(<PwaUpdateBar bootId="old-stamp" />);
    const reloadBtn = await screen.findByRole("button", { name: "Reload" });
    expectBuildIdFetch(fetchMock);
    fireEvent.click(reloadBtn);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("bar container is in-flow (no fixed or sticky)", async () => {
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchOk("new-stamp");
    vi.stubGlobal("fetch", fetchMock);

    render(<PwaUpdateBar bootId="old-stamp" />);
    const bar = await screen.findByTestId("pwa-update-bar");
    expectBuildIdFetch(fetchMock);
    const className = bar.className ?? "";
    expect(className.split(/\s+/)).not.toContain("fixed");
    expect(className.split(/\s+/)).not.toContain("sticky");
    expect(className).toMatch(/border-b/);
  });

  it("non-OK fetch stays silent (login HTML must not count as a stamp)", async () => {
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchNotOk();
    vi.stubGlobal("fetch", fetchMock);

    render(<PwaUpdateBar bootId="boot-1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expectBuildIdFetch(fetchMock);
    // Give the monitor a tick to settle without showing the bar.
    await waitFor(() => {
      expect(screen.queryByTestId("pwa-update-bar")).not.toBeInTheDocument();
    });
  });

  it("HTML 200 from /build-id stays silent (must not count as a stamp)", async () => {
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchHtmlOk();
    vi.stubGlobal("fetch", fetchMock);

    render(<PwaUpdateBar bootId="boot-1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expectBuildIdFetch(fetchMock);
    await waitFor(() => {
      expect(screen.queryByTestId("pwa-update-bar")).not.toBeInTheDocument();
    });
  });

  it("does not fetch in development even with a non-empty bootId", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { PwaUpdateBar } = await loadBar();
    const fetchMock = mockFetchOk("new-stamp");
    vi.stubGlobal("fetch", fetchMock);

    render(<PwaUpdateBar bootId="boot-1" />);

    expect(screen.queryByTestId("pwa-update-bar")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
