/**
 * "Take me back to where I was" after logging in or signing up (S1-50).
 *
 * The owner opened Mentorship, Scholarships and "Hire through Talentrah" signed out, logged in, and did not land back on that page. The
 * chain broke in four places, each pinned here:
 *   1. the public masthead's "Log in" and "Get started for free" went to a bare /login and /signup;
 *   2. Google and LinkedIn sign-in dropped the destination (the callback URL was hard-coded to /onboarding);
 *   3. the callback fell back to /dashboard (a placeholder that redirects to /jobs) while everything else fell back to /jobs;
 *   4. Google One Tap navigated to the bare onboarding path.
 * The destination for the OAuth and email-confirmation round trips travels in a short-lived cookie, not in the callback URL: the URL
 * Supabase is asked to redirect to stays byte-identical to today's, so nothing depends on how the project's redirect allow-list treats a
 * longer query string.
 * Every destination goes through safeRedirectTo, so only a path on this site is accepted: no https://evil.example, //evil.example or
 * /\evil.example, on any of the five entry points.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import {
  DEFAULT_AFTER_AUTH_PATH,
  POST_AUTH_COOKIE,
  authLinkWithReturn,
  onboardingDestination,
  returnPathFor,
} from "@/lib/auth/redirect-to";

const HOSTILE = ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example/x", "@evil.example", ".evil.example"];

describe("returnPathFor: the page to come back to", () => {
  it.each([
    ["/mentorship", "", "/mentorship"],
    ["/scholarships", "", "/scholarships"],
    ["/jobs/remote", "?workType=remote", "/jobs/remote?workType=remote"],
    ["/jobs/33e65dd6-68ad-4997-acc9-c8e298e1a007", "", "/jobs/33e65dd6-68ad-4997-acc9-c8e298e1a007"],
    ["/employer", "", "/employer"],
    ["/jobs", "?q=a&b=c", "/jobs?q=a&b=c"],
  ])("%s%s -> %s", (pathname, search, expected) => {
    expect(returnPathFor(pathname, search)).toBe(expected);
  });

  it.each([
    ["/ai-resume-builder", "/resume-builder"],
    ["/ai-resume-tailoring", "/tailor"],
    ["/ats-resume-checker", "/tailor"],
    ["/how-auto-apply-works", "/auto-apply"],
  ])("the marketing page %s returns the visitor to the feature it describes: %s", (page, feature) => {
    expect(returnPathFor(page, "")).toBe(feature);
    expect(returnPathFor(page, "?utm_source=x"), "the marketing page's own query is not carried onto the feature").toBe(feature);
  });

  it("a page not in the table returns to itself, including near-misses of the mapped ones", () => {
    for (const page of ["/ai-resume-builder/extra", "/ai-resume-tailoringx", "/blog/ai-resume-builder", "/how-match-scores-work", "/about", "/vs/jobright", "/resume-builder", "/tailor"]) {
      expect(returnPathFor(page, ""), page).toBe(page);
    }
  });

  it.each(["/", "/login", "/signup", "/signup/check-email", "/forgot-password", "/forgot-password/check-email", "/reset-password", "/onboarding", "/auth/callback", "/admin/login", "/api/x", "/unsubscribe", "/extend-posting/abc"])(
    "%s has nothing to come back to: the default applies",
    (pathname) => {
      expect(returnPathFor(pathname, "")).toBe("");
      expect(returnPathFor(pathname, "?x=1")).toBe("");
    },
  );

  it("a query string without its '?' is read the same", () => {
    expect(returnPathFor("/jobs", "q=a")).toBe("/jobs?q=a");
  });

  it("builds the log in and sign up links with the encoded path, and bare links where there is none", () => {
    expect(authLinkWithReturn("/login", "/mentorship", "")).toBe("/login?redirectTo=%2Fmentorship");
    expect(authLinkWithReturn("/signup", "/jobs/remote", "?workType=remote")).toBe("/signup?redirectTo=%2Fjobs%2Fremote%3FworkType%3Dremote");
    expect(authLinkWithReturn("/login", "/", "")).toBe("/login");
    expect(authLinkWithReturn("/signup", "/login", "?redirectTo=%2Fjobs")).toBe("/signup");
  });
});

describe("one fallback after authentication", () => {
  it("is /jobs, shared by the callback, the login and signup pages and onboarding", async () => {
    expect(DEFAULT_AFTER_AUTH_PATH).toBe("/jobs");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const read = (f: string) => readFileSync(path.join(__dirname, "../../src", f), "utf8");
    for (const f of ["app/auth/callback/route.ts", "app/(auth)/login/page.tsx", "app/(auth)/signup/page.tsx", "app/onboarding/page.tsx"]) {
      expect(read(f), f).not.toMatch(/["']\/dashboard["']/);
      expect(read(f), f).toContain("DEFAULT_AFTER_AUTH_PATH");
    }
  });
});

describe("the public masthead's links", () => {
  afterEach(() => { vi.doUnmock("next/navigation"); vi.doUnmock("next/link"); vi.resetModules(); });
  const render = async (pathname: string) => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams() }));
    vi.doMock("next/link", () => ({ default: (p: { href: string; children: unknown; [k: string]: unknown }) => <a href={p.href} aria-label={p["aria-label"] as string}>{p.children as never}</a> }));
    const { MarketingMasthead } = await import("@/components/marketing/marketing-masthead");
    return renderToStaticMarkup(<MarketingMasthead />);
  };
  const hrefs = (html: string) => ({
    login: /<a href="([^"]*)"[^>]*>\s*Log in\s*<\/a>/.exec(html)?.[1],
    signup: /<a href="([^"]*)"[^>]*aria-label="Get started for free"/.exec(html)?.[1],
  });

  it.each(["/mentorship", "/scholarships", "/tracker", "/employer", "/jobs"])("on %s both links carry that page as redirectTo", async (pathname) => {
    const h = hrefs(await render(pathname));
    expect(h.login).toBe(`/login?redirectTo=${encodeURIComponent(pathname)}`);
    expect(h.signup).toBe(`/signup?redirectTo=${encodeURIComponent(pathname)}`);
  });

  it.each([["/ai-resume-builder", "/resume-builder"], ["/ai-resume-tailoring", "/tailor"], ["/ats-resume-checker", "/tailor"], ["/how-auto-apply-works", "/auto-apply"]])("on the marketing page %s both links carry the feature, %s", async (pathname, feature) => {
    const h = hrefs(await render(pathname));
    expect(h.login).toBe(`/login?redirectTo=${encodeURIComponent(feature)}`);
    expect(h.signup).toBe(`/signup?redirectTo=${encodeURIComponent(feature)}`);
  });

  it.each(["/", "/login", "/signup"])("on %s they stay bare", async (pathname) => {
    const h = hrefs(await render(pathname));
    expect(h.login).toBe("/login");
    expect(h.signup).toBe("/signup");
  });
});

describe("the provider buttons post the destination", () => {
  afterEach(() => { vi.doUnmock("@/lib/auth/actions"); vi.doUnmock("next/navigation"); vi.doUnmock("next/link"); vi.resetModules(); });
  it("both forms carry redirectTo when there is one, and neither does when there is not", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/actions", () => ({ signInWithOAuthAction: vi.fn() }));
    const { OAuthButtons } = await import("@/components/auth/oauth-buttons");
    const withDest = renderToStaticMarkup(<OAuthButtons redirectTo="/mentorship" />);
    expect(withDest.match(/name="redirectTo" value="\/mentorship"/g)).toHaveLength(2);
    expect(withDest).toContain('value="google"');
    expect(withDest).toContain('value="linkedin_oidc"');
    expect(renderToStaticMarkup(<OAuthButtons />)).not.toContain('name="redirectTo"');
  });

  it("the login and signup pages hand their validated redirectTo to the buttons", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const f of ["app/(auth)/login/page.tsx", "app/(auth)/signup/page.tsx"]) {
      expect(readFileSync(path.join(__dirname, "../../src", f), "utf8"), f).toMatch(/<OAuthButtons redirectTo=\{redirectTo \|\| undefined\} \/>/);
    }
  });
});

describe("the actions: OAuth and email signup stash the destination", () => {
  const jar = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn(), get: vi.fn(() => undefined), getAll: () => [] }));
  const supabase = vi.hoisted(() => ({
    signInWithOAuth: vi.fn(async () => ({ data: { url: "https://accounts.example/o/auth" }, error: null })),
    signUp: vi.fn(async () => ({ data: { user: { id: "u1" }, session: { access_token: "x" } }, error: null })),
  }));
  vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: supabase }) }));
  vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
  vi.mock("@/lib/auth/signup-rate-limit", () => ({ consumeSignupRateLimit: async () => ({ allowed: true }) }));
  vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => "192.0.2.1" }));
  vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));
  vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }) }));
  vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => (n === "host" ? "talentrah.test" : null) }), cookies: async () => jar }));

  beforeEach(() => { jar.set.mockClear(); jar.delete.mockClear(); supabase.signInWithOAuth.mockClear(); supabase.signUp.mockClear(); });

  const oauthForm = (provider: string, redirectTo?: string) => { const fd = new FormData(); fd.set("provider", provider); if (redirectTo !== undefined) fd.set("redirectTo", redirectTo); return fd; };
  const redirectedTo = (e: { to?: string; digest?: string }) => e.to ?? String(e.digest).split(";")[2];
  const run = async (fd: FormData) => { const { signInWithOAuthAction } = await import("@/lib/auth/actions"); return signInWithOAuthAction(fd).catch((e) => e); };

  it.each(["google", "linkedin_oidc"])("%s: the destination travels in the cookie, and the callback URL given to Supabase is unchanged", async (provider) => {
    const thrown = await run(oauthForm(provider, "/mentorship"));
    expect(redirectedTo(thrown)).toBe("https://accounts.example/o/auth");
    expect(supabase.signInWithOAuth).toHaveBeenCalledWith({ provider, options: { redirectTo: "http://talentrah.test/auth/callback?next=/onboarding" } });
    expect(jar.set).toHaveBeenCalledTimes(1);
    expect(jar.set.mock.calls[0][0]).toBe(POST_AUTH_COOKIE);
    expect(jar.set.mock.calls[0][1]).toBe("/mentorship");
    expect(jar.set.mock.calls[0][2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/auth" });
  });

  it("the cookie lives ten minutes at most, is HttpOnly, SameSite=Lax (it must still arrive on the provider's top-level redirect back) and scoped to /auth", async () => {
    await run(oauthForm("google", "/mentorship"));
    const options = jar.set.mock.calls[0][2];
    expect(options.maxAge).toBeGreaterThan(0);
    expect(options.maxAge).toBeLessThanOrEqual(600);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/auth" });
    expect(options.secure, "not Secure outside production, or plain-HTTP dev and CI would drop it").toBe(false);
  });

  it("the cookie is Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await run(oauthForm("linkedin_oidc", "/scholarships"));
      expect(jar.set.mock.calls[0][2].secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("it holds only the path, nothing else", async () => {
    await run(oauthForm("google", "/jobs/remote?workType=remote"));
    expect(jar.set.mock.calls[0][1]).toBe("/jobs/remote?workType=remote");
  });

  it.each(["google", "linkedin_oidc"])("%s with no destination: no cookie, and any stale one is removed", async (provider) => {
    await run(oauthForm(provider));
    expect(jar.set).not.toHaveBeenCalled();
    expect(jar.delete).toHaveBeenCalledWith(expect.objectContaining({ name: POST_AUTH_COOKIE }));
  });

  it.each(HOSTILE)("OAuth refuses %s as a destination", async (hostile) => {
    await run(oauthForm("google", hostile));
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("email signup stashes the destination too (the confirmation link may bring them back through the callback)", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ firstName: "Ada", lastName: "Obi", email: "ada@talentrah.test", country: "Nigeria", password: ["Pass", "word123"].join(""), termsAccepted: "on", redirectTo: "/scholarships" })) fd.set(k, v);
    const { signUpAction } = await import("@/lib/auth/actions");
    const thrown = await signUpAction({ error: null }, fd).catch((e) => e);
    expect(redirectedTo(thrown)).toBe("/onboarding?next=%2Fscholarships");
    expect(jar.set.mock.calls.find((c) => c[0] === POST_AUTH_COOKIE)?.[1]).toBe("/scholarships");
  });
});

describe("/auth/callback brings the visitor back", () => {
  let fakeGoTrue: Awaited<ReturnType<(typeof import("../support/fake-gotrue"))["startFakeGoTrue"]>>;
  const cookieHeader = async (extra: string) => {
    const { createServerClient } = await import("@supabase/ssr");
    const store = new Map<string, string>();
    const sb = createServerClient(fakeGoTrue.url, "anon", { cookies: { getAll: () => [...store].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => store.set(name, value)) } });
    await sb.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true } });
    return [...[...store].map(([k, v]) => `${k}=${v}`), extra].filter(Boolean).join("; ");
  };
  const callback = async (query: string, extra = "") => {
    const { GET } = await import("@/app/auth/callback/route");
    return GET(new NextRequest(`http://localhost:3000/auth/callback?${query}`, { headers: { cookie: await cookieHeader(extra) } }));
  };
  const where = (res: Response) => { const u = new URL(res.headers.get("location")!); return u.pathname + u.search; };

  beforeEach(async () => {
    const { startFakeGoTrue } = await import("../support/fake-gotrue");
    fakeGoTrue = await startFakeGoTrue();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", fakeGoTrue.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    return async () => { vi.unstubAllEnvs(); await fakeGoTrue.close(); };
  });

  it("the stashed destination is carried through onboarding, and the cookie is cleared", async () => {
    const res = await callback("code=abc&next=/onboarding", `${POST_AUTH_COOKIE}=%2Fmentorship`);
    expect(where(res)).toBe("/onboarding?next=%2Fmentorship");
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${POST_AUTH_COOKIE}=;`) || /max-age=0/i.test(c) && c.startsWith(POST_AUTH_COOKIE))).toBe(true);
  });

  it("without a stashed destination it goes to plain onboarding, as before", async () => {
    expect(where(await callback("code=abc&next=/onboarding"))).toBe("/onboarding");
  });

  it("with no next at all it goes to /jobs (the one default), not /dashboard", async () => {
    expect(where(await callback("code=abc"))).toBe("/jobs");
  });

  it("a failed exchange clears the stashed destination too, so it never follows a later sign-in", async () => {
    // no PKCE verifier cookie: the exchange cannot succeed
    const { GET } = await import("@/app/auth/callback/route");
    const failed = await GET(new NextRequest("http://localhost:3000/auth/callback?code=abc&next=/onboarding", { headers: { cookie: `${POST_AUTH_COOKIE}=%2Fmentorship` } }));
    expect(where(failed)).toBe("/login?error=auth_callback_failed");
    expect(failed.headers.getSetCookie().some((c) => c.startsWith(`${POST_AUTH_COOKIE}=`) && /max-age=0/i.test(c))).toBe(true);
  });

  it("the password-reset hop is not hijacked by a stashed destination", async () => {
    expect(where(await callback("code=abc&next=/reset-password", `${POST_AUTH_COOKIE}=%2Fmentorship`))).toBe("/reset-password");
  });

  it.each(HOSTILE)("a hostile stashed destination (%s) is ignored", async (hostile) => {
    expect(where(await callback("code=abc&next=/onboarding", `${POST_AUTH_COOKIE}=${encodeURIComponent(hostile)}`))).toBe("/onboarding");
  });
});

describe("email login and signup: only a path on this site", () => {
  it.each(HOSTILE)("onboardingDestination(%s) is plain onboarding", (hostile) => {
    expect(onboardingDestination(hostile)).toBe("/onboarding");
  });
  it("and a good one is carried, encoded", () => {
    expect(onboardingDestination("/jobs/remote?workType=remote")).toBe("/onboarding?next=%2Fjobs%2Fremote%3FworkType%3Dremote");
  });
});
