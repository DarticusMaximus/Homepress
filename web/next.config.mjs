import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // .env missing — best-effort load; fall back to process.env.
}

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
};

export default nextConfig;
