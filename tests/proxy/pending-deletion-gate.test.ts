/**
 * ACCT-1 PR 1 — the gate on EVERY request, not only sign-in.
 *
 * Confirming a deletion signs the person out everywhere AFTER the database transaction, and that call can fail, or a second device can keep a live
 * session. So the proxy (src/proxy.ts) reads the person's pending flag on every request that carries a session and sends them to "Restore it, or keep
 * the deletion?". A session on another device lands there on its very next request, even when global sign-out failed.
 *
 * Pinned here: pages redirect (with the refreshed session cookies kept); API calls get a 403 JSON, never a redirect; the prompt page, sign-in and the auth
 * routes are exempt (or nobody could ever restore or leave); signed-out requests, cron and webhook routes (no session) are untouched; an ordinary
 * user is untouched; a failed flag read does NOT lock a normal user out; and the whole thing is wired into `proxy()` before anything else touches the
 * user.
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  flag: null as string | null,
  flagError: null as null | { message: string },
  reads: 0,
  touched: 0,
  response: undefined as undefined | (() => Response),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async () => ({
    response: h.response ? h.response() : NextResponse.next(),
    user: h.user,
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              h.reads += 1;
              return h.flagError ? { data: null, error: h.flagError } : { data: { deletion_requested_at: h.flag }, error: null };
            },
          }),
        }),
      }),
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

beforeEach(() => {
  h.user = { id: "u1" };
  h.flag = null;
  h.flagError = null;
  h.reads = 0;
  h.touched = 0;
  h.response = undefined;
  waitUntil.mockReset();
});

describe("a session scheduled for deletion lands on the prompt on its next request", () => {
  beforeEach(() => {
    h.flag = "2026-10-02T12:00:00Z";
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

  it("keeps the refreshed session cookies the proxy just set (a dropped refresh would log the person out half-way)", async () => {
    h.response = () => {
      const r = NextResponse.next();
      r.cookies.set("sb-access-token", "refreshed-token");
      return r;
    };
    const res = await run("/jobs");
    expect(res.cookies.get("sb-access-token")?.value).toBe("refreshed-token");
  });

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

  it.each(["/settings/account-deletion", "/login", "/auth/callback", "/auth/signout", "/api/auth/anything"])("%s is exempt (the person must be able to restore, or leave)", async (path) => {
    const res = await run(path);
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });
});

describe("everyone else is untouched", () => {
  it("an ordinary signed-in user is not redirected, and the flag is read once", async () => {
    const res = await run("/jobs");
    expect(res.headers.get("location")).toBeNull();
    expect(h.reads).toBe(1);
  });

  it("a signed-out request never reads a flag", async () => {
    h.user = null;
    const res = await run("/jobs");
    expect(res.status).toBe(200);
    expect(h.reads).toBe(0);
  });

  it("a failed flag read does NOT lock an ordinary user out (the database still hides the account, and requireUser() is a second gate)", async () => {
    h.flagError = { message: "connection reset" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run("/jobs");
    expect(res.headers.get("location")).toBeNull();
    expect(error.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/pending-deletion/i);
    error.mockRestore();
  });

  it("an admin page is not read for a flag", async () => {
    const res = await run("/admin/login");
    expect(res.status).toBe(200);
    expect(h.reads).toBe(0);
  });
});
