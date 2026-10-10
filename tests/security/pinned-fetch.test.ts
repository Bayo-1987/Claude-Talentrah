/**
 * pinnedFetch (src/lib/security/pinned-fetch.ts): resolve ONCE, check every returned address, and CONNECT TO THAT SAME CHECKED ADDRESS. The guard it builds on (ssrf-guard.ts) resolved a hostname to check it and then
 * let the HTTP client resolve it AGAIN to connect, so a DNS answer that changed between the two (rebinding) could send the request to a private address the check never saw. Here the connection's own lookup is
 * the checked answer; no second resolution exists. One request per call: redirects are the caller's loop and every hop calls pinnedFetch again, so every hop is resolved, checked and pinned afresh.
 *
 * REAL SOCKETS where it matters: the pinning tests start a local HTTP server and prove the request lands on the checked address while the (injected) resolver's later answer points somewhere unroutable.
 */
import http from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pinnedFetch, SsrfBlockedError } from "@/lib/security/pinned-fetch";

type Answer = Array<{ address: string; family: number }>;
const resolverFor = (...answers: Answer[]) => {
  let call = 0;
  const fn = vi.fn(async () => answers[Math.min(call++, answers.length - 1)]);
  return fn;
};
const allowAll = () => ({ allowed: true as const });

