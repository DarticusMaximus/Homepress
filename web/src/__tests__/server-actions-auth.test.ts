import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { ForbiddenError } from "@/lib/auth/require-operator";

const mocks = vi.hoisted(() => {
  // Throwing recording spies: any seam touch is a violation and must never reach real I/O.
  const seamSpies: Array<{ seam: string; spy: ReturnType<typeof vi.fn> }> = [];
  const makeThrowingSpy = (seam: string) => {
    const spy = vi.fn(() => {
      throw new Error(`SEAM CALLED: ${seam}`);
    });
    seamSpies.push({ seam, spy });
    return spy;
  };
  return { getAuthenticatedUser: vi.fn(), seamSpies, makeThrowingSpy };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.makeThrowingSpy("next/cache.revalidatePath"),
}));

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  const mocked: Record<string, unknown> = { ...actual };
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value !== "function") continue;
    // Class constructors (e.g. SettingsRepositoryError) stay real so instanceof paths behave.
    if (/^class\s/.test(value.toString())) continue;
    mocked[key] = mocks.makeThrowingSpy(`@newsletter/shared.${key}`);
  }
  return mocked;
});

const WEB_DIR = path.resolve(__dirname, "..", "..");
const MIN_DISCOVERED_MODULES = 9;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", "build", ".turbo"]);

/** Logged-in household reader: valid session, no `operator` label. */
const READER_SESSION_USER = { $id: "user-reader", email: "reader@example.com", labels: [] };

// Allowlist: app/login/actions.ts is intentionally public — loginAction must be
// anonymous-reachable (it is the unauthenticated entry point) and logoutAction is
// best-effort/idempotent with nothing to protect. Adding any other module here is
// a conscious security decision that must be justified in this comment.
const ALLOWLIST = new Set(["app/login/actions.ts"]);

const requireUserImportPattern =
  /import\s*\{[\s\S]*?\brequireUser\b[\s\S]*?\}\s*from\s*"@\/lib\/auth\/require-user"/;
const requireOperatorImportPattern =
  /import\s*\{[\s\S]*?\brequireOperator\b[\s\S]*?\}\s*from\s*"@\/lib\/auth\/require-operator"/;
const requireUserCallPattern = /\brequireUser\s*\(\s*\)/;
const requireOperatorCallPattern = /\brequireOperator\s*\(\s*\)/;

type ActionModule = { relPath: string; specifier: string };
type ParsedExport = { name: string; body: string } | { name: string; unparseable: true };

let discovered: ActionModule[] | null = null;

