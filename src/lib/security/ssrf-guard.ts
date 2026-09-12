import "server-only";
import dns from "node:dns";

/**
 * SSRF protection for any server-side fetch of a URL supplied by a client —
 * today that's exactly one caller (`job-import/fetch-page.ts`'s "Import from
 * URL" for employers), but this module has no knowledge of that caller and
 * should be reused verbatim by any future one rather than re-derived.
 *
 * THE GAP THIS CLOSES. Validating the scheme (http/https) and checking
 * robots.txt says nothing about where the request actually lands. An
 * authenticated employer could paste `http://169.254.169.254/latest/meta-data/`
 * (cloud metadata), `http://127.0.0.1:<port>` or an RFC1918 address, and none
 * of today's checks would refuse it — the server would fetch it like any
 * other page and hand the response back through the tailoring pipeline.
 *
 * THE APPROACH, AND ITS ONE KNOWN LIMIT. Resolve the hostname via DNS and
 * check every returned address against the blocked ranges below, before the
 * real request goes out — and, separately, disable automatic redirect
 * following so a 3xx to an internal address can't ride through on a hostname
 * that resolved cleanly. This is resolve-then-connect, not a pinned
 * connection: a sufficiently patient DNS-rebinding attacker (an authoritative
 * server that answers this validation lookup with a public IP and a later,
 * genuinely-separate lookup at connect time with a private one) could still
 * slip through the gap between the two lookups. Closing that fully needs
 * pinning the actual socket to the validated address, which needs dispatcher-
 * level control undici doesn't expose compatibly through Node's global
 * `fetch` (checked directly: an externally-installed `undici` Agent's
 * `dispatcher` is rejected by Node 22's own bundled fetch — internal version
 * skew, not a config mistake). Rebinding needs an attacker who controls a
 * real DNS zone and times two separate lookups against this specific
 * request; the risk this module actually exists for is the much cheaper,
 * much more likely one — a pasted literal internal address or a redirect to
 * one — and that risk is fully closed below.
 */

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
}

