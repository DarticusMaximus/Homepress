import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { LLMClient } from "../llm-client";
import type { ChatCompletionResult } from "../llm-client";
import { LLMNetworkError } from "../llm-client";
import { DEFAULT_TIMEOUT_MS } from "../config";
import { SHIPPED_TITLE_PROMPT, SHIPPED_DEK_PROMPT } from "../../prompts/defaults";
import { ISSUE_TITLE_ATTR_SIZE, ISSUE_DEK_ATTR_SIZE } from "../../schema/declarations";
import { ISSUE_DEK_MAX_CHARS } from "../../runs/issues";
import {
  TITLE_DEK_MAX_COMPLETION_TOKENS,
  parseGeneratedIssueTitle,
  parseGeneratedIssueDek,
  generateIssueTitle,
  generateIssueDek,
} from "../issue-metadata";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ChatOpts = {
  model: string;
  messages: { role: string; content: string }[];
  timeoutMs?: number;
  extraBody?: Record<string, unknown>;
};

function makeMockClient(
  chat: (options: ChatOpts) => Promise<ChatCompletionResult>,
): LLMClient {
  return { chatCompletion: vi.fn(chat) } as unknown as LLMClient;
}

function okContent(content: string): ChatCompletionResult {
  return { content, raw: {} };
}

const DRAFT_MARKDOWN = `# Weekly Digest

Labs shipped three agent tools this week. Read the full roundup below.
`;

const BASE_ARGS = {
  model: "vendor/title-dek-canary",
  draft: DRAFT_MARKDOWN,
  newsletterName: "Tech Trench",
  audience: "curious operators",
};

/**
 * Drive an async operation to completion under fake timers. `withRetry`
 * backoff uses `setTimeout`, so exhaustion tests must advance timers.
 */
async function runWithFakeTimers<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const tracked = p.then((r) => {
    done = true;
    return r;
  });
  let guard = 0;
  while (!done && guard < 1000) {
    await vi.advanceTimersByTimeAsync(1000);
    guard += 1;
  }
  if (!done) {
    throw new Error("promise never resolved under fake timers");
  }
  return tracked;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// 7. Parse: unwrap, ATX, leftover fence, empty / punctuation-only
// ===========================================================================

describe("parseGeneratedIssueTitle — unwrap and fail cases (test 7)", () => {
  it('trims and unwraps one matching wrap of quotes: `  "Hello World"  ` → Hello World', () => {
    expect(parseGeneratedIssueTitle('  "Hello World"  ')).toBe("Hello World");
  });

  it("unwraps matching backticks then strips one leading ATX # prefix", () => {
    expect(parseGeneratedIssueTitle("`# Hello World`")).toBe("Hello World");
  });

  it("unwraps a single complete fenced block", () => {
    expect(parseGeneratedIssueTitle("```\nHello World\n```")).toBe("Hello World");
  });

  it("returns null for leftover fence, empty quotes, and punctuation-only ellipsis", () => {
    expect(parseGeneratedIssueTitle("```\nHello World")).toBeNull();
    expect(parseGeneratedIssueTitle("```\nHello World\n``` leftover")).toBeNull();
    expect(parseGeneratedIssueTitle("Hello ``` World")).toBeNull();
    expect(parseGeneratedIssueTitle('""')).toBeNull();
    expect(parseGeneratedIssueTitle("")).toBeNull();
    expect(parseGeneratedIssueTitle("...")).toBeNull();
    expect(parseGeneratedIssueTitle('"..."')).toBeNull();
  });
});

// ===========================================================================
// 8. Clamp: 512 hard-slice; LLM dek is not 160-ellipsis-sliced
// ===========================================================================

