/// <reference types="@testing-library/jest-dom" />

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const themeState = vi.hoisted(() => ({
  resolvedTheme: "light" as string | undefined,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: themeState.resolvedTheme,
    setTheme: vi.fn(),
  }),
}));

const webRoot = path.resolve(__dirname, "../..");
const appRoot = path.join(webRoot, "app");
const layoutPath = path.join(appRoot, "layout.tsx");
const globalsCssPath = path.join(appRoot, "globals.css");
const helperPath = path.join(webRoot, "components", "pwa-theme-color.tsx");
const loginPagePath = path.join(appRoot, "login", "page.tsx");
const loginActionsPath = path.join(appRoot, "login", "actions.ts");
const middlewarePath = path.join(webRoot, "middleware.ts");
const issueMarkdownPath = path.join(webRoot, "components", "issues", "issue-markdown.tsx");

type HelperModule = {
  PwaThemeColor: ComponentType;
  PWA_THEME_COLOR_LIGHT: string;
  PWA_THEME_COLOR_DARK: string;
};

/**
 * File URL + @vite-ignore: Vite must not fail the whole suite at transform time
 * while pwa-theme-color.tsx is still missing (Task 1 red). existsSync surfaces
 * the missing helper as a clear TDD failure.
 */
async function loadHelper(): Promise<HelperModule> {
  expect(existsSync(helperPath), `missing PwaThemeColor helper: ${helperPath}`).toBe(true);

  const mod = (await import(/* @vite-ignore */ pathToFileURL(helperPath).href)) as HelperModule;
  expect(typeof mod.PwaThemeColor).toBe("function");
  expect(mod.PWA_THEME_COLOR_LIGHT).toBe("#ffffff");
  expect(mod.PWA_THEME_COLOR_DARK).toBe("#0a0a0a");
  return mod;
}

function mediaLessThemeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector('meta[name="theme-color"]:not([media])');
}

function clearThemeColorMetas() {
  for (const el of document.head.querySelectorAll('meta[name="theme-color"]')) {
    el.remove();
  }
}

beforeEach(() => {
  clearThemeColorMetas();
  themeState.resolvedTheme = "light";
});

afterEach(() => {
  cleanup();
  clearThemeColorMetas();
});

