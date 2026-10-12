/**
 * The Google country step, through the REAL proxy (src/proxy.ts), with `updateSession` stubbed to hand it a user, the way pending-deletion-gate.test.ts does.
 *
 * Pinned: a Google sign-up with no country is redirected from a dashboard URL to the step, keeping the destination; the same request goes through once the user
 * carries the country (what the session looks like after Continue: the proxy asks the auth server who the user is on every request, so the saved metadata is seen
 * at once and the person is not bounced back); an email user with a null country (every pooled test user and minted e2e session) is never redirected; the gate
 * reads no database; it runs only for a signed-in request and after the signed-out gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> } | null;
const h = vi.hoisted(() => ({ user: null as unknown as U, dbReads: 0 }));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async () => ({
    response: NextResponse.next(),
    user: h.user,
    accessToken: null,
    supabase: {
      from: () => {
        h.dbReads += 1;
        throw new Error("the gate must not query the database");
      },
    },
  }),
}));
vi.mock("@/lib/supabase/public-read", () => ({ createPublicReadClient: () => ({ rpc: async () => ({ data: false, error: null }) }) }));

import { proxy } from "@/proxy";

const run = (path: string) => proxy(new NextRequest(`https://www.talentrah.com${path}`), { waitUntil: vi.fn() } as never);
const google = (meta: Record<string, unknown> = {}): U => ({ id: "g1", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: meta });
const email = (meta: Record<string, unknown> = {}): U => ({ id: "e1", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: meta });

beforeEach(() => {
  h.user = null;
  h.dbReads = 0;
});

describe("a Google sign-up with no country", () => {
  it("is sent to the step from a dashboard URL, with the destination kept", async () => {
    h.user = google({ full_name: "Agnes A" });
    const res = await run("/dashboard");
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/welcome/country");
    expect(to.searchParams.get("next")).toBe("/dashboard");
  });
  it("cannot reach any seeker-app page until the country is saved, then can (the same request, the user now carrying the country)", async () => {
    for (const path of ["/dashboard", "/onboarding", "/settings", "/tracker/abc/sent"]) {
      h.user = google();
      expect((await run(path)).status, `${path} before`).toBe(307);
      h.user = google({ country: "Nigeria" });
      const after = await run(path);
      expect(after.status, `${path} after Continue`).toBe(200);
      expect(after.headers.get("location"), path).toBeNull();
    }
  });
  it("is also sent to the step from /jobs (the default landing after sign-in), /tracker, /scholarships and /mentorship, but a signed-out visitor to the same pages is not", async () => {
    for (const path of ["/jobs", "/tracker", "/scholarships", "/mentorship"]) {
      h.user = google();
      const gated = await run(path);
      expect(gated.status, path).toBe(307);
      expect(new URL(gated.headers.get("location")!).searchParams.get("next"), path).toBe(path);
      h.user = null;
      const open = await run(path);
      expect(open.status, `${path} signed out`).toBe(200);
      expect(open.headers.get("location"), `${path} signed out`).toBeNull();
    }
  });
  it("can always reach the step itself, the sign-in page and the API (no loop)", async () => {
    h.user = google();
    for (const path of ["/welcome/country", "/welcome/country/sync", "/login", "/api/tailoring", "/auth/callback"]) {
      expect((await run(path)).headers.get("location"), path).toBeNull();
    }
  });
});

describe("everyone else is untouched", () => {
  it("an email user with a null country (pooled and minted e2e users) reaches the dashboard", async () => {
    h.user = email();
    for (const path of ["/dashboard", "/onboarding", "/settings", "/resume-builder"]) {
      const res = await run(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });
  it("a Google user who already has a country is untouched", async () => {
    h.user = google({ country: "Kenya" });
    expect((await run("/dashboard")).headers.get("location")).toBeNull();
  });
  it("employer pages are not gated", async () => {
    h.user = google();
    expect((await run("/employer/jobs")).headers.get("location")).toBeNull();
  });
  it("a signed-out request still goes to /login (the existing gate answers first)", async () => {
    h.user = null;
    expect(new URL((await run("/dashboard")).headers.get("location")!).pathname).toBe("/login");
  });
  it("the gate makes no database query", async () => {
    h.user = google();
    await run("/dashboard");
    expect(h.dbReads).toBe(0);
  });
});
