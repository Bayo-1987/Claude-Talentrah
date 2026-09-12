/**
 * SSRF guard (src/lib/security/ssrf-guard.ts) — the check that stands
 * between "Import from URL" (any authenticated employer, `job-import/
 * fetch-page.ts`) and a request that reaches a private, loopback,
 * link-local or cloud-metadata address instead of a real public page.
 *
 * `checkResolvedAddress` is pure (no network) and tested directly against
 * concrete addresses, including the specific ones a real attacker would
 * actually try: 127.0.0.1, an RFC1918 range, and 169.254.169.254 (the
 * literal cloud metadata endpoint on AWS/GCP/Azure alike).
 * `resolveAndCheckHostname` adds the DNS step on top, with `dns.lookup`
 * mocked so this suite makes no real network call and can't be flaky
 * against whatever a hostname happens to resolve to today.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns", () => ({
  default: { promises: { lookup: vi.fn() } },
}));

const dns = await import("node:dns");
const { checkResolvedAddress, resolveAndCheckHostname, checkUrlIsSafeToFetch } = await import(
  "@/lib/security/ssrf-guard"
);

describe("checkResolvedAddress — IPv4", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback"],
    ["10.0.0.1", "RFC1918 10/8"],
    ["172.16.0.1", "RFC1918 172.16/12"],
    ["172.31.255.255", "RFC1918 172.16/12, top of range"],
    ["192.168.1.1", "RFC1918 192.168/16"],
    ["169.254.169.254", "the literal cloud metadata address (AWS/GCP/Azure)"],
    ["169.254.0.1", "link-local"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["0.0.0.0", "'this network'"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["192.0.2.1", "TEST-NET-1 documentation range"],
  ])("refuses %s (%s)", (ip) => {
    const result = checkResolvedAddress(ip, 4);
    expect(result.allowed).toBe(false);
  });

  it.each([
    ["8.8.8.8", "Google public DNS"],
    ["1.1.1.1", "Cloudflare public DNS"],
    ["172.15.255.255", "just below the RFC1918 172.16/12 range"],
    ["172.32.0.0", "just above the RFC1918 172.16/12 range"],
  ])("allows %s (%s) — a real public address must not be refused", (ip) => {
    expect(checkResolvedAddress(ip, 4).allowed).toBe(true);
  });
});

describe("checkResolvedAddress — IPv6", () => {
  it.each([
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fc00::1", "unique local address"],
    ["fd12:3456:789a::1", "unique local address, top half of fc00::/7"],
    ["ff02::1", "multicast"],
    ["::", "unspecified address"],
  ])("refuses %s (%s)", (ip) => {
    expect(checkResolvedAddress(ip, 6).allowed).toBe(false);
  });

  it("refuses an IPv4-mapped IPv6 loopback address (::ffff:127.0.0.1) via the embedded IPv4 check", () => {
    expect(checkResolvedAddress("::ffff:127.0.0.1", 6).allowed).toBe(false);
  });

  it("refuses an IPv4-mapped IPv6 metadata address (::ffff:169.254.169.254)", () => {
    expect(checkResolvedAddress("::ffff:169.254.169.254", 6).allowed).toBe(false);
  });

  it("allows a real public IPv6 address (Google DNS)", () => {
    expect(checkResolvedAddress("2001:4860:4860::8888", 6).allowed).toBe(true);
  });

  it("allows an IPv4-mapped IPv6 address embedding a real public IPv4", () => {
    expect(checkResolvedAddress("::ffff:8.8.8.8", 6).allowed).toBe(true);
  });
});

describe("resolveAndCheckHostname", () => {
  it("refuses a hostname that resolves to a loopback address", async () => {
    vi.mocked(dns.default.promises.lookup).mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ] as never);
    const result = await resolveAndCheckHostname("attacker-controlled.example");
    expect(result.allowed).toBe(false);
  });

  it("refuses a hostname if ANY of several resolved addresses is disallowed, not just the first", async () => {
    vi.mocked(dns.default.promises.lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as never);
    const result = await resolveAndCheckHostname("round-robin.example");
    expect(result.allowed).toBe(false);
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    vi.mocked(dns.default.promises.lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
    ] as never);
    const result = await resolveAndCheckHostname("real-careers-page.example");
    expect(result.allowed).toBe(true);
  });

  it("refuses cleanly (not a throw) when DNS resolution itself fails", async () => {
    vi.mocked(dns.default.promises.lookup).mockRejectedValue(new Error("ENOTFOUND"));
    const result = await resolveAndCheckHostname("does-not-exist.invalid");
    expect(result.allowed).toBe(false);
  });
});

describe("checkUrlIsSafeToFetch", () => {
  it("checks the URL's hostname, not the full URL string", async () => {
    vi.mocked(dns.default.promises.lookup).mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ] as never);
    const result = await checkUrlIsSafeToFetch(new URL("https://internal-tool.example/careers/123"));
    expect(result.allowed).toBe(false);
    expect(dns.default.promises.lookup).toHaveBeenCalledWith(
      "internal-tool.example",
      expect.anything(),
    );
  });
});
