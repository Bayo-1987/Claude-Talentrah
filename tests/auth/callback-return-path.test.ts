/**
 * /auth/callback never redirects to anything but a path on this site, including for a `next` value (or a stashed post-auth cookie) that carries a control character or a backslash. The real route, the real
 * @supabase/ssr and tests/support/fake-gotrue.ts, as tests/auth/callback-cookies.test.ts does; the redirect it returns is read from the response, and the Location it sends is resolved with the WHATWG URL parser
 * (as a browser does) to prove it ends on this site's own fallback and nowhere else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { startFakeGoTrue, type FakeGoTrue } from "../support/fake-gotrue";
import { DEFAULT_AFTER_AUTH_PATH, POST_AUTH_COOKIE } from "@/lib/auth/redirect-to";

const ORIGIN = "http://localhost:3000";
let fake: FakeGoTrue;
beforeAll(async () => {
  fake = await startFakeGoTrue();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", fake.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
});

/** The code-verifier cookie a real sign-in leaves in the browser, written by the real ssr client. */
async function verifierCookies(): Promise<string> {
  const store = new Map<string, string>();
  const sb = createServerClient(fake.url, "anon", { cookies: { getAll: () => [...store].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => store.set(name, value)) } });
  await sb.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true, redirectTo: `${ORIGIN}/auth/callback` } });
  return [...store].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function callback(query: string, extraCookie = "") {
  const { GET } = await import("@/app/auth/callback/route");
  const cookie = [await verifierCookies(), extraCookie].filter(Boolean).join("; ");
  return GET(new NextRequest(`${ORIGIN}/auth/callback?${query}`, { headers: { cookie } }));
}

/** Where a browser ends up after following the Location header, resolved against the page the callback ran on. */
const landing = (res: Response) => new URL(res.headers.get("location")!, ORIGIN);

describe("a tab, line feed, carriage return or backslash in `next` lands on the fallback", () => {
  it.each([
    ["a tab", "/\t/evil.example"],
    ["a line feed", "/\n/evil.example"],
    ["a carriage return", "/\r/evil.example"],
    ["a backslash", "/a\\b"],
    ["a NUL", "/\u0000/x"],
    ["a dot segment", "/.//evil.example"],
  ])("%s", async (_n, next) => {
    const res = await callback(`code=abc&next=${encodeURIComponent(next)}`);
    expect(res.status).toBe(307);
    const to = landing(res);
    expect(to.origin, "ends on this site").toBe(ORIGIN);
    expect(to.pathname.startsWith("//")).toBe(false);
    expect(res.headers.get("location"), "exactly the fallback, not the smuggled value").toBe(`${ORIGIN}${DEFAULT_AFTER_AUTH_PATH}`);
  });

  it("a stashed post-auth cookie with a control character is ignored: the ordinary entry lands on onboarding with no destination", async () => {
    const res = await callback("code=abc&next=/onboarding", `${POST_AUTH_COOKIE}=${encodeURIComponent("/\t/evil.example")}`);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/onboarding`);
  });
});

describe("a legitimate `next` is still honoured", () => {
  it("an in-app path with a query and a fragment", async () => {
    const res = await callback(`code=abc&next=${encodeURIComponent("/jobs/abc-123?x=1&y=2")}`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/jobs/abc-123?x=1&y=2`);
  });
  it("a stashed in-app destination is carried through onboarding", async () => {
    const res = await callback("code=abc&next=/onboarding", `${POST_AUTH_COOKIE}=${encodeURIComponent("/jobs/abc")}`);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/onboarding?next=${encodeURIComponent("/jobs/abc")}`);
  });
});
