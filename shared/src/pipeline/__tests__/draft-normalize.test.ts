import { describe, it, expect } from "vitest";
import { ISSUE_DRAFT_MAX_CHARS, normalizeDraftMarkdown } from "../draft-normalize";

/**
 * Benign fixture: ordinary markdown plus a fenced code block and an inline
 * code span that quote `javascript:` / `data:` examples. Those code regions
 * must survive byte-identical — the "invisible to legitimate use" guard.
 */
const BENIGN_DRAFT_FIXTURE = [
  "# Tech Digest",
  "",
  "A [https link](https://example.com/a) and [mail](mailto:news@example.com)",
  "plus [relative](./page) and [fragment](#top).",
  "",
  "Quoted inline: `[x](javascript:alert(1))` and `![p](data:image/gif;base64,AAAA)`.",
  "",
  "```",
  'const demo = "[x](javascript:alert(1))";',
  'const img = "![p](data:image/gif;base64,AAAA)";',
  "```",
  "",
  "Trailing prose.",
].join("\n");

describe("ISSUE_DRAFT_MAX_CHARS", () => {
  it("is the 1_000_000-char backstop", () => {
    expect(ISSUE_DRAFT_MAX_CHARS).toBe(1_000_000);
  });
});

describe("normalizeDraftMarkdown — line endings", () => {
  it("collapses CRLF to a single LF (not two)", () => {
    expect(normalizeDraftMarkdown("a\r\nb")).toBe("a\nb");
  });

  it("converts lone CR to LF", () => {
    expect(normalizeDraftMarkdown("a\rb")).toBe("a\nb");
  });

  it("normalizes mixed CRLF and lone CR in one pass", () => {
    expect(normalizeDraftMarkdown("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("normalizeDraftMarkdown — control bytes", () => {
  it("strips NUL", () => {
    expect(normalizeDraftMarkdown("a\x00b")).toBe("ab");
  });

  it("strips C0 bytes in \\x01-\\x08", () => {
    expect(normalizeDraftMarkdown("a\x01\x08b")).toBe("ab");
  });

  it("strips vertical tab (\\x0B)", () => {
    expect(normalizeDraftMarkdown("a\x0Bb")).toBe("ab");
  });

  it("strips form feed (\\x0C)", () => {
    expect(normalizeDraftMarkdown("a\x0Cb")).toBe("ab");
  });

  it("strips C0 bytes in \\x0E-\\x1F", () => {
    expect(normalizeDraftMarkdown("a\x0E\x1Bb\x1F")).toBe("ab");
  });

  it("strips DEL (\\x7F)", () => {
    expect(normalizeDraftMarkdown("a\x7Fb")).toBe("ab");
  });

  it("keeps tab and newline", () => {
    expect(normalizeDraftMarkdown("a\tb\nc")).toBe("a\tb\nc");
  });
});

describe("normalizeDraftMarkdown — scheme scrub", () => {
  it("reduces a javascript: inline link to its text", () => {
    expect(normalizeDraftMarkdown("[x](javascript:alert(1))")).toBe("x");
  });

  it("drops a data: inline image entirely", () => {
    expect(normalizeDraftMarkdown("![p](data:image/gif;base64,AAAA)")).toBe("");
  });

  it("drops a javascript: inline image entirely", () => {
    expect(normalizeDraftMarkdown("![x](javascript:alert(1))")).toBe("");
  });

  it("drops a vbscript: link-definition line", () => {
    expect(normalizeDraftMarkdown("[r]: vbscript:x\nMore")).toBe("More");
  });

  it("drops a javascript: angle autolink", () => {
    expect(normalizeDraftMarkdown("see <javascript:alert(1)> end")).toBe("see  end");
  });

  it("passes http, https, and mailto links through", () => {
    const md = [
      "[a](http://example.com/a)",
      "[b](https://example.com/b)",
      "[c](mailto:news@example.com)",
    ].join("\n");
    expect(normalizeDraftMarkdown(md)).toBe(md);
  });

  it("passes relative and fragment destinations through", () => {
    const md = "[rel](./page) [frag](#top) [root](/abs)";
    expect(normalizeDraftMarkdown(md)).toBe(md);
  });

  it("passes mixed-case HTTPS:// destinations through byte-identical", () => {
    const md = "[Secure](HTTPS://Example.COM/x)";
    expect(normalizeDraftMarkdown(md)).toBe(md);
  });

  it("keeps http/https images and drops mailto images", () => {
    expect(normalizeDraftMarkdown("![ok](https://cdn.example.com/a.png)")).toBe(
      "![ok](https://cdn.example.com/a.png)",
    );
    expect(normalizeDraftMarkdown("![ok](http://cdn.example.com/a.png)")).toBe(
      "![ok](http://cdn.example.com/a.png)",
    );
    expect(normalizeDraftMarkdown("![no](mailto:a@b.com)")).toBe("");
  });

  it("does not strip HTML (policy is markdown-link syntax only)", () => {
    const md = '<script>alert(1)</script> and <a href="https://ok.example">x</a>';
    expect(normalizeDraftMarkdown(md)).toBe(md);
  });

  it("reduces a javascript: inline link with newline-spnl after ( to its text", () => {
    expect(normalizeDraftMarkdown("[a](\njavascript:alert(1))")).toBe("a");
  });

  it("drops a javascript: link-definition whose destination is on the next line", () => {
    expect(normalizeDraftMarkdown("[r]:\njavascript:x\n[r]")).toBe("[r]");
  });

  it("reduces a backslash-escaped-colon javascript: inline link to its text", () => {
    expect(normalizeDraftMarkdown("[a](javascript\\:alert(3))")).toBe("a");
  });

  it("passes a benign https destination with newline-spnl after ( byte-identical", () => {
    const md = "[a](\nhttps://ok.example)";
    expect(normalizeDraftMarkdown(md)).toBe(md);
  });
});

describe("normalizeDraftMarkdown — cap", () => {
  it("slices output to ISSUE_DRAFT_MAX_CHARS after scrub", () => {
    const md = "a".repeat(ISSUE_DRAFT_MAX_CHARS + 50);
    const out = normalizeDraftMarkdown(md);
    expect(out.length).toBe(ISSUE_DRAFT_MAX_CHARS);
    expect(out).toBe(md.slice(0, ISSUE_DRAFT_MAX_CHARS));
  });
});

describe("normalizeDraftMarkdown — benign fixture (code regions untouched)", () => {
  it("returns the fixture byte-identical, including fenced and inline javascript:/data: quotes", () => {
    const out = normalizeDraftMarkdown(BENIGN_DRAFT_FIXTURE);
    expect(out).toBe(BENIGN_DRAFT_FIXTURE);
    expect(out).toContain("[x](javascript:alert(1))");
    expect(out).toContain("![p](data:image/gif;base64,AAAA)");
  });
});
