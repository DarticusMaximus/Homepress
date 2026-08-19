import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: could not locate pnpm-workspace.yaml above ${dir}`);
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function repoFileExists(relativePath: string): boolean {
  return existsSync(join(REPO_ROOT, relativePath));
}

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_APPWRITE_ENDPOINT",
  "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
  "NEXT_PUBLIC_APPWRITE_PROJECT_NAME",
  "APPWRITE_API_KEY",
  "OPENROUTER_API_KEY",
  "APP_PUBLIC_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "CROSS_RUN_SIMILARITY_THRESHOLD",
] as const;

const OPTIONAL_ENV_KNOBS = [
  "TAGGER_MODEL",
  "SCORER_MODEL",
  "DRAFTER_MODEL",
  "EMBED_MODEL",
  "WORKER_HEARTBEAT_MS",
  "WORKER_RUN_POLL_MS",
  "WORKER_SCHEDULE_POLL_MS",
  "WORKER_RETENTION_POLL_MS",
  "SCRAPER_TIMEOUT_MS",
  "SCRAPER_MIN_EXTRACTED_LENGTH",
  "TZ",
] as const;

const NEXT_PUBLIC_APPWRITE_KEYS = [
  "NEXT_PUBLIC_APPWRITE_ENDPOINT",
  "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
  "NEXT_PUBLIC_APPWRITE_PROJECT_NAME",
] as const;

/** Top-level compose service keys that must never appear (external infra). */
const FORBIDDEN_COMPOSE_SERVICE_KEYS = [
  "appwrite",
  "mail",
  "smtp",
  "postgres",
  "mysql",
] as const;

describe("production packaging docs (.env.example required keys)", () => {
  it("exists and documents each required key plus 0.85", () => {
    expect(repoFileExists(".env.example")).toBe(true);
    const contents = readRepoFile(".env.example");
    for (const key of REQUIRED_ENV_KEYS) {
      expect(contents, `.env.example missing required key ${key}`).toContain(key);
    }
    expect(contents).toContain("0.85");
  });
});

describe("production packaging docs (.env.example optional knobs)", () => {
  it("names each optional model/worker/scraper/TZ knob", () => {
    expect(repoFileExists(".env.example")).toBe(true);
    const contents = readRepoFile(".env.example");
    for (const knob of OPTIONAL_ENV_KNOBS) {
      expect(contents, `.env.example missing optional knob ${knob}`).toContain(knob);
    }
  });
});

describe("production packaging docs (compose.yaml two-service scope)", () => {
  it("exists with services web and worker only (no external infra services)", () => {
    expect(repoFileExists("compose.yaml")).toBe(true);
    const contents = readRepoFile("compose.yaml");
    expect(contents).toContain("services:");
    expect(contents).toMatch(/^\s+web:\s*$/m);
    expect(contents).toMatch(/^\s+worker:\s*$/m);

    for (const name of FORBIDDEN_COMPOSE_SERVICE_KEYS) {
      const serviceKey = new RegExp(`^\\s+${name}:\\s*$`, "m");
      expect(
        contents,
        `compose.yaml must not define service key ${name}:`,
      ).not.toMatch(serviceKey);
    }
  });
});

describe("production packaging docs (GHCR images + secret safety)", () => {
  it("compose pins GHCR images; Dockerfiles never bake Appwrite/OpenRouter secrets or NEXT_PUBLIC build-args", () => {
    expect(repoFileExists("compose.yaml")).toBe(true);
    expect(repoFileExists("web/Dockerfile")).toBe(true);
    expect(repoFileExists("worker/Dockerfile")).toBe(true);

    const compose = readRepoFile("compose.yaml");
    const webDockerfile = readRepoFile("web/Dockerfile");
    const workerDockerfile = readRepoFile("worker/Dockerfile");

    expect(compose).toContain("ghcr.io/darticusmaximus/homepress-web:0.1.4");
    expect(compose).toContain("ghcr.io/darticusmaximus/homepress-worker:0.1.4");

    // Narrow to the web service block (between web: and worker:).
    const webServiceMatch = compose.match(
      /^\s+web:\s*\n([\s\S]*?)(?=^\s+worker:\s*$|(?![\s\S]))/m,
    );
    expect(webServiceMatch, "compose.yaml missing web: service block").toBeTruthy();
    const webBlock = webServiceMatch![1];
    // Prebuilt images must not depend on compose build-args for Appwrite public config.
    expect(webBlock).not.toMatch(/^\s+args:\s*$/m);

    for (const key of NEXT_PUBLIC_APPWRITE_KEYS) {
      expect(webDockerfile, `web/Dockerfile must not ARG ${key}`).not.toMatch(
        new RegExp(`^ARG\\s+${key}\\b`, "m"),
      );
    }

    for (const dockerfile of [
      { path: "web/Dockerfile", contents: webDockerfile },
      { path: "worker/Dockerfile", contents: workerDockerfile },
    ]) {
      expect(
        dockerfile.contents,
        `${dockerfile.path} must not ARG APPWRITE_API_KEY`,
      ).not.toMatch(/^ARG\s+APPWRITE_API_KEY\b/m);
      expect(
        dockerfile.contents,
        `${dockerfile.path} must not ARG OPENROUTER_API_KEY`,
      ).not.toMatch(/^ARG\s+OPENROUTER_API_KEY\b/m);
      expect(
        dockerfile.contents,
        `${dockerfile.path} must not ENV APPWRITE_API_KEY=`,
      ).not.toMatch(/^ENV\s+APPWRITE_API_KEY=/m);
      expect(
        dockerfile.contents,
        `${dockerfile.path} must not ENV OPENROUTER_API_KEY=`,
      ).not.toMatch(/^ENV\s+OPENROUTER_API_KEY=/m);
    }
  });
});

describe("production packaging docs (root .dockerignore ignores secrets)", () => {
  it("exists and lists .env", () => {
    expect(repoFileExists(".dockerignore")).toBe(true);
    const contents = readRepoFile(".dockerignore");
    // Exact line `.env` (not only `.env.*`) so the real secrets file is ignored.
    expect(contents).toMatch(/^\.env\s*$/m);
  });
});