describe("PWA standalone shell", () => {
  it("keeps manifest display standalone with splash colors and root scope", async () => {
    const manifestPath = path.join(appRoot, "manifest.ts");
    expect(existsSync(manifestPath), `missing manifest module: ${manifestPath}`).toBe(true);

    const mod = await import(/* @vite-ignore */ pathToFileURL(manifestPath).href);
    const manifestFn = mod.default;
    expect(typeof manifestFn).toBe("function");

    const manifest = await Promise.resolve(manifestFn());

    expect(manifest.display).toBe("standalone");
    expect(manifest.display).not.toBe("fullscreen");
    expect(manifest).not.toHaveProperty("display_override");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.theme_color).toBe("#ffffff");
    expect(manifest.background_color).toBe("#ffffff");
  });

  it("exports viewport cover + light/dark themeColor and drops metadata.themeColor", () => {
    // Source-read only — importing layout.tsx pulls globals.css / Tailwind and blows the harness.
    expect(existsSync(layoutPath), `missing root layout: ${layoutPath}`).toBe(true);
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).toMatch(/export const viewport/);
    expect(layoutSource).toMatch(/viewportFit:\s*["']cover["']/);
    expect(layoutSource).toMatch(/prefers-color-scheme:\s*light/);
    expect(layoutSource).toMatch(/prefers-color-scheme:\s*dark/);
    expect(layoutSource).toMatch(/#ffffff/);
    expect(layoutSource).toMatch(/#0a0a0a/);

    expect(layoutSource).toMatch(/export const metadata/);
    expect(layoutSource).toMatch(/applicationName:\s*APP_NAME/);
    expect(layoutSource).toMatch(/appleWebApp:\s*\{/);

    const metadataMatch = layoutSource.match(
      /export const metadata(?::\s*\w+)?\s*=\s*\{([\s\S]*?)\n\};/,
    );
    expect(metadataMatch, "could not extract metadata object from layout.tsx").toBeTruthy();
    expect(metadataMatch![1]).not.toMatch(/\bthemeColor\b/);
  });

  it("mounts PwaThemeColor from root layout inside ThemeProvider", () => {
    expect(existsSync(layoutPath), `missing root layout: ${layoutPath}`).toBe(true);
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).toMatch(/from\s+["']@\/components\/pwa-theme-color["']/);
    expect(layoutSource).toMatch(/<PwaThemeColor\s*\/?>/);

    const themeOpen = layoutSource.indexOf("<ThemeProvider");
    const themeClose = layoutSource.indexOf("</ThemeProvider>");
    const helperMount = layoutSource.search(/<PwaThemeColor\s*\/?>/);

    expect(themeOpen).toBeGreaterThanOrEqual(0);
    expect(themeClose).toBeGreaterThan(themeOpen);
    expect(helperMount).toBeGreaterThan(themeOpen);
    expect(helperMount).toBeLessThan(themeClose);
  });

  it("writes media-less theme-color #ffffff for resolved light theme", async () => {
    themeState.resolvedTheme = "light";
    const { PwaThemeColor, PWA_THEME_COLOR_LIGHT } = await loadHelper();

    render(<PwaThemeColor />);

    const meta = mediaLessThemeColorMeta();
    expect(meta).not.toBeNull();
    expect(meta!.getAttribute("content")).toBe(PWA_THEME_COLOR_LIGHT);
    expect(meta!.getAttribute("content")).toBe("#ffffff");
  });

  it("writes media-less theme-color #0a0a0a for resolved dark theme", async () => {
    themeState.resolvedTheme = "dark";
    const { PwaThemeColor, PWA_THEME_COLOR_DARK } = await loadHelper();

    render(<PwaThemeColor />);

    const meta = mediaLessThemeColorMeta();
    expect(meta).not.toBeNull();
    expect(meta!.getAttribute("content")).toBe(PWA_THEME_COLOR_DARK);
    expect(meta!.getAttribute("content")).toBe("#0a0a0a");
  });

  it("updates media-less theme-color when resolvedTheme toggles after mount", async () => {
    themeState.resolvedTheme = "light";
    const { PwaThemeColor, PWA_THEME_COLOR_LIGHT, PWA_THEME_COLOR_DARK } = await loadHelper();

    const { rerender } = render(<PwaThemeColor />);
    expect(mediaLessThemeColorMeta()?.getAttribute("content")).toBe(PWA_THEME_COLOR_LIGHT);

    themeState.resolvedTheme = "dark";
    rerender(<PwaThemeColor />);

    expect(mediaLessThemeColorMeta()?.getAttribute("content")).toBe(PWA_THEME_COLOR_DARK);
  });

  it("skips media-less theme-color while resolvedTheme is undefined (hydration)", async () => {
    themeState.resolvedTheme = undefined;
    const { PwaThemeColor } = await loadHelper();

    render(<PwaThemeColor />);

    expect(mediaLessThemeColorMeta()).toBeNull();
  });

  it("pads body with env(safe-area-inset-*) on all four sides", () => {
    expect(existsSync(globalsCssPath), `missing globals.css: ${globalsCssPath}`).toBe(true);
    const css = readFileSync(globalsCssPath, "utf8");

    expect(css).toMatch(/body\s*\{/);
    expect(css).toMatch(/env\(\s*safe-area-inset-top/);
    expect(css).toMatch(/env\(\s*safe-area-inset-right/);
    expect(css).toMatch(/env\(\s*safe-area-inset-bottom/);
    expect(css).toMatch(/env\(\s*safe-area-inset-left/);
  });

  it("keeps login and session redirects inside the standalone window", () => {
    expect(existsSync(loginPagePath), `missing login page: ${loginPagePath}`).toBe(true);
    expect(existsSync(loginActionsPath), `missing login actions: ${loginActionsPath}`).toBe(true);
    expect(existsSync(middlewarePath), `missing middleware: ${middlewarePath}`).toBe(true);

    const loginPage = readFileSync(loginPagePath, "utf8");
    expect(loginPage).not.toMatch(/target=["']_blank["']/);
    expect(loginPage).not.toMatch(/window\.open/);
    expect(loginPage).toMatch(/router\.replace/);

    const loginActions = readFileSync(loginActionsPath, "utf8");
    expect(loginActions).toMatch(/sameSite:\s*["']lax["']/);
    expect(loginActions).toMatch(/path:\s*["']\/["']/);

    const middleware = readFileSync(middlewarePath, "utf8");
    expect(middleware).toMatch(/nextUrl\.clone\(\)/);
    expect(middleware).toMatch(/pathname\s*=\s*["']\/login["']/);
  });

  it("keeps issue article links leaving the app via target=_blank", () => {
    expect(existsSync(issueMarkdownPath), `missing issue-markdown: ${issueMarkdownPath}`).toBe(
      true,
    );
    const source = readFileSync(issueMarkdownPath, "utf8");
    expect(source).toMatch(/target=["']_blank["']/);
  });
});
