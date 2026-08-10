import { describe, it, expect, vi } from "vitest";

import {
  assertSafeFetchUrl,
  fetchWithSizeLimit,
  UnsafeUrlError,
  OversizeBodyError,
} from "../fetch-safety";

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

  it("does NOT block link-local / loopback / private IPs", () => {
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

describe("fetchWithSizeLimit", () => {
  it("validates the URL scheme before calling fetch", async () => {
    await expect(
      fetchWithSizeLimit("file:///etc/passwd", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse);

    await expect(
      fetchWithSizeLimit("https://example.com/big", {
        signal: AbortSignal.abort(),
        maxBytes: 70000,
      }),
    ).rejects.toThrow(OversizeBodyError);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/big",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("passes redirect:'error' to fetch", async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "<rss/>",
    } as unknown as Response;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse);

    await fetchWithSizeLimit("https://example.com/feed", {
      signal: AbortSignal.abort(),
      maxBytes: 70000,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/feed",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("returns the body text when within the cap (no Content-Length)", async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "hello world",
    } as unknown as Response;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse);

    const result = await fetchWithSizeLimit("https://example.com/feed", {
      signal: AbortSignal.abort(),
      maxBytes: 70000,
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
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fakeResponse);

    await expect(
      fetchWithSizeLimit("https://example.com/feed", {
        signal: AbortSignal.abort(),
        maxBytes: 1000,
      }),
    ).rejects.toThrow(OversizeBodyError);
  });
});
