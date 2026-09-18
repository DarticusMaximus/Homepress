import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function findRepoFile(name: string): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`${name} not found upward from ${process.cwd()}`);
    }
    dir = parent;
  }
}

const compose = readFileSync(findRepoFile("compose.yaml"), "utf8");

function serviceBlock(service: string): string {
  const lines = compose.split("\n");
  const start = lines.indexOf(`  ${service}:`);
  if (start === -1) {
    throw new Error(`service "${service}" not found in compose.yaml`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S.*:$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("compose.yaml X4 loopback port binding", () => {
  it("web publishes :3000 behind WEB_BIND_ADDR with a loopback default", () => {
    const web = serviceBlock("web");
    expect(web).toContain("ports:");
    expect(web).toContain('- "${WEB_BIND_ADDR:-127.0.0.1}:3000:3000"');
    expect(web).not.toContain('- "3000:3000"');
  });

  it("worker publishes no ports", () => {
    const worker = serviceBlock("worker");
    expect(worker).not.toContain("ports:");
  });

  it("web and worker both keep env_file: .env", () => {
    for (const service of ["web", "worker"]) {
      const block = serviceBlock(service);
      expect(block).toContain("env_file:");
      expect(block).toContain("- .env");
    }
  });
});
