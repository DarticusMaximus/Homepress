/**
 * Persisted-draft normalization (S12). Applied at NewsletterDrafter.draft()
 * success return so every stored draft is line-ending-normalized, stripped of
 * C0/DEL controls, and free of markdown-link destinations whose scheme is not
 * http/https/mailto. Inline code spans and fenced code blocks are copied
 * through untouched — a tech digest quoting `[x](javascript:alert(1))` inside
 * code must survive byte-identical.
 */

/** Generous backstop; the model's output-token limit is the effective bound. */
export const ISSUE_DRAFT_MAX_CHARS = 1_000_000;

// eslint-disable-next-line no-control-regex -- Spec §5: strip C0 + DEL; keep tab/newline
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const SCHEME_AT_START = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto"]);
const ALLOWED_IMAGE_SCHEMES = new Set(["http", "https"]);

/**
 * Normalize model-emitted markdown: CRLF/CR → LF, strip controls, scrub
 * disallowed markdown-link schemes outside code, then cap length.
 * Benign drafts (including code-embedded javascript:/data: examples) come
 * through byte-identical.
 */
export function normalizeDraftMarkdown(md: string): string {
  const stepped = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(CONTROL_CHARS, "");
  const scrubbed = scrubMarkdownSchemes(stepped);
  return scrubbed.length > ISSUE_DRAFT_MAX_CHARS
    ? scrubbed.slice(0, ISSUE_DRAFT_MAX_CHARS)
    : scrubbed;
}