describe("parse/clamp generated title and dek (test 8)", () => {
  it("hard-slices a 600-char title to ISSUE_TITLE_ATTR_SIZE (512) with no ellipsis", () => {
    const raw = "A".repeat(600);
    const parsed = parseGeneratedIssueTitle(raw);
    expect(ISSUE_TITLE_ATTR_SIZE).toBe(512);
    expect(parsed).toHaveLength(512);
    expect(parsed).toBe(raw.slice(0, ISSUE_TITLE_ATTR_SIZE));
    expect(parsed).not.toContain("…");
  });

  it("hard-slices a 600-char dek to ISSUE_DEK_ATTR_SIZE (512) with no 160-extractor ellipsis", () => {
    const raw = "B".repeat(600);
    const parsed = parseGeneratedIssueDek(raw);
    expect(ISSUE_DEK_ATTR_SIZE).toBe(512);
    expect(ISSUE_DEK_MAX_CHARS).toBe(160);
    expect(parsed).toHaveLength(512);
    expect(parsed).toBe(raw.slice(0, ISSUE_DEK_ATTR_SIZE));
    expect(parsed).not.toContain("…");
    expect(parsed!.length).toBeGreaterThan(ISSUE_DEK_MAX_CHARS);
  });
});

// ===========================================================================
// 9. generateIssueTitle — reads result.content, budget/timeout, retry → null
// ===========================================================================

describe("generateIssueTitle (test 9)", () => {
  it("reads result.content from { content, raw }, not a bare string", async () => {
    const client = makeMockClient(async () => ({ content: "Hello World", raw: {} }));
    const result = await generateIssueTitle({
      ...BASE_ARGS,
      promptTemplate: SHIPPED_TITLE_PROMPT,
      llm: client,
    });
    expect(result).toBe("Hello World");
  });

  it("sends max_completion_tokens 4000, DEFAULT_TIMEOUT_MS, model, and the rendered draft", async () => {
    let captured: ChatOpts | undefined;
    const client = makeMockClient(async (opts) => {
      captured = opts;
      return okContent("Hello World");
    });

    await generateIssueTitle({
      ...BASE_ARGS,
      promptTemplate: SHIPPED_TITLE_PROMPT,
      llm: client,
    });

    expect(TITLE_DEK_MAX_COMPLETION_TOKENS).toBe(4000);
    expect(captured?.extraBody?.max_completion_tokens).toBe(4000);
    expect(captured?.extraBody).not.toHaveProperty("reasoning_effort");
    expect(captured?.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(captured?.model).toBe(BASE_ARGS.model);
    expect(captured?.messages).toEqual([{ role: "user", content: expect.any(String) }]);
    expect(captured?.messages[0]?.content).toContain(DRAFT_MARKDOWN);
    expect(captured?.messages[0]?.content).toContain(BASE_ARGS.newsletterName);
    expect(captured?.messages[0]?.content).toContain(BASE_ARGS.audience);
    expect(captured?.messages[0]?.content).toContain("8 words");
  });

  it("returns null when withRetry exhausts", async () => {
    vi.useFakeTimers();
    const client = makeMockClient(async () => {
      throw new LLMNetworkError("always");
    });

    const result = await runWithFakeTimers(
      generateIssueTitle({
        ...BASE_ARGS,
        promptTemplate: SHIPPED_TITLE_PROMPT,
        llm: client,
      }),
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "generate-issue-title" }),
    );
    const logArg = vi.mocked(console.error).mock.calls[0]?.[0] as {
      message?: string;
      phase?: string;
    };
    expect(logArg?.message).not.toContain(DRAFT_MARKDOWN);
    expect(logArg?.message).not.toContain("Hello World");
  });
});

// ===========================================================================
// 10. generateIssueDek — dek template, same model, same 4000 budget
// ===========================================================================

describe("generateIssueDek (test 10)", () => {
  it("reads { content, raw }, uses the dek template and the same model id, 4000 tokens", async () => {
    let captured: ChatOpts | undefined;
    const client = makeMockClient(async (opts) => {
      captured = opts;
      return { content: "A calm digest dek.", raw: {} };
    });

    const result = await generateIssueDek({
      ...BASE_ARGS,
      promptTemplate: SHIPPED_DEK_PROMPT,
      llm: client,
    });

    expect(result).toBe("A calm digest dek.");
    expect(captured?.model).toBe(BASE_ARGS.model);
    expect(captured?.extraBody?.max_completion_tokens).toBe(4000);
    expect(captured?.extraBody).not.toHaveProperty("reasoning_effort");
    expect(captured?.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(captured?.messages[0]?.content).toContain(DRAFT_MARKDOWN);
    expect(captured?.messages[0]?.content).toContain("25 words");
    expect(captured?.messages[0]?.content).toContain("one- or two-sentence summary");
    expect(captured?.messages[0]?.content).not.toContain("8 words");
  });
});
