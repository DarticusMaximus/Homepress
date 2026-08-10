/**
 * Shared OpenRouter LLM client + reusable retry helper.
 *
 * Native-`fetch` client (Node 22) targeting the OpenRouter OpenAI-compatible
 * REST endpoint, plus a hand-rolled `withRetry` with exponential backoff. No
 * `openai` SDK and no retry library — keeps the dependency surface flat,
 * matching features 02 (rss-fetcher) and 03 (scraper). Shared by the tagger
 * (feature 04), scorer (feature 05), and drafter (feature 07).
 */

import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  timeoutMs?: number;
  temperature?: number;
  extraBody?: Record<string, unknown>;
}

export interface ChatCompletionResult {
  content: string;
  raw: unknown;
}

export interface EmbeddingsOptions {
  model: string;
  input: string | string[];
  timeoutMs?: number;
}

export interface EmbeddingsResult {
  embeddings: number[][];
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Errors — small typed union. Each carries the fields its callers/tests rely on.
// ---------------------------------------------------------------------------

/** Thrown when `OPENROUTER_API_KEY` is missing/empty at construction time. */
export class LLMConfigError extends Error {
  readonly envVar: string;

  constructor(envVar = "OPENROUTER_API_KEY", message?: string) {
    super(message ?? `Missing required environment variable: ${envVar}`);
    this.name = "LLMConfigError";
    this.envVar = envVar;
  }
}

/** Thrown on a non-2xx HTTP response from the LLM endpoint. */
export class LLMHttpError extends Error {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, body: unknown, message?: string) {
    super(message ?? `LLM HTTP ${statusCode}`);
    this.name = "LLMHttpError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** Thrown on an `AbortError`/`TimeoutError` (request timeout). */
export class LLMTimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM request timed out");
    this.name = "LLMTimeoutError";
  }
}

/** Thrown on any other network rejection from `fetch`. */
export class LLMNetworkError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM network error");
    this.name = "LLMNetworkError";
  }
}

// ---------------------------------------------------------------------------
// LLMClient
// ---------------------------------------------------------------------------

/** Default OpenRouter REST base URL. */
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter LLM client. Construct with `{ apiKey?, baseUrl? }`. `apiKey`
 * defaults to `process.env.OPENROUTER_API_KEY`; if absent/empty, construction
 * throws {@link LLMConfigError}. Each {@link LLMClient.chatCompletion} call is
 * a single native-`fetch` POST — retry lives at the caller layer via
 * {@link withRetry}.
 */
export interface LLMClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /**
   * Opt-in to an `http:` baseUrl. By default only `https:` is allowed (the
   * Bearer token would otherwise transit in cleartext). Also opt-in via the
   * `ALLOW_HTTP_LLM_BASE_URL=1` environment variable. When the effective
   * baseUrl is `http:` under this opt-in, a visible warning is logged exactly
   * once per client instance.
   */
  allowHttpBaseUrl?: boolean;
}

