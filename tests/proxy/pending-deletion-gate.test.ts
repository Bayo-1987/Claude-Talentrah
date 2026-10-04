/**
 * ACCT-1 PR 1 — the gate on EVERY request, not only sign-in, at no database cost.
 *
 * Confirming a deletion signs the person out everywhere AFTER the database transaction, and that call can fail, or a second device can keep a live
 * session. So the proxy (src/proxy.ts) turns a flagged session away on its very next request. The flag it reads is `app_metadata.deletion_pending`
 * on the user object `updateSession` ALREADY fetched with `auth.getUser()` (a live call to the auth server, so it is current): the gate makes NO
 * database query of its own. `profiles.deletion_requested_at` stays the source of truth and both are written together (tests/lib/account-deletion/).
 *
 * Pinned here: pages redirect; API calls get a 403 JSON, never a redirect; THE REFRESHED SESSION COOKIES SURVIVE THE REDIRECT (every Set-Cookie of the
 * response the middleware refreshed, with its attributes: a redirect that drops them is exactly how a person gets signed out at random); the exempt
 * paths (the prompt, the confirm link, sign-in, the auth routes, static assets) can never loop; signed-out requests and an ordinary user are untouched;
 * and the gate is wired into `proxy()` before anything else touches the user.
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", app_metadata: {} } as { id: string; app_metadata: Record<string, unknown> } | null,
  dbReads: 0,
  touched: 0,
  response: undefined as undefined | (() => Response),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async () => ({
    response: h.response ? h.response() : NextResponse.next(),
    user: h.user,
    supabase: {
      from: () => {
        h.dbReads += 1;
        throw new Error("the gate must not query the database");
      },
      rpc: async () => {
        h.touched += 1;
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/lib/supabase/public-read", () => ({ createPublicReadClient: () => ({ rpc: async () => ({ data: false, error: null }) }) }));

import { proxy } from "@/proxy";

const waitUntil = vi.fn();
const run = (path: string, method = "GET") => proxy(new NextRequest(`https://www.talentrah.com${path}`, { method }), { waitUntil } as never);
const location = (r: Response) => r.headers.get("location") ?? "";
const pending = () => ({ id: "u1", app_metadata: { deletion_pending: true } });

beforeEach(() => {
  h.user = { id: "u1", app_metadata: {} };
  h.dbReads = 0;
  h.touched = 0;
  h.response = undefined;
  waitUntil.mockReset();
});

describe("a session scheduled for deletion lands on the prompt on its next request", () => {
  beforeEach(() => {
    h.user = pending();
  });

  it.each(["/jobs", "/jobs/some-posting-id", "/settings", "/billing", "/tracker", "/employer/jobs", "/mentorship", "/", "/blog/some-post"])(
    "%s redirects to /settings/account-deletion",
    async (path) => {
      const res = await run(path);
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
      expect(new URL(location(res), "https://www.talentrah.com").pathname).toBe("/settings/account-deletion");
    },
  );

  it("with global sign-out having FAILED, the second device's very next request is still caught", async () => {
    // The state after a failed signOut({scope:'global'}): the session is alive and the flag is set. Nothing else is needed for the gate to act.
    const res = await run("/settings");
    expect(new URL(location(res), "https://www.talentrah.com").pathname).toBe("/settings/account-deletion");
  });

  it("an API call from that session gets a 403 JSON, not a redirect", async () => {
    const res = await run("/api/farah/chat", "POST");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.json()).toMatchObject({ error: "account_scheduled_for_deletion" });
  });

  it("does not stamp the account as recently active", async () => {
    await run("/jobs");
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("makes NO database query to decide (the flag rides on the user the middleware already fetched)", async () => {
    await run("/jobs");
    await run("/api/farah/chat", "POST");
    expect(h.dbReads).toBe(0);
  });
});

describe("the refreshed session cookies survive the redirect", () => {
  // Built ONCE, so "what the middleware set" and "what the gate must carry" are the very same strings (cookie `Expires` has one-second resolution, so two
  // separate builds can differ and make this test flaky).
  const source = NextResponse.next();
  // A chunked session cookie plus its refresh token, each with its own attributes: what @supabase/ssr sets when a token is renewed.
  source.cookies.set("sb-abc-auth-token.0", "chunk-zero", { path: "/", maxAge: 34_560_000, httpOnly: false, sameSite: "lax", secure: true });
  source.cookies.set("sb-abc-auth-token.1", "chunk-one", { path: "/", maxAge: 34_560_000, httpOnly: false, sameSite: "lax", secure: true });
  source.cookies.set("sb-abc-auth-token-code-verifier", "", { path: "/", maxAge: 0 });
  const FIXED = source.headers.getSetCookie();
  const refreshed = () => {
    const r = NextResponse.next();
    for (const c of FIXED) r.headers.append("set-cookie", c);
    return r;
  };

  beforeEach(() => {
    h.user = pending();
    h.response = refreshed;
  });

  it("a page redirect carries EVERY Set-Cookie of the refreshed response, byte for byte", async () => {
    const expected = refreshed().headers.getSetCookie();
    expect(expected).toHaveLength(3);
    const res = await run("/jobs");
    expect(new URL(location(res), "https://www.talentrah.com").pathname).toBe("/settings/account-deletion");
    expect(res.headers.getSetCookie()).toEqual(expected);
  });

  it("a 403 for an API call carries them too", async () => {
    const expected = refreshed().headers.getSetCookie();
    const res = await run("/api/farah/chat", "POST");
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual(expected);
  });

  it("an ordinary request still returns the refreshed response itself, untouched", async () => {
    h.user = { id: "u1", app_metadata: {} };
    const res = await run("/jobs");
    expect(res.headers.getSetCookie()).toEqual(refreshed().headers.getSetCookie());
  });
});

describe("no redirect loops: these are exempt, so the person can always restore, leave or sign in", () => {
  beforeEach(() => {
    h.user = pending();
  });

  it.each([
    ["the restore prompt", "/settings/account-deletion"],
    ["the prompt with an error", "/settings/account-deletion?error=window_closed"],
    ["the deletion confirm link", "/settings/delete-account/confirm?token=" + "a".repeat(64)],
    ["sign-in", "/login"],
    ["the auth callback", "/auth/callback?code=abc"],
    ["sign-out", "/auth/signout"],
    ["an auth API route", "/api/auth/anything"],
    ["the admin surface (a separate identity)", "/admin/login"],
    ["a static chunk", "/_next/static/chunks/main-abc.js"],
    ["an image", "/images/logo.png"],
    ["a font", "/fonts/body.woff2"],
    ["robots.txt", "/robots.txt"],
    ["the sitemap", "/sitemap.xml"],
    ["the favicon", "/favicon.ico"],
  ])("%s (%s) is not redirected", async (_name, path) => {
    const res = await run(path);
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("the prompt can never redirect to itself, however it is reached", async () => {
    for (const p of ["/settings/account-deletion", "/settings/account-deletion/"]) {
      expect((await run(p)).headers.get("location")).toBeNull();
    }
  });
});

describe("everyone else is untouched", () => {
  it("an ordinary signed-in user is not redirected, and nothing is read from the database", async () => {
    const res = await run("/jobs");
    expect(res.headers.get("location")).toBeNull();
    expect(h.dbReads).toBe(0);
  });

  it("a signed-out request is untouched", async () => {
    h.user = null;
    const res = await run("/jobs");
    expect(res.status).toBe(200);
    expect(h.dbReads).toBe(0);
  });

  it("a user whose flag is anything but exactly true is not redirected (a stale string must not lock someone out)", async () => {
    for (const v of ["true", 1, "yes", null, undefined, false]) {
      h.user = { id: "u1", app_metadata: { deletion_pending: v } };
      expect((await run("/jobs")).headers.get("location")).toBeNull();
    }
  });
});
