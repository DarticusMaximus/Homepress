import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config as middlewareConfig } from "../../middleware";

const webRoot = path.resolve(__dirname, "../..");
const swPath = path.join(webRoot, "public", "sw.js");
const registerPath = path.join(webRoot, "components", "pwa-register.tsx");
const layoutPath = path.join(webRoot, "app", "layout.tsx");
const nextConfigPath = path.join(webRoot, "next.config.mjs");

describe("PWA Chromium installability", () => {
  it("ships a non-empty public service worker at /sw.js", () => {
    expect(existsSync(swPath), `missing service worker: ${swPath}`).toBe(true);
    const source = readFileSync(swPath, "utf8");
    expect(source.trim().length, "empty service worker").toBeGreaterThan(0);
  });

  it("registers a real fetch handler that pass-through fetches the request", () => {
    expect(existsSync(swPath), `missing service worker: ${swPath}`).toBe(true);
    const source = readFileSync(swPath, "utf8");

    expect(source).toMatch(/addEventListener\s*\(\s*["']fetch["']/);
    expect(source).toMatch(/respondWith\s*\(/);
    expect(source).toMatch(/respondWith\s*\(\s*fetch\s*\(\s*(?:event|e)\.request\s*\)/);
  });

  it("does not use the Cache Storage API", () => {
    expect(existsSync(swPath), `missing service worker: ${swPath}`).toBe(true);
    const source = readFileSync(swPath, "utf8");
    expect(source).not.toMatch(/caches\.open/);
    expect(source).not.toMatch(/cache\.put/);
    expect(source).not.toMatch(/cache\.addAll/);
    expect(source).not.toMatch(/cache\.add\s*\(/);
  });

  it("ships a client registrar that registers /sw.js at origin scope", () => {
    expect(existsSync(registerPath), `missing PWA registrar: ${registerPath}`).toBe(true);
    const source = readFileSync(registerPath, "utf8");

    expect(source).toMatch(/^["']use client["']/m);
    expect(source).toMatch(/navigator\.serviceWorker\.register/);
    expect(source).toMatch(/["']\/sw\.js["']/);
    expect(source).toMatch(/scope:\s*["']\/["']/);
    expect(source).toMatch(/updateViaCache:\s*["']none["']/);
  });

  it("mounts the PWA registrar from root layout source", () => {
    // Source-read only — importing layout.tsx pulls globals.css / Tailwind and blows the harness.
    expect(existsSync(layoutPath), `missing root layout: ${layoutPath}`).toBe(true);
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(layoutSource).toMatch(/PwaRegister/);
    expect(layoutSource).toMatch(/from\s+["'][^"']*pwa-register["']/);
    expect(layoutSource).toMatch(/<PwaRegister\s*\/?>/);
  });

  it("keeps js (including /sw.js) outside the auth middleware matcher", () => {
    expect(middlewareConfig.matcher).toBeDefined();
    const matcher = Array.isArray(middlewareConfig.matcher)
      ? middlewareConfig.matcher.join("\n")
      : String(middlewareConfig.matcher);

    // Static-extension negative lookahead group must still include js so /sw.js
    // loads without a session (same pin as Stage 12 favicon/png/webmanifest).
    expect(matcher).toMatch(/\bjs\b/);
  });

  it("serves /sw.js with no-cache headers in next.config", () => {
    expect(existsSync(nextConfigPath), `missing next config: ${nextConfigPath}`).toBe(true);
    const source = readFileSync(nextConfigPath, "utf8");

    expect(source).toMatch(/["']\/sw\.js["']/);
    expect(source).toMatch(/Cache-Control/);
    expect(source).toMatch(/no-cache/);
    expect(source).toMatch(/no-store|must-revalidate/);
  });
});
