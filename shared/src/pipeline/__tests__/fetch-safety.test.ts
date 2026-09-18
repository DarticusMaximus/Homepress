import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer } from "node:http";
import type * as dns from "node:dns";

import {
  assertSafeFetchUrl,
  fetchWithSizeLimit,
  createPinnedLookup,
  fetchDispatch,
  UnsafeUrlError,
  OversizeBodyError,
  BlockedTargetError,
  type PinnedLookup,
} from "../fetch-safety";
import type { DnsResolver } from "../../feeds/ssrf";

// ===========================================================================
// assertSafeFetchUrl (pure logic)
// ===========================================================================

describe("assertSafeFetchUrl", () => {
  it("accepts an https URL", () => {
    const url = assertSafeFetchUrl("https://example.com/feed");
    expect(url.protocol).toBe("https:");
  });

  it("accepts an http URL by default (allowHttp defaults to true)", () => {
    const url = assertSafeFetchUrl("http://example.com/feed");
    expect(url.protocol).toBe("http:");
  });

  it("rejects http when allowHttp:false", () => {
    expect(() => assertSafeFetchUrl("http://example.com/feed", { allowHttp: false })).toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects a file:// URL", () => {
    expect(() => assertSafeFetchUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
  });

  it("rejects an ftp:// URL", () => {
    expect(() => assertSafeFetchUrl("ftp://example.com/x")).toThrow(UnsafeUrlError);
  });

  it("rejects a data: URL", () => {
    expect(() => assertSafeFetchUrl("data:text/plain,hello")).toThrow(UnsafeUrlError);
  });

  it("rejects a non-parseable URL", () => {
    expect(() => assertSafeFetchUrl("::not-a-url::")).toThrow(UnsafeUrlError);
  });

  it("does NOT block link-local / loopback / private IPs (scheme guard only)", () => {
    expect(assertSafeFetchUrl("http://169.254.169.254/latest").protocol).toBe("http:");
    expect(assertSafeFetchUrl("http://127.0.0.1:8080").protocol).toBe("http:");
    expect(assertSafeFetchUrl("http://10.0.0.1/feed").protocol).toBe("http:");
    expect(assertSafeFetchUrl("https://192.168.1.1/feed").protocol).toBe("https:");
  });

  it("returns a URL with the parsed components", () => {
    const url = assertSafeFetchUrl("https://example.com:8443/path?q=1");
    expect(url.hostname).toBe("example.com");
    expect(url.port).toBe("8443");
    expect(url.pathname).toBe("/path");
  });

  it("exposes the offending URL on the error", () => {
    try {
      assertSafeFetchUrl("file:///secret");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeUrlError);
      expect((e as UnsafeUrlError).url).toBe("file:///secret");
    }
  });
});

// ===========================================================================
// fetchWithSizeLimit
// ===========================================================================

/** Hermetic public resolver — every address is publicly routable. */
const PUBLIC_RESOLVER: DnsResolver = async () => ["93.184.216.34"];

function okResponse(text = "hello world"): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response;
}

async function expectBlockedTarget(promise: Promise<unknown>, reason: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error, `expected BlockedTargetError with reason '${reason}'`).toBeInstanceOf(
    BlockedTargetError,
  );
  expect(error).toBeInstanceOf(UnsafeUrlError);
  expect((error as BlockedTargetError).reason).toBe(reason);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWithSizeLimit", () => {
  it("validates the URL scheme before calling fetch", async () => {
    await expect(
      fetchWithSizeLimit("file:///etc/passwd", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver: PUBLIC_RESOLVER,
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects when Content-Length exceeds maxBytes (no body read)", async () => {
    const bodySpy = async () => "should-not-be-read";
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-length" ? "500000000" : null),
      },
      text: bodySpy,
    } as unknown as Response;
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(fakeResponse);

    await expect(
      fetchWithSizeLimit("https://example.com/big", {
        signal: AbortSignal.abort(),
        maxBytes: 70000,
        resolver: PUBLIC_RESOLVER,
      }),
    ).rejects.toThrow(OversizeBodyError);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/big",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("passes redirect:'error' to fetch", async () => {
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await fetchWithSizeLimit("https://example.com/feed", {
      signal: AbortSignal.abort(),
      maxBytes: 70000,
      resolver: PUBLIC_RESOLVER,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/feed",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("returns the body text when within the cap (no Content-Length)", async () => {
    const fakeResponse = okResponse();
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(fakeResponse);

    const result = await fetchWithSizeLimit("https://example.com/feed", {
      signal: AbortSignal.abort(),
      maxBytes: 70000,
      resolver: PUBLIC_RESOLVER,
    });

    expect(result.text).toBe("hello world");
    expect(result.response).toBe(fakeResponse);
  });

  it("rejects an oversize body via the text() fallback when no Content-Length", async () => {
    const big = "a".repeat(1001);
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => big,
    } as unknown as Response;
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(fakeResponse);

    await expect(
      fetchWithSizeLimit("https://example.com/feed", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver: PUBLIC_RESOLVER,
      }),
    ).rejects.toThrow(OversizeBodyError);
  });
});