function skipWhitespaceAndComments(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function skipStringLiteral(source: string, i: number): number {
  const quote = source[i];
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplateLiteral(source: string, i: number): number {
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") return i + 1;
    if (source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const c = source[i];
        if (c === "/" && source[i + 1] === "/") {
          while (i < source.length && source[i] !== "\n") i += 1;
          continue;
        }
        if (c === "/" && source[i + 1] === "*") {
          i += 2;
          while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
          i += 2;
          continue;
        }
        if (c === '"' || c === "'") {
          i = skipStringLiteral(source, i);
          continue;
        }
        if (c === "`") {
          i = skipTemplateLiteral(source, i);
          continue;
        }
        if (c === "{") depth += 1;
        else if (c === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplateLiteral(source, i);
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      out += " ";
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      out += " ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      i = skipStringLiteral(source, i);
      out += source.slice(start, i);
      continue;
    }
    if (c === "`") {
      const start = i;
      i = skipTemplateLiteral(source, i);
      out += source.slice(start, i);
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      out += " ";
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      out += " ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipStringLiteral(source, i);
      out += " ";
      continue;
    }
    if (c === "`") {
      i = skipTemplateLiteral(source, i);
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function hasTopLevelUseServer(source: string): boolean {
  let i = 0;
  let braceDepth = 0;
  let stmtStart = true;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    if (i >= source.length) break;
    const c = source[i];
    if (stmtStart && braceDepth === 0 && (c === '"' || c === "'")) {
      const start = i;
      i = skipStringLiteral(source, i);
      if (source.slice(start + 1, i - 1) === "use server") return true;
      stmtStart = false;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipStringLiteral(source, i);
      stmtStart = false;
      continue;
    }
    if (c === "`") {
      i = skipTemplateLiteral(source, i);
      stmtStart = false;
      continue;
    }
    if (c === "{") {
      braceDepth += 1;
      stmtStart = true;
      i += 1;
      continue;
    }
    if (c === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      stmtStart = true;
      i += 1;
      continue;
    }
    if (c === ";") {
      stmtStart = true;
      i += 1;
      continue;
    }
    stmtStart = false;
    i += 1;
  }
  return false;
}

function discoverActionModules(): ActionModule[] {
  if (discovered) return discovered;
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        const source = readFileSync(full, "utf8");
        if (hasTopLevelUseServer(source)) found.push(full);
      }
    }
  };
  walk(WEB_DIR);
  discovered = found
    .map((abs) => path.relative(WEB_DIR, abs).split(path.sep).join("/"))
    .filter((rel) => !ALLOWLIST.has(rel))
    .sort()
    .map((rel) => ({
      relPath: rel,
      specifier: `@/${rel.replace(/\.(?:d\.)?tsx?$|\.m?jsx?$/i, "")}`,
    }));
  return discovered;
}

// Locates the opening brace of the function body, skipping the parameter list
// and the return type (object literal types inside <> must not be mistaken for the body).
function functionBodyStart(source: string, from: number): number {
  let i = from;
  while (i < source.length && source[i] !== "(") i++;
  let parenDepth = 0;
  let angleDepth = 0;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") parenDepth += 1;
    else if (c === ")") parenDepth -= 1;
    else if (parenDepth === 0 && angleDepth === 0 && c === "<" && source[i + 1] !== "=")
      angleDepth += 1;
    else if (parenDepth === 0 && angleDepth > 0 && c === ">" && source[i - 1] !== "=")
      angleDepth -= 1;
    else if (parenDepth === 0 && angleDepth === 0 && c === "{") return i;
  }
  return -1;
}

function parseArrowFunctionBody(source: string, fromAfterAsync: number): string | null {
  let i = skipWhitespaceAndComments(source, fromAfterAsync);
  if (source[i] === "<") {
    let angle = 0;
    for (; i < source.length; i += 1) {
      if (source[i] === "<") angle += 1;
      else if (source[i] === ">") {
        angle -= 1;
        if (angle === 0) {
          i += 1;
          break;
        }
      }
    }
    i = skipWhitespaceAndComments(source, i);
  }
  if (source[i] === "(") {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '"' || c === "'") {
        i = skipStringLiteral(source, i);
        continue;
      }
      if (c === "`") {
        i = skipTemplateLiteral(source, i);
        continue;
      }
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      i += 1;
    }
  } else if (/[A-Za-z_$]/.test(source[i] ?? "")) {
    while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
  } else {
    return null;
  }
  i = skipWhitespaceAndComments(source, i);
  if (source[i] === ":") {
    i += 1;
    let angle = 0;
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    while (i < source.length) {
      i = skipWhitespaceAndComments(source, i);
      if (
        source[i] === "=" &&
        source[i + 1] === ">" &&
        angle === 0 &&
        paren === 0 &&
        brace === 0 &&
        bracket === 0
      ) {
        break;
      }
      const c = source[i];
      if (c === '"' || c === "'") {
        i = skipStringLiteral(source, i);
        continue;
      }
      if (c === "`") {
        i = skipTemplateLiteral(source, i);
        continue;
      }
      if (c === "<") angle += 1;
      else if (c === ">" && angle > 0) angle -= 1;
      else if (c === "(") paren += 1;
      else if (c === ")") paren -= 1;
      else if (c === "{") brace += 1;
      else if (c === "}") brace -= 1;
      else if (c === "[") bracket += 1;
      else if (c === "]") bracket -= 1;
      i += 1;
    }
  }
  i = skipWhitespaceAndComments(source, i);
  if (source[i] !== "=" || source[i + 1] !== ">") return null;
  i = skipWhitespaceAndComments(source, i + 2);
  if (source[i] === "{") {
    const end = matchingBrace(source, i);
    if (end === -1) return null;
    return source.slice(i, end + 1);
  }
  const exprStart = i;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'") {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplateLiteral(source, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "(") paren += 1;
    else if (c === ")") {
      if (paren === 0) break;
      paren -= 1;
    } else if (c === "{") brace += 1;
    else if (c === "}") {
      if (brace === 0) break;
      brace -= 1;
    } else if (c === "[") bracket += 1;
    else if (c === "]") {
      if (bracket === 0) break;
      bracket -= 1;
    } else if ((c === ";" || c === ",") && paren === 0 && brace === 0 && bracket === 0) {
      break;
    }
    i += 1;
  }
  if (i <= exprStart) return null;
  return source.slice(exprStart, i);
}

