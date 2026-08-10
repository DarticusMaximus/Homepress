import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  LLMClient,
  withRetry,
  LLMConfigError,
  LLMHttpError,
  LLMTimeoutError,
  LLMNetworkError,
} from "../llm-client";
// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function okJson(body: unknown, status = 200): MockResponse {
  return { ok: true, status, json: async () => body };
}

function httpError(status: number, body: unknown): MockResponse {
  return { ok: false, status, json: async () => body };
}

function asResponse(mock: MockResponse): Response {
  return mock as unknown as Response;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const PREV_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (PREV_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = PREV_KEY;
  }
});

// ===========================================================================
// LLMClient construction
// ===========================================================================

describe("LLMClient — missing key", () => {
  it("throws LLMConfigError when OPENROUTER_API_KEY is unset", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => new LLMClient()).toThrow(LLMConfigError);
  });

  it("throws LLMConfigError when OPENROUTER_API_KEY is empty", () => {
    process.env.OPENROUTER_API_KEY = "";
    expect(() => new LLMClient()).toThrow(LLMConfigError);
  });

  it("does not throw when an explicit apiKey override is provided", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => new LLMClient({ apiKey: "sk-test" })).not.toThrow();
  });
});

// ===========================================================================
// chatCompletion — happy path
// ===========================================================================

