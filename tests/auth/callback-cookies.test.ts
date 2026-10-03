/**
 * /auth/callback puts the session cookies on the redirect it returns (S1-44), and only ever redirects to a path on this site.
 *
 * The callback exchanges the emailed or OAuth code for a session and redirects. It used to write the session through the shared
 * `cookies()` store and return a separate `NextResponse.redirect`, relying on Next to merge the two (the Supabase template does the same).
 * That held in practice but was assumed, not proven. It now writes the cookies onto the very response it returns, so a unit test can
 * prove it: the real route and the real @supabase/ssr against tests/support/fake-gotrue.ts, with the PKCE verifier cookie a real
 * sign-in would have left in the browser.
 *
 * Also pinned: `next` came straight from the query string into `${origin}${next}`. "@evil.example" or ".evil.example" made the redirect
 * leave the site (https://talentrah.com@evil.example). It now goes through safeRedirectTo, like every other redirect target here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { startFakeGoTrue, type FakeGoTrue } from "../support/fake-gotrue";
import { DEFAULT_AFTER_AUTH_PATH } from "@/lib/auth/redirect-to";

const SESSION_COOKIE = "sb-127-auth-token";
let fake: FakeGoTrue;
beforeAll(async () => {
  fake = await startFakeGoTrue();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", fake.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
});
afterAll(async () => { vi.unstubAllEnvs(); await fake.close(); });

/** The cookies a browser holds after clicking "Continue with Google": the PKCE code verifier, written by the real ssr client. */
async function verifierCookies(): Promise<string> {
  const store = new Map<string, string>();
  const sb = createServerClient(fake.url, "anon", { cookies: { getAll: () => [...store].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => store.set(name, value)) } });
  await sb.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true, redirectTo: "http://localhost:3000/auth/callback" } });
  expect(store.size, "the sign-in must have stored a code verifier").toBeGreaterThan(0);
  return [...store].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function callback(query: string, cookie: string) {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(new NextRequest(`http://localhost:3000/auth/callback?${query}`, { headers: { cookie } }));
}

describe("a successful code exchange", () => {
  it("sets the session cookies on the redirect it returns, and clears the one-time verifier", async () => {
    const res = await callback("code=abc&next=/onboarding", await verifierCookies());
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/onboarding");
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`)), `set-cookie: ${setCookies.join(" || ")}`).toBe(true);
    expect(setCookies.some((c) => /code-verifier=;|code-verifier=.*max-age=0/i.test(c)), "the verifier cookie is cleared").toBe(true);
  });

  it("the session cookie it sets is a usable session (the next request is signed in)", async () => {
    const res = await callback("code=abc&next=/dashboard", await verifierCookies());
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0];
    const { proxy } = await import("@/proxy");
    const next = await proxy(new NextRequest("http://localhost:3000/billing", { headers: { cookie: session } }), { waitUntil: () => {} } as never);
    expect(next.status, "a protected page after the callback").toBe(200);
  });
});

describe("a failed exchange", () => {
  it("redirects to /login with the error flag and no session cookie", async () => {
    const res = await callback("code=abc", ""); // no verifier cookie: the exchange cannot succeed
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(res.headers.get("location")).toContain("error=auth_callback_failed");
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it("no code at all: the same", async () => {
    const res = await callback("next=/dashboard", "");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("`next` can only be a path on this site", () => {
  it.each(["@evil.example", ".evil.example", "//evil.example", "https://evil.example", "/\\evil.example", "evil.example/x"])("%s", async (next) => {
    const res = await callback(`code=abc&next=${encodeURIComponent(next)}`, await verifierCookies());
    const location = new URL(res.headers.get("location")!);
    expect(location.origin, `redirected to ${location.href}`).toBe("http://localhost:3000");
    expect(location.pathname).toBe(DEFAULT_AFTER_AUTH_PATH);
  });

  it("an ordinary same-site path is kept, with its query", async () => {
    const res = await callback(`code=abc&next=${encodeURIComponent("/jobs?workType=remote")}`, await verifierCookies());
    expect(res.headers.get("location")).toBe("http://localhost:3000/jobs?workType=remote");
  });
});
