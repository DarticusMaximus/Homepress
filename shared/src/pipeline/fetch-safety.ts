/**
 * Fetch safety helpers — shared URL scheme guard + SSRF blocklist + capped
 * body reader.
 *
 * Used by the RSS fetcher and the article scraper to enforce a single
 * ingress contract: a fetched URL must parse and use the `http:`/`https:`
 * scheme, redirects are disabled (cross-scheme leaks impossible), and the
 * response body is never buffered past `maxBytes` (no OOM on hostile feeds).
 *
 * The feature-08 "private/loopback/link-local IPs are intentionally NOT
 * blocked" decision is superseded by feature-03 / stage-16: by default a
 * fetch target must be publicly routable — the pre-flight check refuses
 * internal/LAN/metadata targets, and a pinned DNS lookup inside the connect
 * path closes the resolve-then-fetch (DNS-rebinding) TOCTOU. Blocking is a
 * per-fetch opt-out (`allowPrivateTarget` — the per-feed internal flag),
 * never a global bypass.
 *
 * S9 / Next patched fetch: `rawFetch` is `globalThis.fetch` captured at
 * module load. Next.js may later replace the global and drop non-standard
 * `RequestInit.dispatcher`. Dispatching through this snapshot keeps the
 * pinned Agent on both the worker and the web qualification path. Tests spy
 * on {@link fetchDispatch}.fetch (the same binding) rather than the patchable
 * global.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import type * as dns from "node:dns";

import { Agent } from "undici";

import { isBlockedAddress, type DnsResolver } from "../feeds/ssrf";

/**
 * Pristine `fetch` captured at module load so Next's later patch of
 * `globalThis.fetch` cannot drop `dispatcher` (S9). The only SSRF opt-out
 * remains per-fetch `allowPrivateTarget` (per-feed `allowPrivateNetwork`).
 *
 * Exported as {@link fetchDispatch} so hermetic tests spy on the same
 * function the production path calls — `vi.spyOn(globalThis, "fetch")`
 * would miss this captured binding.
 */
const rawFetch = globalThis.fetch.bind(globalThis);

/** Call-time fetch slot used by {@link fetchWithSizeLimit}. Defaults to the module-load snapshot. */
export const fetchDispatch = {
  fetch: rawFetch as typeof fetch,
};

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
 * Why {@link BlockedTargetError} was raised: the target (or one of its
 * resolved addresses) falls in a blocked range, or the host could not be
 * resolved at all (fail closed).
 */
export type BlockedTargetReason = "blocked-range" | "unresolvable";

/**
 * Raised by {@link fetchWithSizeLimit} when the fetch target is refused by
 * the SSRF guard. Extends {@link UnsafeUrlError} so existing classification
 * (feed `BlockedError` failure / scraper fallback content) applies as-is.
 */