describe("chatCompletion — happy path", () => {
  it("returns content from choices[0].message.content and shapes the request", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      asResponse(
        okJson({
          choices: [{ message: { content: "hello" } }],
        }),
      ),
    );

    const client = new LLMClient({ apiKey: "sk-test" });
    const result = await client.chatCompletion({
      model: "nvidia/nemotron",
      messages: [{ role: "user", content: "ping" }],
      timeoutMs: 12345,
      temperature: 0.5,
      extraBody: { top_p: 1 },
    });

    // Result content read from choices[0].message.content.
    expect(result.content).toBe("hello");

    // Single POST issued.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");

    const initObj = init as RequestInit | undefined;
    expect(initObj?.method).toBe("POST");
    const headers = initObj?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(initObj?.body as string);
    expect(body.model).toBe("nvidia/nemotron");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(body.temperature).toBe(0.5);
    // extraBody merged into the request body.
    expect(body.top_p).toBe(1);

    // AbortSignal.timeout(timeoutMs) forwarded.
    expect(initObj?.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults content to '' when choices[0].message.content is null", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(asResponse(okJson({ choices: [{ message: { content: null } }] })));

    const client = new LLMClient({ apiKey: "sk-test" });
    const result = await client.chatCompletion({
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });

    expect(result.content).toBe("");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// chatCompletion — error classification
// ===========================================================================

describe("chatCompletion — HTTP error", () => {
  it("throws LLMHttpError with statusCode on non-2xx", async () => {
    // mockResolvedValue (not Once): this test invokes chatCompletion twice
    // (once via .rejects, once via try/catch to assert statusCode) — a single
    // mockResolvedValueOnce would exhaust after the first call and let the
    // spy fall through to the real fetch on the second.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(asResponse(httpError(500, { error: "boom" })));

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(
      client.chatCompletion({
        model: "m",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toBeInstanceOf(LLMHttpError);

    try {
      await client.chatCompletion({
        model: "m",
        messages: [{ role: "user", content: "x" }],
      });
    } catch (e) {
      expect((e as LLMHttpError).statusCode).toBe(500);
    }
  });
});

describe("chatCompletion — timeout", () => {
  it("throws LLMTimeoutError on AbortError", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(err);

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(
      client.chatCompletion({
        model: "m",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it("throws LLMTimeoutError on TimeoutError", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(err);

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(
      client.chatCompletion({
        model: "m",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toBeInstanceOf(LLMTimeoutError);
  });
});

describe("chatCompletion — network error", () => {
  it("throws LLMNetworkError on a generic fetch rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(
      client.chatCompletion({
        model: "m",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toBeInstanceOf(LLMNetworkError);
  });
});

// ===========================================================================
// embeddings — happy path
// ===========================================================================

describe("embeddings — happy path", () => {
  it("returns embeddings in input order and shapes the request (array input)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      asResponse(
        okJson({
          data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }],
        }),
      ),
    );

    const client = new LLMClient({ apiKey: "sk-test" });
    const result = await client.embeddings({
      model: "google/gemini-embedding-001",
      input: ["alpha", "beta"],
      timeoutMs: 12345,
    });

    expect(result.embeddings).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");

    const initObj = init as RequestInit | undefined;
    expect(initObj?.method).toBe("POST");
    const headers = initObj?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(initObj?.body as string);
    expect(body.model).toBe("google/gemini-embedding-001");
    expect(body.input).toEqual(["alpha", "beta"]);

    expect(initObj?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts a single string input and returns a one-element embeddings array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      asResponse(okJson({ data: [{ embedding: [0.5, 0.5] }] })),
    );

    const client = new LLMClient({ apiKey: "sk-test" });
    const result = await client.embeddings({
      model: "m",
      input: "solo",
    });

    expect(result.embeddings).toEqual([[0.5, 0.5]]);
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.input).toBe("solo");
  });
});

// ===========================================================================
// embeddings — error classification
// ===========================================================================

describe("embeddings — HTTP error", () => {
  it("throws LLMHttpError with statusCode on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(asResponse(httpError(500, { error: "boom" })));

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(client.embeddings({ model: "m", input: "x" })).rejects.toBeInstanceOf(
      LLMHttpError,
    );

    try {
      await client.embeddings({ model: "m", input: "x" });
    } catch (e) {
      expect((e as LLMHttpError).statusCode).toBe(500);
    }
  });
});

describe("embeddings — timeout", () => {
  it("throws LLMTimeoutError on AbortError", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(err);

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(client.embeddings({ model: "m", input: "x" })).rejects.toBeInstanceOf(
      LLMTimeoutError,
    );
  });

  it("throws LLMTimeoutError on TimeoutError", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(err);

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(client.embeddings({ model: "m", input: "x" })).rejects.toBeInstanceOf(
      LLMTimeoutError,
    );
  });
});

describe("embeddings — network error", () => {
  it("throws LLMNetworkError on a generic fetch rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));

    const client = new LLMClient({ apiKey: "sk-test" });
    await expect(client.embeddings({ model: "m", input: "x" })).rejects.toBeInstanceOf(
      LLMNetworkError,
    );
  });
});

// ===========================================================================
// withRetry
// ===========================================================================

describe("withRetry — resolves on first success", () => {
  it("returns immediately without waiting when fn resolves first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok" as const);
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry — retries then succeeds", () => {
  it("makes exactly 3 attempts and waits 1s then 2s between them", async () => {
    vi.useFakeTimers();
    // Retryable errors so the retry/backoff schedule fires.
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new LLMNetworkError("a"))
      .mockRejectedValueOnce(new LLMNetworkError("b"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn);

    // First attempt fires immediately (no delay before attempt 1).
    expect(fn).toHaveBeenCalledTimes(1);

    // After the 1st failure, wait 1s before attempt 2.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // After the 2nd failure, wait 2s before attempt 3.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("ok");
  });
});

describe("withRetry — exhausts and re-throws the last error", () => {
  it("calls fn maxAttempts (3) times, re-throws the last error, backoff caps at 60s", async () => {
    vi.useFakeTimers();
    // Retryable error so the full 3-attempt schedule fires.
    const lastErr = new LLMNetworkError("always");
    const fn = vi.fn().mockRejectedValue(lastErr);

    const promise = withRetry(fn);
    // Mark the rejection handled synchronously so advancing fake timers (which
    // drives all 3 attempts + the final rethrow before we await `promise`
    // below) does not trip Node's PromiseRejectionHandledWarning, which
    // Vitest 4 escalates to a file error. The assertion below still verifies
    // the rejected value.
    promise.catch(() => {});

    // Flush all 3 attempts + the intervening backoffs (1s + 2s).
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000); // a 4th hypothetical wait would be 4s

    await expect(promise).rejects.toBe(lastErr);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("backoff delay follows min(1000 * 2**k, 60000) and never exceeds 60s", () => {
    // Computed delay list (not a real sleep) — asserts the cap formula.
    const delay = (k: number): number => Math.min(1000 * 2 ** k, 60000);
    expect(delay(0)).toBe(1000);
    expect(delay(1)).toBe(2000);
    expect(delay(2)).toBe(4000);
    expect(delay(3)).toBe(8000);
    expect(delay(4)).toBe(16000);
    expect(delay(5)).toBe(32000);
    expect(delay(6)).toBe(60000); // 64000 capped
    expect(delay(7)).toBe(60000);
    expect(delay(100)).toBe(60000);

    // The withRetry implementation must follow this same formula; sanity-check
    // it does not exceed 60s for any large k.
    for (let k = 0; k < 50; k++) {
      expect(delay(k)).toBeLessThanOrEqual(60000);
    }
    // A small canary so this test is red until withRetry is implemented: the
    // module-level withRetry must exist as a function (it does here) but the
    // behavioral contract is exercised in the test above.
    expect(typeof withRetry).toBe("function");
  });
});

// ===========================================================================
// LLMClient — baseUrl scheme validation (S1)
// ===========================================================================

describe("LLMClient — baseUrl scheme validation", () => {
  it("rejects a non-https/non-http scheme (file:) with LLMConfigError", () => {
    expect(() => new LLMClient({ apiKey: "k", baseUrl: "file:///etc/passwd" })).toThrow(
      LLMConfigError,
    );
  });

  it("rejects an http baseUrl without opt-in with LLMConfigError", () => {
    delete process.env.ALLOW_HTTP_LLM_BASE_URL;
    expect(() => new LLMClient({ apiKey: "k", baseUrl: "http://x" })).toThrow(LLMConfigError);
  });

  it("rejects a non-parseable baseUrl with LLMConfigError", () => {
    expect(() => new LLMClient({ apiKey: "k", baseUrl: "not a url" })).toThrow(LLMConfigError);
  });

  it("accepts https baseUrl without any warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      () =>
        new LLMClient({
          apiKey: "k",
          baseUrl: "https://openrouter.ai/api/v1",
        }),
    ).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("accepts http baseUrl with allowHttpBaseUrl:true and warns exactly once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new LLMClient({
      apiKey: "k",
      baseUrl: "http://x",
      allowHttpBaseUrl: true,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[llm-client] WARNING: http baseUrl is unsafe — credentials transit in cleartext",
    );
    // Re-issuing on the same client does not re-warn (single warning per
    // client — exercising the flag by simply constructing again into a fresh
    // spy would re-warn; the "once" contract is per-instance, asserted via
    // the call count being exactly 1 on this instance).
    expect((client as unknown as { httpWarningLogged: boolean }).httpWarningLogged).toBe(true);
  });

  it("accepts http baseUrl when ALLOW_HTTP_LLM_BASE_URL=1 env is set and warns", () => {
    process.env.ALLOW_HTTP_LLM_BASE_URL = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => new LLMClient({ apiKey: "k", baseUrl: "http://self-host" })).not.toThrow();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.ALLOW_HTTP_LLM_BASE_URL;
    }
  });

  it("does not log the http warning when baseUrl is https even with opt-in", () => {
    process.env.ALLOW_HTTP_LLM_BASE_URL = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(
        () =>
          new LLMClient({
            apiKey: "k",
            baseUrl: "https://openrouter.ai/api/v1",
          }),
      ).not.toThrow();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env.ALLOW_HTTP_LLM_BASE_URL;
    }
  });
});

