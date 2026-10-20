/**
 * The pages that send an ALREADY signed-in visitor on to a `redirectTo` / `next` value from the query string: the seeker login page, the seeker signup page, onboarding, and the admin login page. The page calls
 * `redirect(path)` with that value, and a path handed to redirect() goes into a Location header as it is, so what matters is what a browser does with it. These tests run the REAL pages with the signed-in user and
 * redirect() mocked (no database, no Next server), capture the path passed to redirect(), and resolve it with the WHATWG URL parser (as a browser does): it must be the page's own fallback, or the legitimate path
 * unchanged, and in every case on this site.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ redirected: null as null | string }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    state.redirected = to;
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    // onboarding's base-resume lookup: a base resume exists, so onboarding redirects on to `next`
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "r1" }, error: null }) }) }) }) }),
  }),
}));
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/require-user")>()),
  requireUser: async () => ({ user: { id: "u1" }, profile: { first_name: "Ada", onboarding_skipped_at: null } }),
}));
vi.mock("@/lib/admin/require-admin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/require-admin")>()), getAdmin: async () => ({ id: "a1", permissions: [] }) }));
vi.mock("@/components/auth/login-form", () => ({ LoginForm: () => null }));
vi.mock("@/components/auth/oauth-buttons", () => ({ OAuthButtons: () => null }));
vi.mock("@/components/auth/google-one-tap", () => ({ GoogleOneTap: () => null }));
vi.mock("@/components/auth/signup-form", () => ({ SignupForm: () => null }));
vi.mock("@/components/onboarding/resume-upload", () => ({ ResumeUpload: () => null }));
vi.mock("@/lib/profile/settings-actions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/profile/settings-actions")>()), skipOnboardingAction: vi.fn() }));
vi.mock("@/components/admin/admin-login-form", () => ({ AdminLoginForm: () => null }));

const { default: LoginPage } = await import("@/app/(auth)/login/page");
const { default: SignupPage } = await import("@/app/(auth)/signup/page");
const { default: OnboardingPage } = await import("@/app/onboarding/page");
const { default: AdminLoginPage } = await import("@/app/admin/login/page");

const SITE = "https://talentrah.test";
beforeEach(() => {
  state.redirected = null;
});

/** What redirect() was given, or null if the page rendered instead. */
async function redirectedTo(run: () => Promise<unknown>): Promise<string | null> {
  state.redirected = null;
  try {
    await run();
  } catch (e) {
    if ((e as Error).message !== "NEXT_REDIRECT") throw e;
  }
  return state.redirected;
}

const PAGES: Array<{ name: string; fallback: string; run: (value: string) => Promise<unknown>; legit: string }> = [
  { name: "seeker login page (?redirectTo=)", fallback: "/jobs", run: (v) => LoginPage({ searchParams: Promise.resolve({ redirectTo: v }) }), legit: "/dashboard" },
  { name: "seeker signup page (?redirectTo=)", fallback: "/jobs", run: (v) => SignupPage({ searchParams: Promise.resolve({ redirectTo: v }) }), legit: "/dashboard" },
  { name: "onboarding (?next=)", fallback: "/jobs", run: (v) => OnboardingPage({ searchParams: Promise.resolve({ next: v }) }), legit: "/dashboard" },
];

const HOSTILE: Array<[string, string]> = [
  ["a tab", "/\t/evil.example"],
  ["a line feed", "/\n/evil.example"],
  ["a carriage return", "/\r/evil.example"],
  ["a backslash", "/a\\b"],
  ["a backslash host", "/x\\/evil.example"],
  ["a dot segment", "/.//evil.example"],
];

describe.each(PAGES)("$name, signed-in visitor", ({ fallback, run, legit }) => {
  it.each(HOSTILE)("%s: the redirect is the page's own fallback, on this site", async (_n, value) => {
    const to = await redirectedTo(() => run(value));
    expect(to, "the page redirected").not.toBeNull();
    const url = new URL(to!, SITE);
    expect(url.origin, `redirect(${JSON.stringify(to)}) resolves on this site`).toBe(SITE);
    expect(url.pathname.startsWith("//")).toBe(false);
    expect(to).toBe(fallback);
  });

  it("a legitimate path still redirects there, unchanged", async () => {
    expect(await redirectedTo(() => run(legit))).toBe(legit);
    expect(await redirectedTo(() => run("/jobs/abc-123?x=1&y=2#top"))).toBe("/jobs/abc-123?x=1&y=2#top");
  });
});

describe("admin login page, signed-in admin (its own /admin prefix rule on top of safeRedirectTo)", () => {
  const run = (v: string) => AdminLoginPage({ searchParams: Promise.resolve({ redirectTo: v }) });
  it.each([
    ["a tab after the prefix", "/admin\t/x"],
    ["a line feed after the prefix", "/admin/\n/evil.example"],
    ["a carriage return after the prefix", "/admin\r/x"],
    ["a backslash after the prefix", "/admin\\x"],
  ])("%s: the redirect is the admin fallback", async (_n, value) => {
    const to = await redirectedTo(() => run(value));
    expect(to).toBe("/admin");
    expect(new URL(to!, SITE).origin).toBe(SITE);
  });
  it("a legitimate admin path still redirects there, unchanged", async () => {
    expect(await redirectedTo(() => run("/admin/people"))).toBe("/admin/people");
  });
  it("a value that is not under /admin goes to the admin fallback as before", async () => {
    expect(await redirectedTo(() => run("/dashboard"))).toBe("/admin");
  });
});