let server: http.Server;
let port: number;
const seen: Array<{ host?: string; url?: string; acceptEncoding?: string; ua?: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, url: req.url, acceptEncoding: String(req.headers["accept-encoding"]), ua: String(req.headers["user-agent"]) });
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://elsewhere.test/next" }).end();
    } else if (req.url === "/gzip") {
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip" }).end(gzipSync("hello pinned world"));
    } else if (req.url === "/big") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("x".repeat(100_000));
    } else if (req.url === "/endless") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const timer = setInterval(() => res.write("x".repeat(1000)), 5);
      res.on("close", () => clearInterval(timer));
    } else if (req.url === "/slow") {
      // never answers
    } else if (req.url === "/empty") {
      res.writeHead(204).end();
    } else {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<html>ok</html>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("a hostname that resolves to a non-public address is refused, and nothing connects", () => {
  it.each([
    ["loopback", "127.0.0.1", 4],
    ["private 10.x", "10.0.0.5", 4],
    ["private 192.168.x", "192.168.1.9", 4],
    ["link-local / cloud metadata", "169.254.169.254", 4],
    ["IPv6 loopback", "::1", 6],
    ["IPv4-mapped IPv6 loopback", "::ffff:127.0.0.1", 6],
    ["IPv6 unique local", "fd12:3456::1", 6],
  ])("%s (%s)", async (_label, address, family) => {
    const transport = vi.fn();
    const resolve = resolverFor([{ address, family }]);
    await expect(pinnedFetch("http://innocent.example/x", {}, { resolve, transports: { http: transport as never, https: transport as never } })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(transport, "a connection was attempted to a refused hostname").not.toHaveBeenCalled();
  });

  it("is refused if ANY of several answers is non-public, not just the first", async () => {
    const transport = vi.fn();
    const resolve = resolverFor([{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }]);
    await expect(pinnedFetch("http://mixed.example/", {}, { resolve, transports: { http: transport as never, https: transport as never } })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("a hostname that does not resolve, or resolves to nothing, is refused (not a hang, not a crash)", async () => {
    await expect(pinnedFetch("http://nope.example/", {}, { resolve: async () => { throw new Error("ENOTFOUND"); } })).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(pinnedFetch("http://empty.example/", {}, { resolve: async () => [] })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it.each(["http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f.1/", "http://10.0.0.1:8080/", "http://169.254.169.254/latest/meta-data/", "http://[::ffff:7f00:1]/", "http://0.0.0.0/"])("an address literal in the URL (%s) is checked too, with no DNS", async (u) => {
    const transport = vi.fn();
    const resolve = vi.fn();
    await expect(pinnedFetch(u, {}, { resolve, transports: { http: transport as never, https: transport as never } })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(transport).not.toHaveBeenCalled();
    expect(resolve, "an address literal needs no DNS lookup").not.toHaveBeenCalled();
  });

  it("only http and https are fetched", async () => {
    for (const u of ["ftp://example.com/x", "file:///etc/passwd", "gopher://example.com/"]) {
      await expect(pinnedFetch(u, {}, { resolve: resolverFor([{ address: "93.184.216.34", family: 4 }]) })).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });
});

describe("resolve once, connect to that same checked address", () => {
  it("a name whose answer changes between the check and the connect still connects ONLY to the first, checked address (real socket)", async () => {
    seen.length = 0;
    // First (and only) lookup: loopback, which the test's policy permits so a local server can answer. Any LATER answer is an unroutable address: if the client resolved again it could never reach the server.
    const resolve = resolverFor([{ address: "127.0.0.1", family: 4 }], [{ address: "10.255.255.1", family: 4 }]);
    const res = await pinnedFetch(`http://pinned.test:${port}/page`, {}, { resolve, check: allowAll });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>ok</html>");
    expect(resolve, "the name was resolved more than once").toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].host, "the Host header must stay the name, not the pinned address").toBe(`pinned.test:${port}`);
  });

  it("the address is checked BEFORE it is pinned: the same rebinding setup with the default policy is refused at the first answer", async () => {
    seen.length = 0;
    const resolve = resolverFor([{ address: "127.0.0.1", family: 4 }], [{ address: "93.184.216.34", family: 4 }]);
    await expect(pinnedFetch(`http://pinned.test:${port}/page`, {}, { resolve })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(seen, "the server was reached after a refused check").toHaveLength(0);
  });

  it("hands the transport a lookup that returns the checked address in both forms Node asks for, and never calls the resolver again", async () => {
    const resolve = resolverFor([{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]);
    let captured: { lookup?: (h: string, o: unknown, cb: (...a: unknown[]) => void) => void; hostname?: string; servername?: string } = {};
    const transport = vi.fn((opts: typeof captured) => {
      captured = opts;
      throw new Error("stop here: the options are what this test reads");
    });
    await expect(pinnedFetch("https://careers.example.org/jobs", {}, { resolve, transports: { http: transport as never, https: transport as never } })).rejects.toThrow(/stop here/);
    expect(captured.hostname, "TLS verification and SNI need the NAME").toBe("careers.example.org");
    const single: unknown[] = [];
    captured.lookup!("careers.example.org", {}, (...a) => single.push(...a));
    expect(single).toEqual([null, "93.184.216.34", 4]);
    const all: unknown[] = [];
    captured.lookup!("careers.example.org", { all: true }, (...a) => all.push(...a));
    expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("every call resolves and checks afresh (a redirect hop is a new call): two calls, two lookups, each pinned to its own answer", async () => {
    seen.length = 0;
    const resolve = resolverFor([{ address: "127.0.0.1", family: 4 }]);
    await pinnedFetch(`http://a.test:${port}/1`, {}, { resolve, check: allowAll });
    await pinnedFetch(`http://b.test:${port}/2`, {}, { resolve, check: allowAll });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(seen.map((s) => s.host)).toEqual([`a.test:${port}`, `b.test:${port}`]);
  });
});

describe("one request per call, and a bounded, readable response", () => {
  const call = (path: string, init = {}) => pinnedFetch(`http://pinned.test:${port}${path}`, init, { resolve: resolverFor([{ address: "127.0.0.1", family: 4 }]), check: allowAll });

  it("a 3xx is RETURNED with its Location, not followed (the caller re-checks the next hop)", async () => {
    seen.length = 0;
    const res = await call("/redirect");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://elsewhere.test/next");
    expect(seen).toHaveLength(1);
  });

  it("asks for an uncompressed body, but decodes gzip if the server sends it anyway", async () => {
    seen.length = 0;
    const res = await call("/gzip");
    expect(await res.text()).toBe("hello pinned world");
    expect(seen[0].acceptEncoding).toBe("identity");
  });

  it("a body is cut at the byte cap instead of being read without limit", async () => {
    const res = await call("/big", { maxBodyBytes: 10_000 });
    const text = await res.text();
    expect(text.length).toBeLessThanOrEqual(10_000);
    expect(text.length).toBeGreaterThan(0);
  });

  it("a response that never ends is cut at the byte cap and returned promptly (reading stops, not just keeping)", async () => {
    const started = Date.now();
    const res = await call("/endless", { maxBodyBytes: 5_000, signal: AbortSignal.timeout(3000) });
    const text = await res.text();
    expect(text.length).toBeLessThanOrEqual(5_000);
    expect(Date.now() - started, "the call waited for a body that never ends").toBeLessThan(2000);
  }, 6000);

  it("a response with no body (204) is a valid Response", async () => {
    const res = await call("/empty");
    expect(res.status).toBe(204);
  });

  it("the caller's headers are sent, and the response reports the URL it came from", async () => {
    seen.length = 0;
    const res = await call("/page", { headers: { "User-Agent": "TalentrahTestBot/1.0" } });
    expect(seen[0].ua).toBe("TalentrahTestBot/1.0");
    expect(res.url).toBe(`http://pinned.test:${port}/page`);
  });

  it("a request that never answers is cut off by the caller's signal", async () => {
    await expect(call("/slow", { signal: AbortSignal.timeout(300) })).rejects.toBeTruthy();
  }, 5000);
});