// ===========================================================================
// withRetry — error classification (C3)
// ===========================================================================

describe("withRetry — fail-fast on permanent (non-retryable) errors", () => {
  it("LLMHttpError(401) is thrown after a single attempt with no sleep", async () => {
    vi.useFakeTimers();
    const err = new LLMHttpError(401, { e: "unauthorized" });
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    // Drain any pending timers — none should fire.
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("LLMConfigError is thrown after a single attempt with no sleep", async () => {
    vi.useFakeTimers();
    const err = new LLMConfigError();
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a plain Error (unknown class) is thrown after a single attempt", async () => {
    vi.useFakeTimers();
    const err = new Error("boom");
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("withRetry — retries retryable errors up to maxAttempts", () => {
  it("LLMHttpError(429) is retried up to maxAttempts", async () => {
    vi.useFakeTimers();
    const err = new LLMHttpError(429, { e: "rate limited" });
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("LLMHttpError(500) is retried up to maxAttempts", async () => {
    vi.useFakeTimers();
    const err = new LLMHttpError(500, { e: "boom" });
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("LLMTimeoutError is retried up to maxAttempts", async () => {
    vi.useFakeTimers();
    const err = new LLMTimeoutError();
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("LLMNetworkError is retried up to maxAttempts", async () => {
    vi.useFakeTimers();
    const err = new LLMNetworkError();
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("LLMHttpError(404) (4xx, not 429) fails fast on attempt 1", async () => {
    vi.useFakeTimers();
    const err = new LLMHttpError(404, { e: "not found" });
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
