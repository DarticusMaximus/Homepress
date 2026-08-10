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

describe("deploy documentation smoke (docs/DEPLOY.md exists)", () => {
  it("exists and is non-empty", () => {
    expect(repoFileExists("docs/DEPLOY.md"), "docs/DEPLOY.md must exist").toBe(
      true,
    );
    const contents = readRepoFile("docs/DEPLOY.md");
    expect(contents.trim().length, "docs/DEPLOY.md must be non-empty").toBeGreaterThan(
      0,
    );
  });
});

/** Slice the Smoke checks section so /health response-field assertions stay scoped. */
function smokeChecksSection(contents: string): string {
  const start = contents.indexOf("## Smoke checks");
  expect(start, "docs/DEPLOY.md must have a ## Smoke checks section").toBeGreaterThanOrEqual(
    0,
  );
  const next = contents.indexOf("\n## ", start + 1);
  return next === -1 ? contents.slice(start) : contents.slice(start, next);
}

describe("deploy documentation smoke (docs/DEPLOY.md happy-path markers)", () => {
  it("contains required operator-facing happy-path markers", () => {
    expect(repoFileExists("docs/DEPLOY.md"), "docs/DEPLOY.md must exist").toBe(
      true,
    );
    const contents = readRepoFile("docs/DEPLOY.md");

    expect(contents).toContain("podman compose");
    expect(contents).toContain(".env.example");
    expect(contents).toContain("/health");
    expect(contents).toMatch(/ghcr\.io\/darticusmaximus\/homepress-web/);
    expect(contents).toMatch(/pull/i);

    // Minimal /health contract (S2): success is documented as { "status": "ok" }
    // only; a 200 probe means the Appwrite handshake worked. Do not teach
    // nested disclosure fields (endpoint / project / authenticated).
    expect(contents).toMatch(/"status"\s*:\s*"ok"/);
    expect(contents).toMatch(/Appwrite handshake/i);

    const smoke = smokeChecksSection(contents);
    // New minimal success example must appear as a complete JSON object (no
    // trailing nested keys). Old nested `"appwrite": { ... }` example must be gone.
    expect(smoke).toMatch(/\{\s*"status"\s*:\s*"ok"\s*\}/);
    expect(smoke).not.toMatch(/"authenticated"/);
    expect(smoke).not.toMatch(/"endpoint"/);
    expect(smoke).not.toMatch(/"project"/);

    expect(contents).toContain("NEXT_PUBLIC_APPWRITE_ENDPOINT");
    expect(contents).toContain("NEXT_PUBLIC_APPWRITE_PROJECT_ID");
    expect(contents).toContain("NEXT_PUBLIC_APPWRITE_PROJECT_NAME");
    expect(contents).toContain("OPENROUTER_API_KEY");
    expect(contents).toContain("APPWRITE_API_KEY");

    // External Appwrite: must mention Appwrite and that it is external / not started by us.
    expect(contents).toMatch(/Appwrite/i);
    expect(contents).toMatch(/external|not started by/i);

    // Operator / Auth login guidance.
    expect(contents).toMatch(/login/i);
    expect(contents).toMatch(/Auth|email/i);

    // Schema provision / worker boot note.
    expect(contents).toMatch(/provision|schema/i);
    expect(contents).toMatch(/worker/i);

    // SMTP optional for first smoke.
    expect(contents).toMatch(/SMTP/i);
    expect(contents).toMatch(/optional|not required/i);

    // Docker compatibility note.
    expect(contents).toContain("docker compose");

    // Common failures / troubleshooting section.
    expect(contents).toMatch(/common failures|troubleshooting/i);
  });
});

describe("deploy documentation smoke (README Deploy section)", () => {
  it("has a Deploy heading, links to docs/DEPLOY.md, and mentions podman compose", () => {
    const contents = readRepoFile("README.md");

    expect(contents).toMatch(/^##\s+Deploy\b/m);
    expect(contents).toMatch(/docs\/DEPLOY\.md/);
    expect(contents).toContain("podman compose");
  });
});

describe("deploy documentation smoke (README threshold docs preserved)", () => {
  it("still documents CROSS_RUN_SIMILARITY_THRESHOLD", () => {
    const contents = readRepoFile("README.md");
    expect(contents).toContain("CROSS_RUN_SIMILARITY_THRESHOLD");
  });
});