function parseAsyncValueBody(source: string, fromAfterAsync: number): string | null {
  const i = skipWhitespaceAndComments(source, fromAfterAsync);
  if (/^function\b/.test(source.slice(i))) {
    const start = functionBodyStart(source, i + "function".length);
    if (start === -1) return null;
    const end = matchingBrace(source, start);
    if (end === -1) return null;
    return source.slice(start, end + 1);
  }
  return parseArrowFunctionBody(source, fromAfterAsync);
}

function exportedAsyncFunctionBodies(source: string): ParsedExport[] {
  const bodies: ParsedExport[] = [];
  const seen = new Set<number>();

  const fnPattern = /export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = fnPattern.exec(source)) !== null) {
    seen.add(match.index);
    const name = match[1] as string;
    const start = functionBodyStart(source, match.index + match[0].length);
    if (start === -1) {
      bodies.push({ name, unparseable: true });
      continue;
    }
    const end = matchingBrace(source, start);
    if (end === -1) {
      bodies.push({ name, unparseable: true });
      continue;
    }
    bodies.push({ name, body: source.slice(start, end + 1) });
  }

  const arrowPattern = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/g;
  while ((match = arrowPattern.exec(source)) !== null) {
    if (seen.has(match.index)) continue;
    const name = match[1] as string;
    const body = parseAsyncValueBody(source, match.index + match[0].length);
    if (body === null) {
      bodies.push({ name, unparseable: true });
      continue;
    }
    bodies.push({ name, body });
  }
  return bodies;
}

function collectStaticConventionFailures(relPath: string, source: string): string[] {
  const failures: string[] = [];
  const sourceForImports = stripComments(source);
  const hasRequireUserImport = requireUserImportPattern.test(sourceForImports);
  const hasRequireOperatorImport = requireOperatorImportPattern.test(sourceForImports);
  if (!hasRequireUserImport && !hasRequireOperatorImport) {
    failures.push(
      `${relPath} (missing import of requireUser from "@/lib/auth/require-user" or requireOperator from "@/lib/auth/require-operator")`,
    );
  }
  for (const fn of exportedAsyncFunctionBodies(source)) {
    if ("unparseable" in fn) {
      failures.push(`${relPath}#${fn.name} (unparseable function body)`);
      continue;
    }
    const strippedBody = stripCommentsAndStrings(fn.body);
    const callsRequireUser = requireUserCallPattern.test(strippedBody);
    const callsRequireOperator = requireOperatorCallPattern.test(strippedBody);
    if (!callsRequireUser && !callsRequireOperator) {
      failures.push(`${relPath}#${fn.name} (no requireUser() or requireOperator() call)`);
    }
    if (callsRequireUser && !hasRequireUserImport) {
      failures.push(
        `${relPath}#${fn.name} (calls requireUser() but missing import from "@/lib/auth/require-user")`,
      );
    }
    if (callsRequireOperator && !hasRequireOperatorImport) {
      failures.push(
        `${relPath}#${fn.name} (calls requireOperator() but missing import from "@/lib/auth/require-operator")`,
      );
    }
  }
  return failures;
}

