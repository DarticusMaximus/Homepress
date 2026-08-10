/**
 * Fetch safety helpers — shared URL scheme guard + capped body reader.
 *
 * Used by the RSS fetcher and the article scraper to enforce a single
 * ingress contract: a fetched URL must parse and use the `http:`/`https:`
 * scheme, redirects are disabled (cross-scheme leaks impossible), and the
 * response body is never buffered past `maxBytes` (no OOM on hostile feeds).
 *
 * Per the feature-08 cross-cutting decision (S2/S3): private/loopback/
 * link-local IPs are intentionally NOT blocked — operators own feed and
 * article URLs, self-hosted feeds legitimately use internal IPs, and this
 * is the same risk class RSS readers accept. The guard is scheme + parse +
 * no cross-scheme redirect.
 */

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Raised by {@link assertSafeFetchUrl} when a URL does not parse or its
 * scheme is not `http:`/`https:` (or not `http:` when `allowHttp` is false).
 */
export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "UnsafeUrlError";
    // Restore prototype chain for instanceof checks under ES5 targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised by {@link fetchWithSizeLimit} when a response body (declared via
 * `Content-Length` or accumulated while streaming) exceeds `maxBytes`.
 */
export class OversizeBodyError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly declaredLength: number | null,
    readonly maxBytes: number,
  ) {
    super(message);
    this.name = "OversizeBodyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// URL scheme guard
// ---------------------------------------------------------------------------

export interface AssertSafeFetchUrlOptions {
  /**
   * Permit the `http:` scheme. Defaults to `true` — feeds and articles are
   * legitimately served over cleartext http (operator-owned URLs). The
   * LLM-client https-only rule does NOT apply to feed/article ingress.
   */
  allowHttp?: boolean;
}

/**
 * Parse `rawUrl` and assert its scheme is `http:` or `https:`. Returns the
 * parsed `URL` on success; throws {@link UnsafeUrlError} on a non-parseable
 * URL, a non-http(s) scheme, or an `http:` URL when `allowHttp` is false.
 *
 * No host/IP allowlist — operators own their URLs.
 */
export function assertSafeFetchUrl(rawUrl: string, opts?: AssertSafeFetchUrlOptions): URL {
  const allowHttp = opts?.allowHttp ?? true;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`URL is not parseable: ${rawUrl}`, rawUrl);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "https:") {
    return parsed;
  }
  if (protocol === "http:") {
    if (!allowHttp) {
      throw new UnsafeUrlError(`http scheme is not allowed for ${rawUrl}`, rawUrl);
    }
    return parsed;
  }

  throw new UnsafeUrlError(`URL scheme '${protocol}' is not http(s): ${rawUrl}`, rawUrl);
}

// ---------------------------------------------------------------------------
// Capped fetch
// ---------------------------------------------------------------------------

export interface FetchWithSizeLimitOptions {
  /** AbortSignal forwarded to `fetch` (timeout / cancellation). */
  signal: AbortSignal;
  /** Hard cap on response body size in bytes. */
  maxBytes: number;
  /** Whether to permit `http:` (forwarded to {@link assertSafeFetchUrl}). */
  allowHttp?: boolean;
}

export interface FetchWithSizeLimitResult {
  response: Response;
  text: string;
}

/**
 * Fetch `rawUrl` with redirect-following disabled (`redirect: 'error'`) and
 * a hard cap on the response body size.
 *
 * - Validates the URL scheme first (delegates to {@link assertSafeFetchUrl}).
 * - Rejects (via {@link OversizeBodyError}) when a `Content-Length` header
 *   declares a body larger than `maxBytes`, before any bytes are buffered.
 * - For chunked/streaming bodies, reads incrementally and aborts the moment
 *   the running byte total exceeds `maxBytes`.
 *
 * Any redirect (not just cross-scheme) is rejected by `redirect: 'error'`;
 * operators' feeds should not rely on redirects (spec-approved simplification).
 */
export async function fetchWithSizeLimit(
  rawUrl: string,
  opts: FetchWithSizeLimitOptions,
): Promise<FetchWithSizeLimitResult> {
  const { signal, maxBytes, allowHttp } = opts;
  assertSafeFetchUrl(rawUrl, { allowHttp });

  const response = await fetch(rawUrl, {
    signal,
    redirect: "error",
  });

  const contentLengthHeader = readHeader(response, "content-length");
  if (contentLengthHeader !== null) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new OversizeBodyError(
        `Response Content-Length ${declared} exceeds max ${maxBytes} bytes for ${rawUrl}`,
        rawUrl,
        declared,
        maxBytes,
      );
    }
  }

  const text = await readCappedText(response, rawUrl, maxBytes);
  return { response, text };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function readHeader(response: Response, name: string): string | null {
  const headers = (response as Response & { headers?: Headers }).headers;
  if (!headers) return null;
  try {
    return headers.get(name);
  } catch {
    return null;
  }
}

/**
 * Read the response body as UTF-8 text, aborting with {@link OversizeBodyError}
 * the instant the accumulated byte total exceeds `maxBytes`. Prefers the
 * streaming reader (`response.body`) when available so a hostile streaming
 * body never gets fully buffered; falls back to `response.text()` (with a
 * post-read length check) for environments/mocks that don't expose a body
 * stream.
 */
async function readCappedText(response: Response, url: string, maxBytes: number): Promise<string> {
  const body = (response as Response & { body?: ReadableStream<Uint8Array> | null }).body;

  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let received = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > maxBytes) {
            throw new OversizeBodyError(
              `Streaming body exceeded ${maxBytes} bytes (got ${received}) for ${url}`,
              url,
              null,
              maxBytes,
            );
          }
          text += decoder.decode(value, { stream: true });
        }
      }
      text += decoder.decode();
      return text;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released — ignore
      }
    }
  }

  // Fallback path: no streaming body (mock fetch, or env without ReadableStream).
  const text = await response.text();
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    throw new OversizeBodyError(
      `Body of ${byteLength} bytes exceeds max ${maxBytes} bytes for ${url}`,
      url,
      byteLength,
      maxBytes,
    );
  }
  return text;
}