function unwrapDest(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function destinationScheme(raw: string): string | null {
  const dest = unwrapDest(raw);
  const m = SCHEME_AT_START.exec(dest);
  if (!m) return null;
  return m[0].slice(0, -1).toLowerCase();
}

/** Backslash before the first `:` hides a scheme from SCHEME_AT_START (CommonMark unescapes it). */
function hasBackslashBeforeColon(raw: string): boolean {
  const dest = unwrapDest(raw);
  const colon = dest.indexOf(":");
  if (colon === -1) return false;
  const bs = dest.indexOf("\\");
  return bs !== -1 && bs < colon;
}

function isBadLinkDest(raw: string): boolean {
  if (hasBackslashBeforeColon(raw)) return true;
  const scheme = destinationScheme(raw);
  if (scheme === null) return false;
  return !ALLOWED_LINK_SCHEMES.has(scheme);
}

function keepImageDest(raw: string): boolean {
  if (hasBackslashBeforeColon(raw)) return false;
  const scheme = destinationScheme(raw);
  return scheme !== null && ALLOWED_IMAGE_SCHEMES.has(scheme);
}

function atLineStart(md: string, i: number): boolean {
  return i === 0 || md.charCodeAt(i - 1) === 10;
}

/**
 * CommonMark opening fence: 0–3 spaces, then 3+ backticks or tildes, rest of
 * the line is the info string (backtick fences may not contain backticks).
 * Requires a terminating newline — a fence is a block.
 */
function matchOpeningFence(
  md: string,
  i: number,
): { char: string; len: number; end: number } | null {
  let j = i;
  let spaces = 0;
  while (spaces < 3 && md[j] === " ") {
    spaces += 1;
    j += 1;
  }
  const ch = md[j];
  if (ch !== "`" && ch !== "~") return null;
  let len = 0;
  while (md[j + len] === ch) len += 1;
  if (len < 3) return null;
  let k = j + len;
  while (k < md.length && md[k] !== "\n") {
    if (ch === "`" && md[k] === "`") return null;
    k += 1;
  }
  if (k >= md.length) return null;
  return { char: ch, len, end: k + 1 };
}

/** Closing fence of the same character, length ≥ opener; unclosed → EOF. */
function findClosingFence(md: string, from: number, char: string, minLen: number): number {
  let i = from;
  while (i < md.length) {
    const lineStart = i;
    let j = i;
    let spaces = 0;
    while (spaces < 3 && md[j] === " ") {
      spaces += 1;
      j += 1;
    }
    if (md[j] === char) {
      let len = 0;
      while (md[j + len] === char) len += 1;
      if (len >= minLen) {
        let k = j + len;
        while (k < md.length && (md[k] === " " || md[k] === "\t")) k += 1;
        if (k >= md.length || md[k] === "\n") {
          return k < md.length ? k + 1 : md.length;
        }
      }
    }
    const nl = md.indexOf("\n", lineStart);
    if (nl === -1) return md.length;
    i = nl + 1;
  }
  return md.length;
}

/** Matching backtick run of the same length, or null if unmatched. */
function matchInlineCodeEnd(md: string, i: number): number | null {
  if (md[i] !== "`") return null;
  let n = 0;
  while (md[i + n] === "`") n += 1;
  let j = i + n;
  while (j < md.length) {
    if (md[j] === "`") {
      let m = 0;
      while (md[j + m] === "`") m += 1;
      if (m === n) return j + m;
      j += m;
    } else {
      j += 1;
    }
  }
  return null;
}

function skipHorizontalWs(md: string, j: number): number {
  while (md[j] === " " || md[j] === "\t") j += 1;
  return j;
}

/** CommonMark spnl: optional spaces/tabs, at most one line ending, then optional spaces/tabs. */
function skipSpnl(md: string, j: number): number {
  j = skipHorizontalWs(md, j);
  if (md[j] === "\n") {
    j += 1;
    j = skipHorizontalWs(md, j);
  }
  return j;
}

/**
 * Parse a `(destination "title")` / `(destination)` starting at `(`.
 * Returns the raw destination token (possibly `<>`-wrapped) and the index
 * after the closing `)`.
 */
function parseParenDestination(
  md: string,
  openParen: number,
): { dest: string; end: number } | null {
  const j = skipSpnl(md, openParen + 1);
  if (j >= md.length) return null;

  let dest: string;
  let k: number;
  if (md[j] === "<") {
    const gt = md.indexOf(">", j + 1);
    if (gt === -1 || md.slice(j, gt).includes("\n")) return null;
    dest = md.slice(j, gt + 1);
    k = gt + 1;
  } else {
    k = j;
    let destDepth = 0;
    while (k < md.length) {
      const c = md[k];
      if (c === "\\" && k + 1 < md.length) {
        k += 2;
        continue;
      }
      if (c === "(") destDepth += 1;
      else if (c === ")") {
        if (destDepth === 0) break;
        destDepth -= 1;
      } else if (c === " " || c === "\t" || c === "\n") {
        if (destDepth === 0) break;
      }
      k += 1;
    }
    dest = md.slice(j, k);
  }

  k = skipHorizontalWs(md, k);
  if (md[k] === '"' || md[k] === "'" || md[k] === "(") {
    const closer = md[k] === "(" ? ")" : md[k];
    k += 1;
    while (k < md.length && md[k] !== closer && md[k] !== "\n") {
      if (md[k] === "\\") k += 1;
      k += 1;
    }
    if (md[k] !== closer) return null;
    k += 1;
    k = skipHorizontalWs(md, k);
  }
  if (md[k] !== ")") return null;
  return { dest, end: k + 1 };
}

function matchInlineLink(
  md: string,
  i: number,
): { text: string; dest: string; end: number } | null {
  if (md[i] !== "[") return null;
  let j = i + 1;
  let depth = 1;
  while (j < md.length && depth > 0) {
    if (md[j] === "\\") {
      j += 2;
      continue;
    }
    if (md[j] === "[") depth += 1;
    else if (md[j] === "]") depth -= 1;
    if (depth > 0) j += 1;
  }
  if (depth !== 0) return null;
  if (md[j] !== "]" || md[j + 1] !== "(") return null;
  const text = md.slice(i + 1, j);
  const parsed = parseParenDestination(md, j + 1);
  if (!parsed) return null;
  return { text, dest: parsed.dest, end: parsed.end };
}

function matchInlineImage(md: string, i: number): { dest: string; end: number } | null {
  if (md[i] !== "!" || md[i + 1] !== "[") return null;
  const link = matchInlineLink(md, i + 1);
  if (!link) return null;
  return { dest: link.dest, end: link.end };
}

/** CommonMark-ish `[label]: dest` at line start, 0–3 space indent; dest may follow one spnl. */
function matchLinkDefinition(md: string, i: number): { dest: string; end: number } | null {
  let j = i;
  let spaces = 0;
  while (spaces < 3 && md[j] === " ") {
    spaces += 1;
    j += 1;
  }
  if (md[j] !== "[") return null;
  const close = md.indexOf("]", j + 1);
  if (close === -1) return null;
  if (md.slice(j + 1, close).includes("\n")) return null;
  if (md[close + 1] !== ":") return null;
  j = skipSpnl(md, close + 2);
  if (j >= md.length || md[j] === "\n") return null;

  let dest: string;
  let afterDest: number;
  if (md[j] === "<") {
    const gt = md.indexOf(">", j + 1);
    if (gt === -1 || md.slice(j, gt).includes("\n")) return null;
    dest = md.slice(j, gt + 1);
    afterDest = gt + 1;
  } else {
    let k = j;
    while (k < md.length && md[k] !== " " && md[k] !== "\t" && md[k] !== "\n") k += 1;
    dest = md.slice(j, k);
    afterDest = k;
  }

  let end = afterDest;
  while (end < md.length && md[end] !== "\n") end += 1;
  if (end < md.length) end += 1;
  return { dest, end };
}

function matchAutolink(md: string, i: number): { dest: string; end: number } | null {
  if (md[i] !== "<") return null;
  const m = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]*)>/.exec(md.slice(i));
  if (!m || m[1] === undefined) return null;
  return { dest: m[1], end: i + m[0].length };
}

