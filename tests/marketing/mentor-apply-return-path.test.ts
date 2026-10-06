/**
 * Owner request, rule 6: a signed-out visitor who clicks "Become a mentor" on the homepage lands on /mentorship/apply, which needs an account. Do they come back to it after logging in or creating an account?
 * Yes, and this pins each link of that chain so a later change to any one of them cannot quietly break the homepage's link (no auth routing is changed by this PR):
 *   proxy gate -> /login?redirectTo=/mentorship/apply -> login (straight back) or signup (-> onboarding?next=/mentorship/apply -> back).
 * These are pure functions and source reads: no database, no browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";
import { ONBOARDING_PATH, onboardingDestination, safeRedirectTo } from "@/lib/auth/redirect-to";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("the 'Become a mentor' return trip", () => {
  it("/mentorship/apply is behind the signed-in gate, while the bare /mentorship list stays public (that is what the 'Browse mentors' link needs)", () => {
    expect(isProtectedSeekerPath("/mentorship/apply")).toBe(true);
    expect(isProtectedSeekerPath("/mentorship")).toBe(false);
  });
  it("the proxy sends a signed-out visitor to /login carrying the path they asked for", () => {
    expect(read("src/proxy.ts")).toMatch(/url\.pathname = "\/login"; url\.search = ""; url\.searchParams\.set\("redirectTo", request\.nextUrl\.pathname \+ request\.nextUrl\.search\)/);
  });
  it("the carried path is accepted as a safe same-site path, and survives the account-creation detour through onboarding", () => {
    expect(safeRedirectTo("/mentorship/apply", "")).toBe("/mentorship/apply");
    expect(onboardingDestination("/mentorship/apply")).toBe(`${ONBOARDING_PATH}?next=${encodeURIComponent("/mentorship/apply")}`);
  });
  it("the login page keeps it for the form and for its 'create an account' link; the signup page keeps it too", () => {
    const login = read("src/app/(auth)/login/page.tsx");
    expect(login).toMatch(/const redirectTo = safeRedirectTo\(rawRedirectTo, ""\)/);
    expect(login).toMatch(/\/signup\?redirectTo=\$\{encodeURIComponent\(redirectTo\)\}/);
    const signup = read("src/app/(auth)/signup/page.tsx");
    expect(signup).toMatch(/const redirectTo = safeRedirectTo\(rawRedirectTo, ""\)/);
    expect(signup).toMatch(/<SignupForm referredByCode=\{ref\} redirectTo=\{redirectTo \|\| undefined\} \/>/);
  });
});
