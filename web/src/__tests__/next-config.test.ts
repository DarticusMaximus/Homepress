import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => {
  const mocked = { readFileSync: mocks.readFileSync };
  return { ...mocked, default: mocked };
});

// Fixture .env served by the fs mock — one public key for every case, plus
// the secret keys driving the X2 loader cases (Task 5).
const FIXTURE_ENV: Record<string, string> = {
  NEXT_PUBLIC_APPWRITE_ENDPOINT: "https://fixture.appwrite.test/v1",
  APPWRITE_API_KEY: "fixture-appwrite-api-key",
  OPENROUTER_API_KEY: "fixture-openrouter-api-key",
  SMTP_PASSWORD: "fixture-smtp-password",
  SETTINGS_SECRET_KEY: "fixture-settings-secret-key",
};

interface LoadNextConfigOptions {
  nodeEnv?: string;
  fixtureEnv?: Record<string, string> | null;
}

const envRestore = new Map<string, string | undefined>();

function serializeEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

async function loadNextConfig(options: LoadNextConfigOptions = {}) {
  const nodeEnv = options.nodeEnv ?? "test";
  const fixtureEnv = options.fixtureEnv === undefined ? FIXTURE_ENV : options.fixtureEnv;

  for (const key of Object.keys(fixtureEnv ?? {})) {
    if (!envRestore.has(key)) envRestore.set(key, process.env[key]);
    delete process.env[key];
  }

  mocks.readFileSync.mockImplementation((path: unknown) => {
    if (fixtureEnv && String(path).endsWith("/.env")) {
      return serializeEnv(fixtureEnv);
    }
    const err = new Error(`ENOENT: no such file or directory, open '${String(path)}'`) as Error & {
      code: string;
    };
    err.code = "ENOENT";
    throw err;
  });

  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("../../next.config.mjs");
}

afterEach(() => {
  for (const [key, value] of envRestore) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envRestore.clear();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("next.config.mjs X1 security headers (no CSP)", () => {
  it("(c) headers() sends all four security headers on /:path*", async () => {
    const { default: config } = await loadNextConfig();
    const entries = await config.headers!();

    const catchAll = entries.find((entry) => entry.source === "/:path*");
    expect(catchAll).toBeDefined();
    expect(catchAll!.headers).toEqual([
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ]);
  });

  it("(c) keeps the /sw.js headers entry unchanged", async () => {
    const { default: config } = await loadNextConfig();
    const entries = await config.headers!();

    expect(entries.find((entry) => entry.source === "/sw.js")).toEqual({
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      ],
    });
  });

  it("(d) disables the X-Powered-By header", async () => {
    const { default: config } = await loadNextConfig();
    expect(config.poweredByHeader).toBe(false);
  });

  it("(e) still rewrites /rss/:newsletterId.xml to /rss/:newsletterId", async () => {
    const { default: config } = await loadNextConfig();
    const rewrites = await config.rewrites!();
    expect(rewrites).toEqual(
      expect.arrayContaining([
        { source: "/rss/:newsletterId.xml", destination: "/rss/:newsletterId" },
      ]),
    );
  });
});

describe("next.config.mjs X2 env-loader secret restriction", () => {
  const SECRET_KEYS = [
    "APPWRITE_API_KEY",
    "OPENROUTER_API_KEY",
    "SMTP_PASSWORD",
    "SETTINGS_SECRET_KEY",
  ];

  it("(a) production: secret keys are NOT injected from the repo .env, public keys are", async () => {
    await loadNextConfig({ nodeEnv: "production" });

    for (const key of SECRET_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }
    expect(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).toBe("https://fixture.appwrite.test/v1");
  });

  it("(b) development: secret keys ARE injected from the repo .env", async () => {
    await loadNextConfig({ nodeEnv: "development" });

    for (const key of SECRET_KEYS) {
      expect(process.env[key]).toBe(FIXTURE_ENV[key]);
    }
  });
});