/**
 * Walk the markdown once. Fenced blocks and inline code spans are jumped
 * over as part of the unchanged run (never rewritten). Only prose regions
 * are considered for link/image/autolink/definition scheme scrubbing.
 */
function scrubMarkdownSchemes(md: string): string {
  let out = "";
  let i = 0;
  let runStart = 0;
  const n = md.length;

  const flush = (upto: number): void => {
    if (upto > runStart) out += md.slice(runStart, upto);
  };

  const replace = (from: number, to: number, replacement: string): void => {
    flush(from);
    out += replacement;
    i = to;
    runStart = to;
  };

  while (i < n) {
    if (atLineStart(md, i)) {
      const fence = matchOpeningFence(md, i);
      if (fence) {
        i = findClosingFence(md, fence.end, fence.char, fence.len);
        continue;
      }
      const def = matchLinkDefinition(md, i);
      if (def) {
        if (isBadLinkDest(def.dest)) {
          replace(i, def.end, "");
          continue;
        }
        i = def.end;
        continue;
      }
    }

    if (md[i] === "`") {
      const end = matchInlineCodeEnd(md, i);
      if (end !== null) {
        i = end;
        continue;
      }
    }

    if (md[i] === "!" && md[i + 1] === "[") {
      const img = matchInlineImage(md, i);
      if (img) {
        if (keepImageDest(img.dest)) {
          i = img.end;
          continue;
        }
        replace(i, img.end, "");
        continue;
      }
    }

    if (md[i] === "[") {
      const link = matchInlineLink(md, i);
      if (link) {
        if (isBadLinkDest(link.dest)) {
          replace(i, link.end, link.text);
          continue;
        }
        i = link.end;
        continue;
      }
    }

    if (md[i] === "<") {
      const auto = matchAutolink(md, i);
      if (auto) {
        if (isBadLinkDest(auto.dest)) {
          replace(i, auto.end, "");
          continue;
        }
        i = auto.end;
        continue;
      }
    }

    i += 1;
  }

  flush(n);
  return out;
}