/** IPv4 ranges with no business being fetched by a public-internet-facing feature. */
const BLOCKED_IPV4_RANGES: Array<{ base: string; bits: number; label: string }> = [
  { base: "0.0.0.0", bits: 8, label: "'this network' (RFC 791)" },
  { base: "10.0.0.0", bits: 8, label: "private (RFC 1918)" },
  { base: "100.64.0.0", bits: 10, label: "carrier-grade NAT (RFC 6598)" },
  { base: "127.0.0.0", bits: 8, label: "loopback" },
  { base: "169.254.0.0", bits: 16, label: "link-local — includes cloud metadata endpoints" },
  { base: "172.16.0.0", bits: 12, label: "private (RFC 1918)" },
  { base: "192.0.0.0", bits: 24, label: "IETF protocol assignments (RFC 6890)" },
  { base: "192.0.2.0", bits: 24, label: "documentation (TEST-NET-1)" },
  { base: "192.168.0.0", bits: 16, label: "private (RFC 1918)" },
  { base: "198.18.0.0", bits: 15, label: "benchmark testing (RFC 2544)" },
  { base: "198.51.100.0", bits: 24, label: "documentation (TEST-NET-2)" },
  { base: "203.0.113.0", bits: 24, label: "documentation (TEST-NET-3)" },
  { base: "224.0.0.0", bits: 4, label: "multicast" },
  { base: "240.0.0.0", bits: 4, label: "reserved" },
  { base: "255.255.255.255", bits: 32, label: "broadcast" },
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function checkIpv4(ip: string): SsrfCheckResult {
  const asInt = ipv4ToInt(ip);
  if (asInt === null) return { allowed: false, reason: `Could not parse address "${ip}".` };

  for (const range of BLOCKED_IPV4_RANGES) {
    const baseInt = ipv4ToInt(range.base)!;
    const mask = range.bits === 0 ? 0 : (~0 << (32 - range.bits)) >>> 0;
    if ((asInt & mask) === (baseInt & mask)) {
      return { allowed: false, reason: `resolves to a ${range.label} address (${ip})` };
    }
  }
  return { allowed: true };
}

/** Expands an IPv6 address to its full 8-group form, as a BigInt. */
function ipv6ToBigInt(ip: string): bigint | null {
  let head = ip;
  let tail = "";
  if (ip.includes("::")) {
    const halves = ip.split("::");
    if (halves.length !== 2) return null;
    [head, tail] = halves;
  } else {
    tail = "";
  }

  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];

  // An embedded IPv4 tail (e.g. "::ffff:192.168.0.1") — convert it to two
  // hex groups so the rest of this function only ever deals with groups.
  const lastTailGroup = tailGroups[tailGroups.length - 1];
  if (lastTailGroup?.includes(".")) {
    const v4 = ipv4ToInt(lastTailGroup);
    if (v4 === null) return null;
    tailGroups.pop();
    tailGroups.push(((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
  }

  const missing = 8 - (headGroups.length + tailGroups.length);
  if (missing < 0) return null;
  const allGroups = [...headGroups, ...Array(ip.includes("::") ? missing : 0).fill("0"), ...tailGroups];
  if (allGroups.length !== 8) return null;

  let value = BigInt(0);
  for (const group of allGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return value;
}

// `0n`/`1n` BigInt literals need target ES2020+; this project targets
// ES2017, so every BigInt value here goes through the constructor instead.
const FULL_128_BITS = (BigInt(1) << BigInt(128)) - BigInt(1);

function ipv6PrefixMask(bits: number): bigint {
  if (bits === 0) return BigInt(0);
  return (FULL_128_BITS << BigInt(128 - bits)) & FULL_128_BITS;
}

const BLOCKED_IPV6_RANGES: Array<{ base: string; bits: number; label: string }> = [
  { base: "::", bits: 128, label: "unspecified address" },
  { base: "::1", bits: 128, label: "loopback" },
  { base: "64:ff9b::", bits: 96, label: "NAT64 (RFC 6052) — unwraps to an embedded IPv4" },
  { base: "100::", bits: 64, label: "discard-only (RFC 6666)" },
  { base: "fc00::", bits: 7, label: "unique local address (RFC 4193)" },
  { base: "fe80::", bits: 10, label: "link-local" },
  { base: "ff00::", bits: 8, label: "multicast" },
];

function checkIpv6(ip: string): SsrfCheckResult {
  // An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is exactly that IPv4
  // address as far as routing is concerned — check the embedded address
  // against the IPv4 rules, not the (otherwise-unremarkable) IPv6 prefix.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (mapped) return checkIpv4(mapped[1]);

  const asBigInt = ipv6ToBigInt(ip);
  if (asBigInt === null) return { allowed: false, reason: `Could not parse address "${ip}".` };

  for (const range of BLOCKED_IPV6_RANGES) {
    const baseBigInt = ipv6ToBigInt(range.base)!;
    const mask = ipv6PrefixMask(range.bits);
    if ((asBigInt & mask) === (baseBigInt & mask)) {
      return { allowed: false, reason: `resolves to a ${range.label} address (${ip})` };
    }
  }
  return { allowed: true };
}

/** Checked directly against a resolved address — exported for the redirect-hop re-check and for tests. */
export function checkResolvedAddress(address: string, family: 4 | 6): SsrfCheckResult {
  return family === 4 ? checkIpv4(address) : checkIpv6(address);
}

/**
 * Resolves `hostname` and refuses it if ANY returned address is in a
 * disallowed range — not just the first one. A hostname round-robining
 * between a public and a private address would otherwise pass on a lucky
 * lookup and fail unpredictably later.
 */
export async function resolveAndCheckHostname(hostname: string): Promise<SsrfCheckResult> {
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { allowed: false, reason: "Couldn't resolve that hostname." };
  }
  if (addresses.length === 0) {
    return { allowed: false, reason: "That hostname didn't resolve to any address." };
  }
  for (const { address, family } of addresses) {
    const result = checkResolvedAddress(address, family as 4 | 6);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

/**
 * Full check for a URL about to be fetched: scheme already validated by the
 * caller, this only asks "is it safe to actually connect to this host."
 */
export async function checkUrlIsSafeToFetch(url: URL): Promise<SsrfCheckResult> {
  return resolveAndCheckHostname(url.hostname);
}