// ===========================================================================
// fetchWithSizeLimit — SSRF guard (S10)
// ===========================================================================

describe("fetchWithSizeLimit — SSRF guard", () => {
  it("blocks a literal loopback IPv4 without DNS or fetch", async () => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("http://127.0.0.1:8080/x", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a literal private IPv4 without DNS or fetch", async () => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("http://10.0.0.5/y", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a literal link-local metadata IPv4 without DNS or fetch", async () => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("http://169.254.169.254/latest/meta-data", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a literal loopback IPv6 without DNS or fetch", async () => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("http://[::1]/z", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["http://2130706433/"],
    ["http://0x7f.1/"],
    ["http://0177.0.0.1/"],
    ["http://[fe80::1%25eth0]/"],
  ])("blocks obfuscated literal %s without DNS or fetch", async (url) => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    const error = await fetchWithSizeLimit(url, {
      signal: AbortSignal.abort(),
      maxBytes: 1000,
      resolver,
    }).then(
      () => null,
      (e) => e,
    );

    expect(error).toBeInstanceOf(UnsafeUrlError);
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a literal IPv4-mapped IPv6 without DNS or fetch", async () => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("http://[::ffff:10.0.0.5]/z", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );

    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["127.0.0.1"],
    ["10.0.0.5"],
    ["192.168.0.1"],
    ["172.16.0.9"],
    ["169.254.169.254"],
    ["::1"],
    ["::ffff:10.0.0.5"],
    ["fe80::1"],
    ["64:ff9b::7f00:1"],
    ["2002:a00:5::"],
  ])("blocks a hostname resolving to %s", async (address) => {
    const resolver: DnsResolver = async () => [address];
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("https://feed.internal.example/rss", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks when ANY resolved address is private (mixed answer)", async () => {
    const resolver: DnsResolver = async () => ["93.184.216.34", "192.168.0.1"];
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("https://rebind.example/feed", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "blocked-range",
    );
  });

  it("maps a throwing resolver to 'unresolvable'", async () => {
    const resolver: DnsResolver = async () => {
      throw new Error("ENOTFOUND");
    };
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("https://nope.example/feed", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "unresolvable",
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps an empty resolver answer to 'unresolvable'", async () => {
    const resolver: DnsResolver = async () => [];
    vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await expectBlockedTarget(
      fetchWithSizeLimit("https://empty.example/feed", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
        resolver,
      }),
      "unresolvable",
    );
  });

  it("passes a dispatcher to fetch on the guarded path (wiring)", async () => {
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    await fetchWithSizeLimit("https://example.com/feed", {
      signal: AbortSignal.abort(),
      maxBytes: 70000,
      resolver: PUBLIC_RESOLVER,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1] as
      (RequestInit & { dispatcher?: unknown }) | undefined;
    expect(init).toBeDefined();
    expect(init?.redirect).toBe("error");
    expect(init?.dispatcher).toBeDefined();
    expect(typeof (init?.dispatcher as { dispatch?: unknown })?.dispatch).toBe("function");
  });

  it("allowPrivateTarget:true bypasses both checks — plain fetch, no dispatcher", async () => {
    const resolver = vi.fn(PUBLIC_RESOLVER);
    const fetchSpy = vi.spyOn(fetchDispatch, "fetch").mockResolvedValueOnce(okResponse());

    const result = await fetchWithSizeLimit("http://10.0.0.5/y", {
      signal: AbortSignal.abort(),
      maxBytes: 1000,
      resolver,
      allowPrivateTarget: true,
    });

    expect(result.text).toBe("hello world");
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1] as
      (RequestInit & { dispatcher?: unknown }) | undefined;
    expect(init?.dispatcher).toBeUndefined();
    expect(init?.redirect).toBe("error");
  });
});

