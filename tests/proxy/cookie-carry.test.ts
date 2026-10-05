/**
 * Every response path out of the proxy carries the session cookies the refresh just produced (S1-44).
 *
 * THE BUG. `seekerAppGate` answered "no user, protected page" with a redirect built from scratch, so none of the Set-Cookie headers
 * `updateSession` had put on its own response went with it. Supabase rotates refresh tokens: a refresh the browser never hears about
 * leaves the old, now-revoked token in the cookie, and its next use outside the 10-second reuse window revokes the whole session.
 * Measured on production (auth + edge logs, 2026-09-29 to 10-03): 10 `refresh_token_not_found` from the server on 2026-10-02, repeated
 * per client because a dead session's clearing cookies were dropped by the same redirect.
 *
 * What runs here is the REAL proxy and the REAL @supabase/ssr, against tests/support/fake-gotrue.ts (rotation, the reuse interval,
 * deleted sessions, a transient outage). No database. It proves the app's handling, not GoTrue's.
 *
 * Also pinned: `updateSession` runs exactly once per request (a second call rebuilds the response and would drop the first call's
 * cookies), and `touchLastActive` cannot refresh a session after the response has gone out.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CookieJar, startFakeGoTrue, type FakeGoTrue } from "../support/fake-gotrue";

const calls = vi.hoisted(() => ({ updateSession: 0 }));
vi.mock("@/lib/supabase/middleware", async (orig) => {
  const real = await orig<typeof import("@/lib/supabase/middleware")>();
  return { ...real, updateSession: (...a: Parameters<typeof real.updateSession>) => { calls.updateSession += 1; return real.updateSession(...a); } };
});

let fake: FakeGoTrue;
beforeAll(async () => {
  fake = await startFakeGoTrue();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", fake.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterAll(async () => { vi.unstubAllEnvs(); await fake.close(); });
beforeEach(() => { calls.updateSession = 0; fake.failUser = false; fake.ttl = 3600; fake.appMetadata = {}; fake.requests.length = 0; });

/** Signs in through the real ssr client and returns the jar a browser would hold. `ttl` < 0 stores an already-expired access token. */
async function signedInJar(ttl = 3600): Promise<CookieJar> {
  fake.ttl = ttl;
  const jar = new CookieJar();
  const store = new Map<string, string>();
  const sb = createServerClient(fake.url, "anon", { cookies: { getAll: () => [...store].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => store.set(name, value)) } });
  const { error } = await sb.auth.signInWithPassword({ email: "t@talentrah.test", password: "x" });
  expect(error).toBeNull();
  store.forEach((v, k) => jar.m.set(k, v));
  fake.ttl = 3600;
  fake.requests.length = 0;
  return jar;
}

async function hit(jar: CookieJar, pathname: string, waitUntil: Promise<unknown>[] = []): Promise<Response> {
  const { proxy } = await import("@/proxy");
  const req = new NextRequest(`http://localhost:3000${pathname}`, { headers: { cookie: jar.header() } });
  return (await proxy(req, { waitUntil: (p: Promise<unknown>) => { waitUntil.push(p); } } as unknown as NextFetchEvent)) as Response;
}

describe("a protected page", () => {
  it("expired access token, valid refresh token: passes through carrying the new session cookie", async () => {
    const jar = await signedInJar(-100);
    const before = jar.header();
    const res = await hit(jar, "/billing");
    expect(res.status).toBe(200);
    jar.apply(res);
    expect(jar.header()).not.toBe(before);
  });

  it("a dead session (signed out elsewhere): the redirect to /login CLEARS the dead cookies, so they are not retried on every request", async () => {
    const jar = await signedInJar(-100);
    fake.clearSessions();
    const res = await hit(jar, "/billing");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?redirectTo=%2Fbilling");
    jar.apply(res);
    expect(jar.m.size, "the dead session's cookies must be cleared by the redirect").toBe(0);
    // and a second request does not call the token endpoint again
    fake.requests.length = 0;
    await hit(jar, "/billing");
    expect(fake.requests.filter((r) => r.path === "/auth/v1/token")).toEqual([]);
  });

  it("the refresh succeeds but the follow-up /user call fails: the redirect still carries the NEW cookies (the rotated token is not lost)", async () => {
    const jar = await signedInJar(-100);
    const oldCookies = jar.header();
    fake.failUser = true;
    const res = await hit(jar, "/billing");
    expect(res.status).toBe(307);
    expect(fake.requests.filter((r) => r.path === "/auth/v1/token" && r.query.includes("refresh_token")), "a refresh did happen").toHaveLength(1);
    jar.apply(res);
    expect(jar.header(), "the browser must end up holding the rotated session, not the old one").not.toBe(oldCookies);
    expect(jar.m.size).toBeGreaterThan(0);
  });
});