export class LLMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  /** Whether the cleartext warning has already been logged for this client. */
  private httpWarningLogged = false;

  constructor(options?: LLMClientOptions) {
    const key = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (key === undefined || key === "") {
      throw new LLMConfigError();
    }
    this.apiKey = key;

    const baseUrlRaw = options?.baseUrl ?? DEFAULT_BASE_URL;
    const allowHttp =
      options?.allowHttpBaseUrl === true || process.env.ALLOW_HTTP_LLM_BASE_URL === "1";

    let parsed: URL;
    try {
      parsed = new URL(baseUrlRaw);
    } catch {
      throw new LLMConfigError(
        "OPENROUTER_BASE_URL",
        `Invalid baseUrl (not a parseable URL): ${baseUrlRaw}`,
      );
    }

    if (parsed.protocol === "https:") {
      this.baseUrl = baseUrlRaw;
    } else if (parsed.protocol === "http:" && allowHttp) {
      this.baseUrl = baseUrlRaw;
      console.warn(
        "[llm-client] WARNING: http baseUrl is unsafe — credentials transit in cleartext",
      );
      this.httpWarningLogged = true;
    } else {
      throw new LLMConfigError(
        "OPENROUTER_BASE_URL",
        `baseUrl must be https:${allowHttp ? " (http allowed only with opt-in)" : ""} got ${parsed.protocol}`,
      );
    }
  }

  /**
   * Issue a single chat-completion POST to `${baseUrl}/chat/completions`.
   *
   * - Native `fetch` with `AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)`.
   * - `Authorization: Bearer <apiKey>` + `Content-Type: application/json`.
   * - Body merges `{ model, messages, temperature?, ...extraBody }` (extraBody
   *   spread last so it can override/extend).
   * - Non-2xx → {@link LLMHttpError} `{ statusCode, body }`.
   * - `AbortError`/`TimeoutError` → {@link LLMTimeoutError}; other rejection →
   *   {@link LLMNetworkError}.
   * - Returns `{ content, raw }` where `content` is
   *   `choices[0].message.content` (default `""` when null) and `raw` is the
   *   parsed JSON response body.
   */
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.extraBody ?? {}),
    };

    const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        throw new LLMTimeoutError(error instanceof Error ? error.message : undefined);
      }
      throw new LLMNetworkError(error instanceof Error ? error.message : String(error));
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error) {
      // Body failed to parse as JSON — treat as an HTTP-level error carrying
      // the status and a null body so callers still see the status.
      throw new LLMHttpError(
        response.status,
        null,
        error instanceof Error ? error.message : "invalid JSON body",
      );
    }

    if (!response.ok) {
      throw new LLMHttpError(response.status, parsed);
    }

    const choices = (
      parsed as { choices?: Array<{ message?: { content?: string | null } }> } | null
    )?.choices;
    const content = choices?.[0]?.message?.content ?? "";

    return { content, raw: parsed };
  }

  /**
   * Issue a single embeddings POST to `${baseUrl}/embeddings`. (Feature 06.)
   *
   * Single attempt (no retry at this layer — matching `chatCompletion`).
   * `input` is `string | string[]` (OpenRouter/OpenAI `/embeddings` accepts
   * both). Native `fetch` with `AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS)`,
   * `Authorization: Bearer <apiKey>` + `Content-Type: application/json`, and a
   * JSON body `{ model, input }`. On non-2xx → {@link LLMHttpError}; on
   * `AbortError`/`TimeoutError` → {@link LLMTimeoutError}; other rejection →
   * {@link LLMNetworkError}. Reads `response.data[i].embedding` for each
   * element and returns `{ embeddings: number[][], raw }` in input order.
   */
  async embeddings(options: EmbeddingsOptions): Promise<EmbeddingsResult> {
    const url = `${this.baseUrl}/embeddings`;

    const body: Record<string, unknown> = {
      model: options.model,
      input: options.input,
    };

    const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        throw new LLMTimeoutError(error instanceof Error ? error.message : undefined);
      }
      throw new LLMNetworkError(error instanceof Error ? error.message : String(error));
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error) {
      throw new LLMHttpError(
        response.status,
        null,
        error instanceof Error ? error.message : "invalid JSON body",
      );
    }

    if (!response.ok) {
      throw new LLMHttpError(response.status, parsed);
    }

    const data = (parsed as { data?: Array<{ embedding?: number[] }> } | null)?.data;
    const embeddings = (data ?? []).map((d) => d.embedding ?? []);

    return { embeddings, raw: parsed };
  }
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

/**
 * Resolve `ms` from now via `setTimeout` — uses the global timer so Vitest's
 * fake timers (`vi.useFakeTimers`) control it. `vi.advanceTimersByTimeAsync`
 * flushes the resolved promise together with the timer.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify whether `error` should trigger another retry attempt.
 *
 * - Retry: `LLMTimeoutError`, `LLMNetworkError`, and `LLMHttpError` with
 *   `statusCode === 429 || statusCode >= 500`.
 * - Fail fast: `LLMHttpError` with a 4xx status (except 429),
 *   `LLMConfigError`, and anything else.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof LLMTimeoutError || error instanceof LLMNetworkError) {
    return true;
  }
  if (error instanceof LLMHttpError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }
  return false;
}

/**
 * Call `fn` up to `maxAttempts ?? DEFAULT_MAX_RETRIES` (3) times **total**
 * (mirrors tenacity `stop_after_attempt`, NOT 3-retries-on-top-of-1). Between
 * attempts, wait `min(1000 * 2 ** k, maxWaitMs ?? 60000)` ms where `k` is the
 * zero-indexed retry number (1s, 2s, 4s … capped at 60s — mirrors tenacity
 * `wait_exponential(multiplier=1, max=60)`). Resolves immediately on the first
 * success; if all attempts throw, re-throws the last error. Non-retryable
 * errors (permanent 4xx, `LLMConfigError`, etc.) are re-thrown immediately on
 * attempt 1 without consuming a retry or sleeping.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; maxWaitMs?: number },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_RETRIES;
  const maxWaitMs = opts?.maxWaitMs ?? 60_000;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Permanent (non-retryable) errors fail fast — do not consume another
      // attempt and do not sleep before re-throwing.
      if (!isRetryable(error)) {
        throw error;
      }
      // After a retryable failure, wait before the next attempt — unless this
      // was the final allowed attempt (no point sleeping just to re-throw).
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(1000 * 2 ** attempt, maxWaitMs);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
