import { describe, it, expect, vi } from "vitest";

import {
  isBlockedAddress,
  isLiteralMetadataOrLinkLocalHost,
  isPubliclyRoutableUrl,
} from "../ssrf";

const REASON_UNRESOLVABLE = "URL host could not be resolved";
const REASON_NOT_ROUTABLE = "URL host must resolve to a publicly routable address";

function publicResolver() {
  return vi.fn(async (_host: string) => ["93.184.216.34"]);
}

function resolverReturning(...addresses: string[]) {
  return vi.fn(async (_host: string) => [...addresses]);
}

function throwingResolver() {
  return vi.fn(async (_host: string) => {
    throw new Error("queryA ENOTFOUND");
  });
}

describe("isPubliclyRoutableUrl — resolver failures fail closed", () => {
  it("rejects with the unresolvable reason when the resolver throws", async () => {
    const resolver = throwingResolver();
    const result = await isPubliclyRoutableUrl("https://unresolvable.example.com/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_UNRESOLVABLE });
    expect(resolver).toHaveBeenCalledWith("unresolvable.example.com");
  });

  it("rejects with the unresolvable reason when the resolver yields an empty array", async () => {
    const resolver = resolverReturning();
    const result = await isPubliclyRoutableUrl("https://empty.example.com/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_UNRESOLVABLE });
    expect(resolver).toHaveBeenCalledWith("empty.example.com");
  });

  it("still allows a hostname that resolves to a public address", async () => {
    expect(await isPubliclyRoutableUrl("https://example.com/feed", publicResolver())).toEqual({
      ok: true,
    });
  });
});

describe("isPubliclyRoutableUrl — NAT64 embedded IPv4 (64:ff9b::/96)", () => {
  it("rejects a NAT64 address embedding loopback", async () => {
    const resolver = publicResolver();
    const result = await isPubliclyRoutableUrl("http://[64:ff9b::7f00:1]/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects a NAT64 address embedding RFC1918", async () => {
    const resolver = publicResolver();
    const result = await isPubliclyRoutableUrl("http://[64:ff9b::a00:5]/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("allows a NAT64 address embedding a public IPv4", async () => {
    const resolver = publicResolver();
    expect(await isPubliclyRoutableUrl("http://[64:ff9b::5db8:d822]/feed", resolver)).toEqual({
      ok: true,
    });
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("isPubliclyRoutableUrl — 6to4 embedded IPv4 (2002::/16)", () => {
  it("rejects a 6to4 address embedding RFC1918", async () => {
    const resolver = publicResolver();
    const result = await isPubliclyRoutableUrl("http://[2002:a00:5::]/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects a 6to4 address embedding loopback", async () => {
    const resolver = publicResolver();
    const result = await isPubliclyRoutableUrl("http://[2002:7f00:1::]/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("allows a 6to4 address embedding a public IPv4", async () => {
    const resolver = publicResolver();
    expect(await isPubliclyRoutableUrl("http://[2002:5db8:d822::]/feed", resolver)).toEqual({
      ok: true,
    });
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("isPubliclyRoutableUrl — obfuscated IPv4 / zone-ID literals (T1)", () => {
  it.each([
    ["http://2130706433/"],
    ["http://0x7f.1/"],
    ["http://0177.0.0.1/"],
    ["http://[fe80::1%25eth0]/"],
  ])("blocks %s without consulting the resolver", async (url) => {
    const resolver = publicResolver();
    const result = await isPubliclyRoutableUrl(url, resolver);
    expect(result.ok).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("isPubliclyRoutableUrl — blocked address families", () => {
  it("rejects IPv4 loopback, RFC1918, and link-local literals with no DNS lookup", async () => {
    const resolver = publicResolver();
    for (const url of [
      "http://127.0.0.1/",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://172.16.0.1/feed",
      "http://192.168.1.1/feed",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
    ]) {
      expect(await isPubliclyRoutableUrl(url, resolver)).toEqual({
        ok: false,
        reason: REASON_NOT_ROUTABLE,
      });
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects blocked IPv6 literals with no DNS lookup", async () => {
    const resolver = publicResolver();
    for (const url of [
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[ff00::1]/",
      "http://[100::1]/",
      "http://[2001:db8::1]/",
    ]) {
      expect(await isPubliclyRoutableUrl(url, resolver)).toEqual({
        ok: false,
        reason: REASON_NOT_ROUTABLE,
      });
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 literals wrapping blocked ranges", async () => {
    const resolver = publicResolver();
    expect(
      await isPubliclyRoutableUrl("http://[::ffff:10.0.0.5]/feed", resolver),
    ).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(
      await isPubliclyRoutableUrl("http://[::ffff:127.0.0.1]/feed", resolver),
    ).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("allows public IPv4 and IPv6 literals", async () => {
    const resolver = publicResolver();
    expect(await isPubliclyRoutableUrl("http://93.184.216.34/feed", resolver)).toEqual({ ok: true });
    expect(await isPubliclyRoutableUrl("http://[2606:2800:220:1:248:1893:25c8:1946]/", resolver)).toEqual(
      { ok: true },
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves into a blocked range", async () => {
    const resolver = resolverReturning("10.0.0.5");
    const result = await isPubliclyRoutableUrl("https://sneaky.example.com/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).toHaveBeenCalledWith("sneaky.example.com");
  });

  it("rejects a mixed public + private resolver answer", async () => {
    const resolver = resolverReturning("93.184.216.34", "10.0.0.5");
    const result = await isPubliclyRoutableUrl("https://mixed.example.com/feed", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
  });
});

describe("metadata hostname literal path", () => {
  it("flags metadata.google.internal via the literal hostname check", () => {
    expect(isLiteralMetadataOrLinkLocalHost("metadata.google.internal")).toBe(true);
  });

  it("rejects metadata.google.internal when DNS resolves into a blocked range", async () => {
    const resolver = resolverReturning("169.254.169.254");
    const result = await isPubliclyRoutableUrl("http://metadata.google.internal/", resolver);
    expect(result).toEqual({ ok: false, reason: REASON_NOT_ROUTABLE });
    expect(resolver).toHaveBeenCalledWith("metadata.google.internal");
  });
});

describe("isBlockedAddress", () => {
  it("blocks blocked-range IPv4 and IPv6 literals", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "192.168.1.1",
      "::1",
      "::ffff:10.0.0.5",
      "fe80::1",
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("unwraps NAT64 and 6to4 addresses embedding blocked IPv4", () => {
    expect(isBlockedAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isBlockedAddress("64:ff9b::a00:5")).toBe(true);
    expect(isBlockedAddress("2002:a00:5::")).toBe(true);
    expect(isBlockedAddress("2002:7f00:1::")).toBe(true);
  });

  it("allows public addresses, including public-embedded NAT64 and 6to4", () => {
    for (const address of [
      "93.184.216.34",
      "8.8.8.8",
      "2606:2800:220:1:248:1893:25c8:1946",
      "64:ff9b::5db8:d822",
      "2002:5db8:d822::",
    ]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it("fails closed on unparseable input", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});