describe("a session scheduled for deletion (ACCT-1): the gate's redirect and its 403 carry the refreshed cookies too", () => {
  it("expired access token, valid refresh token, flagged account: the page redirect to the prompt carries the NEW session cookie", async () => {
    fake.appMetadata = { deletion_pending: true };
    const jar = await signedInJar(-100);
    const before = jar.header();
    const res = await hit(jar, "/billing");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/settings/account-deletion");
    expect(fake.requests.filter((r) => r.path === "/auth/v1/token" && r.query.includes("refresh_token")), "a refresh did happen").toHaveLength(1);
    jar.apply(res);
    expect(jar.header(), "the browser must end up holding the rotated session, not the old one").not.toBe(before);
    expect(jar.m.size).toBeGreaterThan(0);
  });

  it("the same for an API call: a 403 JSON, with the refreshed cookies", async () => {
    fake.appMetadata = { deletion_pending: true };
    const jar = await signedInJar(-100);
    const before = jar.header();
    const res = await hit(jar, "/api/anything");
    expect(res.status).toBe(403);
    jar.apply(res);
    expect(jar.header()).not.toBe(before);
  });

  it("the prompt itself is exempt, and still carries the refreshed cookies (it must not be a path that drops them)", async () => {
    fake.appMetadata = { deletion_pending: true };
    const jar = await signedInJar(-100);
    const before = jar.header();
    const res = await hit(jar, "/settings/account-deletion");
    expect(res.status).toBe(200);
    jar.apply(res);
    expect(jar.header()).not.toBe(before);
  });
});

describe("other paths", () => {
  it("a public page with a dead session clears the cookies (control: this already worked)", async () => {
    const jar = await signedInJar(-100);
    fake.clearSessions();
    const res = await hit(jar, "/jobs/remote");
    expect(res.status).toBe(200);
    jar.apply(res);
    expect(jar.m.size).toBe(0);
  });

  it("/admin without an admin cookie is redirected before any seeker session is read: nothing to carry, updateSession not called", async () => {
    const jar = await signedInJar();
    const res = await hit(jar, "/admin/users");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/login");
    expect(calls.updateSession).toBe(0);
    expect(fake.requests).toEqual([]);
  });
});

describe("updateSession runs exactly once per request", () => {
  it.each(["/billing", "/jobs/remote", "/api/anything", "/login"])("%s", async (pathname) => {
    const jar = await signedInJar();
    await hit(jar, pathname);
    expect(calls.updateSession).toBe(1);
  });
});

describe("touchLastActive cannot refresh a session after the response is returned", () => {
  it("calls the RPC with the already-validated access token, and issues no auth request of its own", async () => {
    const jar = await signedInJar();
    const accessToken = (() => {
      // the access token inside the ssr cookie (base64url JSON, "base64-" prefixed)
      const raw = [...jar.m.values()][0].replace(/^base64-/, "");
      return JSON.parse(Buffer.from(raw, "base64url").toString()).access_token as string;
    })();
    const pending: Promise<unknown>[] = [];
    const res = await hit(jar, "/billing", pending);
    expect(res.status).toBe(200);
    const beforeRpc = fake.requests.length;
    await Promise.all(pending);
    const after = fake.requests.slice(beforeRpc);
    expect(after.map((r) => r.path)).toEqual(["/rest/v1/rpc/touch_last_active"]);
    expect(after[0].authorization).toBe(`Bearer ${accessToken}`);
  });

  it("an access token that has expired by the time the RPC runs is not refreshed (no /token call, no cookie written)", async () => {
    const jar = await signedInJar();
    const pending: Promise<unknown>[] = [];
    await hit(jar, "/billing", pending);
    // the session is gone before the fire-and-forget call goes out
    fake.clearSessions();
    fake.requests.length = 0;
    await Promise.all(pending);
    expect(fake.requests.some((r) => r.path.startsWith("/auth/v1/"))).toBe(false);
  });
});

describe("source: no redirect leaves proxy.ts without the refreshed cookies", () => {
  const src = readFileSync(path.join(__dirname, "../../src/proxy.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");  // line comments first: one of them mentions "/api/admin/*"

  it("every NextResponse.redirect outside adminGate (which runs before the session is read) goes through carryCookies", () => {
    const outsideAdminGate = src.replace(/function adminGate[\s\S]*?\n}\n/, "");
    const redirects = [...outsideAdminGate.matchAll(/NextResponse\.redirect\(/g)];
    expect(redirects.length, "the seeker gate's redirect must still exist").toBeGreaterThan(0);
    for (const m of redirects) {
      expect(outsideAdminGate.slice(Math.max(0, m.index! - 40), m.index!), "a bare redirect drops the refreshed cookies").toContain("carryCookies(");
    }
  });

  it("the pending-deletion gate copies cookies with carryCookies, not a loop of its own (one definition of how a Set-Cookie is carried)", () => {
    const gate = readFileSync(path.join(__dirname, "../../src/lib/auth/pending-deletion-gate.ts"), "utf8").replace(/^\s*\/?\*.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");
    expect(gate).toContain("carryCookies(");
    expect(gate, "a hand-rolled copy of the Set-Cookie headers").not.toMatch(/getSetCookie\(\)/);
  });

  it("touchLastActive builds its own token-only client (no persistence, no auto-refresh) and never touches the session-bound one", () => {
    const touch = src.slice(src.indexOf("function touchLastActive"), src.indexOf("\n}\n", src.indexOf("function touchLastActive")));
    expect(touch).toContain("persistSession: false");
    expect(touch).toContain("autoRefreshToken: false");
    expect(touch).toContain("Authorization: `Bearer ${accessToken}`");
    expect(touch).not.toMatch(/supabase\.(auth|rpc|from)/);
    const mw = readFileSync(path.join(__dirname, "../../src/lib/supabase/middleware.ts"), "utf8");
    expect(mw, "updateSession must not hand its session-bound client back to the proxy").not.toMatch(/return \{[^}]*\bsupabase\b[^}]*\}/);
  });

  it("calls updateSession once", () => {
    expect([...src.matchAll(/updateSession\(/g)]).toHaveLength(1);
  });
});