async function loadExports(mod: ActionModule): Promise<Record<string, unknown> | null> {
  try {
    return (await import(mod.specifier)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("server actions auth architecture (fail-closed)", () => {
  beforeEach(() => {
    mocks.getAuthenticatedUser.mockReset();
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    for (const { spy } of mocks.seamSpies) {
      spy.mockClear();
    }
  });

  it("discovers at least 9 non-allowlisted use-server modules", () => {
    const modules = discoverActionModules();
    expect(
      modules.length,
      `discovered (allowlist: ${[...ALLOWLIST].join(", ")}): ${modules.map((m) => m.relPath).join(", ")}`,
    ).toBeGreaterThanOrEqual(MIN_DISCOVERED_MODULES);
  });

  it("includes the health-card module and keeps login allowlisted", () => {
    const modules = discoverActionModules();
    expect(ALLOWLIST.has("app/login/actions.ts")).toBe(true);
    expect(modules.map((m) => m.relPath)).toContain("components/health-card/actions.ts");
    expect(modules.map((m) => m.relPath)).not.toContain("app/login/actions.ts");
  });

  it("every function export rejects with UnauthorizedError when unauthenticated (zero-args invocation)", async () => {
    const failures: string[] = [];
    for (const mod of discoverActionModules()) {
      const moduleExports = await loadExports(mod);
      if (moduleExports === null) {
        failures.push(`${mod.relPath} (module failed to load under the test mocks)`);
        continue;
      }
      for (const [name, exportValue] of Object.entries(moduleExports)) {
        if (typeof exportValue !== "function") continue;
        let threw = false;
        let rejection: unknown = null;
        try {
          await (exportValue as () => unknown)();
        } catch (error) {
          threw = true;
          rejection = error;
        }
        if (!threw) {
          failures.push(`${mod.relPath}#${name} (resolved instead of rejecting)`);
        } else if (!(rejection instanceof UnauthorizedError)) {
          const reason =
            rejection instanceof Error ? `${rejection.name}: ${rejection.message}` : String(rejection);
          failures.push(`${mod.relPath}#${name} (rejected with ${reason})`);
        }
      }
    }
    expect(failures, "exports not rejecting with UnauthorizedError when unauthenticated").toEqual([]);
  });

  it("no side-effect seam is called during unauthenticated invocation", async () => {
    const failures: string[] = [];
    for (const mod of discoverActionModules()) {
      const moduleExports = await loadExports(mod);
      if (moduleExports === null) continue;
      for (const [name, exportValue] of Object.entries(moduleExports)) {
        if (typeof exportValue !== "function") continue;
        for (const { spy } of mocks.seamSpies) {
          spy.mockClear();
        }
        try {
          await (exportValue as () => unknown)();
        } catch {
          // rejection expected; seam touches are recorded by the spies
        }
        const touched = mocks.seamSpies
          .filter(({ spy }) => spy.mock.calls.length > 0)
          .map(({ seam }) => seam);
        if (touched.length > 0) {
          failures.push(`${mod.relPath}#${name} (${touched.join(", ")})`);
        }
      }
    }
    expect(failures, "exports that reached a side-effect seam").toEqual([]);
  });

  it("every function export rejects with ForbiddenError when the session user is a reader (zero-args invocation)", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(READER_SESSION_USER);
    const failures: string[] = [];
    for (const mod of discoverActionModules()) {
      const moduleExports = await loadExports(mod);
      if (moduleExports === null) {
        failures.push(`${mod.relPath} (module failed to load under the test mocks)`);
        continue;
      }
      for (const [name, exportValue] of Object.entries(moduleExports)) {
        if (typeof exportValue !== "function") continue;
        let threw = false;
        let rejection: unknown = null;
        try {
          await (exportValue as () => unknown)();
        } catch (error) {
          threw = true;
          rejection = error;
        }
        if (!threw) {
          failures.push(`${mod.relPath}#${name} (resolved instead of rejecting)`);
        } else if (!(rejection instanceof ForbiddenError)) {
          const reason =
            rejection instanceof Error ? `${rejection.name}: ${rejection.message}` : String(rejection);
          failures.push(`${mod.relPath}#${name} (rejected with ${reason})`);
        }
      }
    }
    expect(failures, "exports not rejecting with ForbiddenError when the session user is a reader").toEqual(
      [],
    );
  });

  it("no side-effect seam is called during reader invocation", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(READER_SESSION_USER);
    const failures: string[] = [];
    for (const mod of discoverActionModules()) {
      const moduleExports = await loadExports(mod);
      if (moduleExports === null) continue;
      for (const [name, exportValue] of Object.entries(moduleExports)) {
        if (typeof exportValue !== "function") continue;
        for (const { spy } of mocks.seamSpies) {
          spy.mockClear();
        }
        try {
          await (exportValue as () => unknown)();
        } catch {
          // rejection expected; seam touches are recorded by the spies
        }
        const touched = mocks.seamSpies
          .filter(({ spy }) => spy.mock.calls.length > 0)
          .map(({ seam }) => seam);
        if (touched.length > 0) {
          failures.push(`${mod.relPath}#${name} (${touched.join(", ")})`);
        }
      }
    }
    expect(failures, "exports that reached a side-effect seam under a reader session").toEqual([]);
  });

  it("every export async function calls requireUser() or requireOperator() imported from the matching guard module", () => {
    const failures: string[] = [];
    for (const mod of discoverActionModules()) {
      const source = readFileSync(path.join(WEB_DIR, mod.relPath), "utf8");
      failures.push(...collectStaticConventionFailures(mod.relPath, source));
    }
    expect(failures, "non-conforming exports (static requireUser/requireOperator convention)").toEqual([]);
  });
});

describe("static guard check hardening (N2)", () => {
  it("fails when the only guard call is in a comment", () => {
    const source = `
      import { requireUser } from "@/lib/auth/require-user";
      export async function foo() {
        // await requireUser();
      }
    `;
    const failures = collectStaticConventionFailures("synth.ts", source);
    expect(failures.some((f) => f.includes("foo") && f.includes("no requireUser"))).toBe(true);
  });

  it("fails when the only guard call is in a string", () => {
    const source = `
      import { requireOperator } from "@/lib/auth/require-operator";
      export async function foo() {
        const x = "requireOperator()";
      }
    `;
    const failures = collectStaticConventionFailures("synth.ts", source);
    expect(failures.some((f) => f.includes("foo") && f.includes("no requireUser"))).toBe(true);
  });

  it("fails on an ungated export const async arrow", () => {
    const source = `
      import { requireOperator } from "@/lib/auth/require-operator";
      export const tempAction = async (input = {}) => {
        return 1;
      };
    `;
    const failures = collectStaticConventionFailures("synth.ts", source);
    expect(failures.some((f) => f.includes("tempAction") && f.includes("no requireUser"))).toBe(true);
  });

  it("passes a gated export const async arrow", () => {
    const source = `
      import { requireOperator } from "@/lib/auth/require-operator";
      export const tempAction = async (input = {}) => {
        await requireOperator();
        return 1;
      };
    `;
    expect(collectStaticConventionFailures("synth.ts", source)).toEqual([]);
  });

  it("treats unparseable bodies as failures", () => {
    const source = `
      import { requireUser } from "@/lib/auth/require-user";
      export async function foo() {
    `;
    const failures = collectStaticConventionFailures("synth.ts", source);
    expect(failures.some((f) => f.includes("foo") && f.includes("unparseable"))).toBe(true);
  });
});
