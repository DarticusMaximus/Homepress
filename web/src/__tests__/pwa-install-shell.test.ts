import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@newsletter/shared/client";
import { config as middlewareConfig } from "../../middleware";

const webRoot = path.resolve(__dirname, "../..");
const appRoot = path.join(webRoot, "app");
const publicIconsRoot = path.join(webRoot, "public", "icons");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const PUBLIC_ICON_PATHS = [
  path.join(publicIconsRoot, "icon-192.png"),
  path.join(publicIconsRoot, "icon-512.png"),
  path.join(publicIconsRoot, "icon-512-maskable.png"),
] as const;

const APP_ICON_PATHS = [
  path.join(appRoot, "favicon.ico"),
  path.join(appRoot, "icon.png"),
  path.join(appRoot, "apple-icon.png"),
] as const;

const EXPECTED_MANIFEST_ICONS = [
  {
    src: "/icons/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/icons/icon-512-maskable.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
] as const;

describe("PWA install shell", () => {
  it("exports a Homepress web app manifest with standalone display and install icons", async () => {
    // File URL + @vite-ignore: Vite must not fail the whole suite at transform
    // time while manifest.ts is still missing (Task 1 red), and Node must still
    // resolve the module once Task 3 adds it.
    const manifestPath = path.join(appRoot, "manifest.ts");
    expect(existsSync(manifestPath), `missing manifest module: ${manifestPath}`).toBe(true);

    const mod = await import(/* @vite-ignore */ pathToFileURL(manifestPath).href);
    const manifestFn = mod.default;
    expect(typeof manifestFn).toBe("function");

    const manifest = await Promise.resolve(manifestFn());

    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.short_name).toBe(APP_NAME);
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#ffffff");
    expect(manifest.background_color).toBe("#ffffff");
    expect(manifest.icons).toEqual(expect.arrayContaining([...EXPECTED_MANIFEST_ICONS]));
  });

  it("ships favicon, App Router icons, and public PWA PNG assets", () => {
    for (const iconPath of [...APP_ICON_PATHS, ...PUBLIC_ICON_PATHS]) {
      expect(existsSync(iconPath), `missing icon asset: ${iconPath}`).toBe(true);
    }
  });

  it("stores non-empty public PNG icons with a valid PNG header", () => {
    for (const iconPath of PUBLIC_ICON_PATHS) {
      const bytes = readFileSync(iconPath);
      expect(bytes.byteLength, `empty PNG: ${iconPath}`).toBeGreaterThan(0);
      expect(bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)).toBe(true);
    }
  });

  it("declares appleWebApp metadata in root layout source", () => {
    // Source-read only — importing layout.tsx pulls globals.css / Tailwind and blows the harness.
    // Live theme-color / viewport contract lives in pwa-standalone-shell.test.tsx (Stage 13).
    const layoutSource = readFileSync(path.join(appRoot, "layout.tsx"), "utf8");

    expect(layoutSource).toMatch(/export const metadata/);
    expect(layoutSource).toMatch(/applicationName:\s*APP_NAME/);
    expect(layoutSource).toMatch(/appleWebApp:\s*\{/);
    expect(layoutSource).toMatch(/capable:\s*true/);
    expect(layoutSource).toMatch(/title:\s*APP_NAME/);
  });

  it("keeps favicon, webmanifest, and png outside the auth middleware matcher", () => {
    expect(middlewareConfig.matcher).toBeDefined();
    const matcher = Array.isArray(middlewareConfig.matcher)
      ? middlewareConfig.matcher.join("\n")
      : String(middlewareConfig.matcher);

    expect(matcher).toContain("favicon.ico");
    expect(matcher).toContain("webmanifest");
    expect(matcher).toMatch(/\bpng\b/);
  });
});
