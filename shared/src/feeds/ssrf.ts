import { lookup } from "node:dns/promises";

export type DnsResolver = (hostname: string) => Promise<string[]>;

export type RoutabilityResult = { ok: true } | { ok: false; reason: string };

const REASON_BAD_URL = "URL must be a valid http or https address";
const REASON_BAD_SCHEME = "URL must use http or https";
const REASON_NOT_ROUTABLE = "URL host must resolve to a publicly routable address";

const defaultResolver: DnsResolver = async (hostname: string): Promise<string[]> => {
  const entries = await lookup(hostname, { all: true });
  return entries.map((entry) => entry.address);
};

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseHexGroups(segment: string): number[] | null {
  if (segment === "") return [];
  const parts = segment.split(":");
  const groups: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

function parseIpv6(ip: string): bigint | null {
  let address = ip.trim().toLowerCase();
  let embeddedV4: bigint | null = null;

  const lastColon = address.lastIndexOf(":");
  if (lastColon !== -1 && address.slice(lastColon + 1).includes(".")) {
    embeddedV4 = parseIpv4(address.slice(lastColon + 1));
    if (embeddedV4 === null) return null;
    address = address.slice(0, lastColon);
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;

  const left = parseHexGroups(halves[0] ?? "");
  const right = parseHexGroups(halves.length === 2 ? (halves[1] ?? "") : "");
  if (left === null || right === null) return null;

  const v4Groups = embeddedV4 !== null ? 2 : 0;
  const explicit = left.length + right.length + v4Groups;
  if (explicit > 8) return null;
  const zeros = 8 - explicit;
  if (halves.length === 1 && zeros !== 0) return null;

  const groups: number[] = [...left, ...new Array<number>(zeros).fill(0), ...right];
  if (embeddedV4 !== null) {
    groups.push(Number((embeddedV4 >> 16n) & 0xffffn));
    groups.push(Number(embeddedV4 & 0xffffn));
  }

  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}

function v4Cidr(prefix: string, length: number): [bigint, bigint] {
  const net = parseIpv4(prefix);
  if (net === null) throw new Error(`Invalid IPv4 CIDR prefix: ${prefix}`);
  const len = BigInt(length);
  const mask = len === 0n ? 0n : ((1n << 32n) - 1n) ^ ((1n << (32n - len)) - 1n);
  return [net & mask, mask];
}

function v6Cidr(prefix: string, length: number): [bigint, bigint] {
  const net = parseIpv6(prefix);
  if (net === null) throw new Error(`Invalid IPv6 CIDR prefix: ${prefix}`);
  const len = BigInt(length);
  const mask = len === 0n ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - len)) - 1n);
  return [net & mask, mask];
}

const IPV4_BLOCKED: ReadonlyArray<readonly [bigint, bigint]> = [
  v4Cidr("0.0.0.0", 8),
  v4Cidr("10.0.0.0", 8),
  v4Cidr("100.64.0.0", 10),
  v4Cidr("127.0.0.0", 8),
  v4Cidr("169.254.0.0", 16),
  v4Cidr("172.16.0.0", 12),
  v4Cidr("192.0.0.0", 24),
  v4Cidr("192.0.2.0", 24),
  v4Cidr("192.168.0.0", 16),
  v4Cidr("198.18.0.0", 15),
  v4Cidr("198.51.100.0", 24),
  v4Cidr("203.0.113.0", 24),
  v4Cidr("224.0.0.0", 4),
  v4Cidr("240.0.0.0", 4),
];

const IPV6_BLOCKED: ReadonlyArray<readonly [bigint, bigint]> = [
  v6Cidr("::1", 128),
  v6Cidr("::", 128),
  v6Cidr("100::", 64),
  v6Cidr("2001:db8::", 32),
  v6Cidr("fc00::", 7),
  v6Cidr("fe80::", 10),
  v6Cidr("ff00::", 8),
];

const V6_BITS128 = (1n << 128n) - 1n;
const V6_TOP96_MASK = V6_BITS128 ^ 0xffffffffn;
const V6_V4_MAPPED_MARKER = 0xffffn << 32n;

function isBlockedIpv4(value: bigint): boolean {
  return IPV4_BLOCKED.some(([net, mask]) => (value & mask) === net);
}

function isBlockedIpv6(value: bigint): boolean {
  if (IPV6_BLOCKED.some(([net, mask]) => (value & mask) === net)) {
    return true;
  }
  const top96 = value & V6_TOP96_MASK;
  if (top96 === 0n || top96 === V6_V4_MAPPED_MARKER) {
    return isBlockedIpv4(value & 0xffffffffn);
  }
  return false;
}

function isBlockedAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return isBlockedIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6 !== null) return isBlockedIpv6(v6);
  return true;
}

/** IPv4 link-local (APIPA / cloud metadata range). */
const LINK_LOCAL_V4 = v4Cidr("169.254.0.0", 16);
/** IPv6 link-local. */
const LINK_LOCAL_V6 = v6Cidr("fe80::", 10);

/** Known cloud-metadata hostnames checked without DNS. */
const METADATA_HOSTNAMES = new Set(["metadata.google.internal"]);

function normalizeHostname(hostname: string): string {
  const raw = hostname.trim().toLowerCase();
  return raw.length >= 2 && raw.startsWith("[") && raw.endsWith("]")
    ? raw.slice(1, -1)
    : raw;
}

/**
 * True when `hostname` is a **literal** link-local IP or a known cloud-metadata
 * hostname. Does **not** block RFC1918 / private LAN hosts — those remain valid
 * for self-host reachability probes.
 *
 * Reuses the same CIDR alphabet as {@link isPubliclyRoutableUrl} for
 * 169.254.0.0/16 and fe80::/10 only.
 */
export function isLiteralMetadataOrLinkLocalHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host.length === 0) return false;
  if (METADATA_HOSTNAMES.has(host)) return true;

  const v4 = parseIpv4(host);
  if (v4 !== null) {
    const [net, mask] = LINK_LOCAL_V4;
    return (v4 & mask) === net;
  }

  const v6 = parseIpv6(host);
  if (v6 !== null) {
    const [net, mask] = LINK_LOCAL_V6;
    if ((v6 & mask) === net) return true;
    const top96 = v6 & V6_TOP96_MASK;
    if (top96 === 0n || top96 === V6_V4_MAPPED_MARKER) {
      const embedded = v6 & 0xffffffffn;
      const [v4net, v4mask] = LINK_LOCAL_V4;
      return (embedded & v4mask) === v4net;
    }
  }

  return false;
}

export async function isPubliclyRoutableUrl(
  url: string,
  resolver?: DnsResolver,
): Promise<RoutabilityResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: REASON_BAD_URL };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: REASON_BAD_SCHEME };
  }

  const rawHost = parsed.hostname;
  const host =
    rawHost.length >= 2 && rawHost.startsWith("[") && rawHost.endsWith("]")
      ? rawHost.slice(1, -1)
      : rawHost;

  if (host.length === 0) {
    return { ok: true };
  }

  const literalV4 = parseIpv4(host);
  if (literalV4 !== null) {
    return isBlockedIpv4(literalV4) ? { ok: false, reason: REASON_NOT_ROUTABLE } : { ok: true };
  }

  const literalV6 = parseIpv6(host);
  if (literalV6 !== null) {
    return isBlockedIpv6(literalV6) ? { ok: false, reason: REASON_NOT_ROUTABLE } : { ok: true };
  }

  const resolve = resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: true };
  }

  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      return { ok: false, reason: REASON_NOT_ROUTABLE };
    }
  }
  return { ok: true };
}
