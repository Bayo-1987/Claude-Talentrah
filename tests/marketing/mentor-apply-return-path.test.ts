/**
 * Owner request, rule 6: a signed-out visitor who clicks "Become a mentor" on the homepage must not be sent to /login by an internal link (send-477's ratchet,
 * e2e/signed-out-link-gate.spec.ts), and must still end on /mentorship/apply after creating an account or logging in. So the link goes to the SIGNUP page with the
 * destination as `redirectTo` (the same shape send-491 used for the other gated destinations), and this pins each link of the chain; no auth routing is changed:
 *   link -> /signup?redirectTo=/mentorship/apply -> (new account) /onboarding?next=/mentorship/apply -> /mentorship/apply
 *                                                -> (has an account) its "Log in" link keeps redirectTo -> /login?redirectTo=... -> /mentorship/apply
 *   a signed-in visitor who clicks it is forwarded by /signup straight to /mentorship/apply.
 * A direct visit to /mentorship/apply while signed out still goes through the proxy to /login?redirectTo=..., as before.
 * These are pure functions and source reads: no database, no browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";
import { ONBOARDING_PATH, onboardingDestination, safeRedirectTo } from "@/lib/auth/redirect-to";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("the 'Become a mentor' return trip", () => {
  it("/mentorship/apply is behind the signed-in gate and /signup and the bare /mentorship list are not (so the link may point at /signup)", () => {
    expect(isProtectedSeekerPath("/mentorship/apply")).toBe(true);
    expect(isProtectedSeekerPath("/signup")).toBe(false);
    expect(isProtectedSeekerPath("/mentorship")).toBe(false);
  });
  it("a direct visit while signed out still goes through the proxy to /login carrying the path", () => {
    expect(read("src/proxy.ts")).toMatch(/url\.pathname = "\/login"; url\.search = ""; url\.searchParams\.set\("redirectTo", request\.nextUrl\.pathname \+ request\.nextUrl\.search\)/);
  });
  it("the carried path is accepted as a safe same-site path, and survives the account-creation detour through onboarding", () => {
    expect(safeRedirectTo("/mentorship/apply", "")).toBe("/mentorship/apply");
    expect(onboardingDestination("/mentorship/apply")).toBe(`${ONBOARDING_PATH}?next=${encodeURIComponent("/mentorship/apply")}`);
  });
  it("the signup page validates and keeps it for its form, forwards a signed-in visitor straight to it, and its 'Log in' link keeps it", () => {
    const signup = read("src/app/(auth)/signup/page.tsx");
    expect(signup).toMatch(/const redirectTo = safeRedirectTo\(rawRedirectTo, ""\)/);
    expect(signup).toMatch(/if \(user\) redirect\(redirectTo \|\| DEFAULT_AFTER_AUTH_PATH\)/);
    expect(signup).toMatch(/<SignupForm referredByCode=\{ref\} redirectTo=\{redirectTo \|\| undefined\} \/>/);
    expect(signup).toMatch(/\/login\?redirectTo=\$\{encodeURIComponent\(redirectTo\)\}/);
  });
  it("the login page keeps it for the form, so logging in lands on /mentorship/apply", () => {
    const login = read("src/app/(auth)/login/page.tsx");
    expect(login).toMatch(/const redirectTo = safeRedirectTo\(rawRedirectTo, ""\)/);
  });
});
