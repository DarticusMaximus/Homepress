import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read the Next.js build stamp from disk.
 * Server-only — do not import from client components.
 *
 * Tries `.next/BUILD_ID` first (`next start` from `web/`), then
 * `web/.next/BUILD_ID` (compose image: WORKDIR /app, `node web/server.js`).
 */
export function readWebBuildId(cwd = process.cwd()): string {
  const candidates = [
    join(cwd, ".next", "BUILD_ID"),
    join(cwd, "web", ".next", "BUILD_ID"),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8").trim();
    } catch {
      // Missing or unreadable — try next candidate.
    }
  }

  return "";
}