// ===========================================================================
// Real-socket smoke — unmocked fetch (N1, S9)
// ===========================================================================

describe("fetchWithSizeLimit — real-socket loopback smoke", () => {
  it("refuses a live 127.0.0.1 listener with BlockedTargetError and zero server hits", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("should-not-be-reached");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a TCP address");
      }
      const url = `http://127.0.0.1:${address.port}/ssrf-smoke`;

      await expectBlockedTarget(
        fetchWithSizeLimit(url, {
          signal: AbortSignal.timeout(2000),
          maxBytes: 1000,
        }),
        "blocked-range",
      );

      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

// ===========================================================================
// createPinnedLookup (S10 — pinned DNS for the undici connect path)
// ===========================================================================

interface LookupResult {
  err: Error | null;
  address?: string | dns.LookupAddress[];
  family?: number;
}

function callLookup(
  lookup: PinnedLookup,
  hostname: string,
  options: dns.LookupOptions,
): Promise<LookupResult> {
  return new Promise((resolve) => {
    lookup(hostname, options, (err, address, family) => resolve({ err, address, family }));
  });
}

describe("createPinnedLookup", () => {
  it("single-address form: resolves and returns the first safe address with its family", async () => {
    const lookup = createPinnedLookup(async () => ["93.184.216.34"]);

    const result = await callLookup(lookup, "example.com", {});

    expect(result.err).toBeNull();
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
  });

  it("all form: returns every safe address as {address, family}", async () => {
    const lookup = createPinnedLookup(async () => ["93.184.216.34", "2600::1"]);

    const result = await callLookup(lookup, "example.com", { all: true });

    expect(result.err).toBeNull();
    expect(result.address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2600::1", family: 6 },
    ]);
  });

  it("all form: filters blocked addresses out of the returned list", async () => {
    const lookup = createPinnedLookup(async () => [
      "64:ff9b::7f00:1",
      "93.184.216.34",
      "2002:a00:5::",
    ]);

    const result = await callLookup(lookup, "rebind.example", { all: true });

    expect(result.err).toBeNull();
    expect(result.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("honors options.family when set (family preference)", async () => {
    const lookup = createPinnedLookup(async () => ["2600::1", "93.184.216.34"]);

    const v4 = await callLookup(lookup, "example.com", { family: 4 });
    const v6 = await callLookup(lookup, "example.com", { family: 6 });
    const any = await callLookup(lookup, "example.com", {});

    expect(v4.address).toBe("93.184.216.34");
    expect(v6.address).toBe("2600::1");
    expect(any.address).toBe("2600::1");
  });

  it("DNS-rebinding sequence: second lookup flipping to a private address errors", async () => {
    const resolver = vi
      .fn<DnsResolver>()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    const lookup = createPinnedLookup(resolver);

    const first = await callLookup(lookup, "rebind.example", {});
    const second = await callLookup(lookup, "rebind.example", {});

    expect(first.err).toBeNull();
    expect(first.address).toBe("93.184.216.34");
    expect(second.err).toBeInstanceOf(Error);
    expect(second.address).not.toContain("127.0.0.1");
  });

  it("errors when every resolved address is blocked", async () => {
    const lookup = createPinnedLookup(async () => ["10.0.0.5", "192.168.0.1"]);

    const single = await callLookup(lookup, "lan.example", {});
    const all = await callLookup(lookup, "lan.example", { all: true });

    expect(single.err).toBeInstanceOf(Error);
    expect(all.err).toBeInstanceOf(Error);
  });

  it("errors when the resolver throws", async () => {
    const lookup = createPinnedLookup(async () => {
      throw new Error("ENOTFOUND");
    });

    const result = await callLookup(lookup, "nope.example", {});

    expect(result.err).toBeInstanceOf(Error);
  });
});