export class BlockedTargetError extends UnsafeUrlError {
  constructor(
    message: string,
    url: string,
    readonly reason: BlockedTargetReason,
  ) {
    super(message, url);
    this.name = "BlockedTargetError";
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
  /**
   * Allow the fetch target to resolve to private/LAN/loopback/metadata
   * addresses. Defaults to `false` — the SSRF guard (pre-flight check +
   * pinned connect) is active. Per-feed operator opt-out (internal feeds).
   */
  allowPrivateTarget?: boolean;
  /**
   * DNS resolver used by the guard (pre-flight + pinned connect). Defaults
   * to `dns.lookup { all: true }`. Injectable for hermetic tests.
   */
  resolver?: DnsResolver;
}

export interface FetchWithSizeLimitResult {
  response: Response;
  text: string;
}

/** Real DNS resolution used when no `resolver` is injected. */
const defaultResolver: DnsResolver = async (hostname) => {
  const entries = await dnsLookup(hostname, { all: true });
  return entries.map((entry) => entry.address);
};

/**
 * Fetch `rawUrl` with redirect-following disabled (`redirect: 'error'`) and
 * a hard cap on the response body size.
 *
 * - Validates the URL scheme first (delegates to {@link assertSafeFetchUrl}).
 * - Unless `allowPrivateTarget` is `true`: pre-flight-checks the target via
 *   {@link assertPublicFetchTarget} (throws {@link BlockedTargetError}) and
 *   connects through a pinned dispatcher whose DNS lookup only ever returns
 *   validated addresses — the address the lookup returns IS the address the
 *   socket connects to (no resolve-then-fetch gap).
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
  const resolver = opts.resolver ?? defaultResolver;
  const parsed = assertSafeFetchUrl(rawUrl, { allowHttp });

  let dispatcher: Agent | undefined;
  if (opts.allowPrivateTarget !== true) {
    await assertPublicFetchTarget(bareHostname(parsed.hostname), rawUrl, resolver);
    dispatcher = pinnedDispatcher(resolver);
  }

  const init: { signal: AbortSignal; redirect: "error"; dispatcher?: Agent } = {
    signal,
    redirect: "error",
    ...(dispatcher ? { dispatcher } : {}),
  };
  const response = await fetchDispatch.fetch(rawUrl, init as RequestInit);

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
// SSRF guard — pre-flight check + pinned connect (S10)
// ---------------------------------------------------------------------------

/**
 * undici's connect-lookup function type, derived from the `Agent` options so
 * the `new Agent({ connect: { lookup } })` binding is checked without a cast.
 * Matches Node's net `LookupFunction`: one callback shape covers both the
 * default single-address form `(err, address, family)` and the
 * `options.all` array form `(err, [{ address, family }])`.
 */
type AgentConnectOptions = NonNullable<ConstructorParameters<typeof Agent>[0]>["connect"];
type UndiciLookupFunction = NonNullable<
  Extract<AgentConnectOptions, { lookup?: unknown }>["lookup"]
>;

export type PinnedLookup = UndiciLookupFunction;

/** Strip the `[]` brackets the URL parser keeps around IPv6 hostnames. */
function bareHostname(hostname: string): string {
  return hostname.length >= 2 && hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * True when the (bracket-stripped, lowercased) hostname is a literal IP the
 * URL parser normalized into dotted-quad IPv4 or colon IPv6 form — hostnames
 * cannot contain `:`. Literals are checked without DNS.
 */
function isLiteralAddressForm(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * Refuse non-public fetch targets: literal blocked IPs (no DNS), hostnames
 * whose resolution fails / comes back empty (`unresolvable`, fail closed),
 * and hostnames with ANY blocked address in the answer (`blocked-range`).
 */
async function assertPublicFetchTarget(
  host: string,
  rawUrl: string,
  resolver: DnsResolver,
): Promise<void> {
  if (isLiteralAddressForm(host)) {
    if (isBlockedAddress(host)) {
      throw new BlockedTargetError(
        `Fetch target '${host}' is in a blocked address range: ${rawUrl}`,
        rawUrl,
        "blocked-range",
      );
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new BlockedTargetError(
      `Fetch target host '${host}' could not be resolved: ${rawUrl}`,
      rawUrl,
      "unresolvable",
    );
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new BlockedTargetError(
      `Fetch target host '${host}' resolved to no addresses: ${rawUrl}`,
      rawUrl,
      "unresolvable",
    );
  }
  if (addresses.some((address) => isBlockedAddress(address))) {
    throw new BlockedTargetError(
      `Fetch target '${host}' resolves to a blocked address range: ${rawUrl}`,
      rawUrl,
      "blocked-range",
    );
  }
}

/** One pinned Agent per resolver (agents hold connection pools; reuse them). */
const pinnedAgents = new WeakMap<DnsResolver, Agent>();

function pinnedDispatcher(resolver: DnsResolver): Agent {
  let agent = pinnedAgents.get(resolver);
  if (agent === undefined) {
    agent = new Agent({ connect: { lookup: createPinnedLookup(resolver) } });
    pinnedAgents.set(resolver, agent);
  }
  return agent;
}

/**
 * DNS lookup handed to undici's connect path. Resolves via the same resolver
 * as the pre-flight check, drops every blocked address, and only ever
 * returns validated addresses — undici connects to exactly what this returns,
 * so a re-resolving attacker between check and connect gains nothing.
 * Exported for direct unit testing.
 */
export function createPinnedLookup(resolver: DnsResolver): PinnedLookup {
  return (hostname, options, callback) => {
    void resolver(hostname).then(
      (addresses) => {
        const safe = addresses.filter((address) => !isBlockedAddress(address));
        if (safe.length === 0) {
          callback(new Error(`Refusing to connect: no safe address for ${hostname}`), "");
          return;
        }
        const ordered = orderForFamily(safe, options.family);
        if (options.all) {
          callback(
            null,
            ordered.map((address) => toLookupAddress(address)),
          );
          return;
        }
        const first = ordered[0];
        callback(null, first, addressFamily(first));
      },
      (cause: unknown) => {
        callback(cause instanceof Error ? cause : new Error(String(cause)), "");
      },
    );
  };
}

function addressFamily(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

function toLookupAddress(address: string): dns.LookupAddress {
  return { address, family: addressFamily(address) };
}

/** Stable reorder preferring `family` (4|6, numeric or "IPv4"/"IPv6") when set. */
function orderForFamily(addresses: string[], family: number | string | undefined): string[] {
  const want: 4 | 6 | undefined =
    family === 4 || family === "IPv4" ? 4 : family === 6 || family === "IPv6" ? 6 : undefined;
  if (want === undefined) return addresses;
  const matching = addresses.filter((address) => addressFamily(address) === want);
  if (matching.length === 0) return addresses;
  return [...matching, ...addresses.filter((address) => addressFamily(address) !== want)];
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
