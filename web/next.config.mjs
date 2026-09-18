import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Secret keys load from the repo `.env` ONLY in development. In production
// they arrive exclusively via the container environment (compose `env_file`)
// — never from the repo `.env`. Development needs this loader because Next
// auto-loads only `web/.env*`, not the repo root `.env`.
// MAINTENANCE: any new secret env key MUST be added to this denylist —
// fail-safe by default (X2). SETTINGS_SECRET_KEY is the at-rest cipher key.
const SECRET_ENV_KEYS = new Set([
  "APPWRITE_API_KEY",
  "OPENROUTER_API_KEY",
  "SMTP_PASSWORD",
  "SETTINGS_SECRET_KEY",
]);
const isDev = process.env.NODE_ENV === "development";

try {
  const content = readFileSync(resolve(__dirname, "..", ".env"), "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!isDev && SECRET_ENV_KEYS.has(key)) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // .env missing — best-effort load; fall back to process.env.
}

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // Keep node-appwrite (and its CJS deps) out of the webpack server-action
  // bundle. Bundling them breaks undici/json-bigint interop in production and
  // surfaces as TypeError: "a is not a function" on login (Client.call).
  serverExternalPackages: ["node-appwrite", "undici", "json-bigint"],
  async rewrites() {
    return [
      {
        source: "/rss/:newsletterId.xml",
        destination: "/rss/:newsletterId",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
