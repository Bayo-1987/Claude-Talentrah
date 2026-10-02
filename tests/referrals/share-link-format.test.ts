/**
 * Referral links must keep working (Refer & Earn / send-515). The REAL share link is `<origin>/signup?ref=<CODE>` (src/lib/referrals/url.ts), not
 * anything under /refer/, so the new robots rule (`Disallow: /refer/`) and the gate (sub-paths of /refer redirect to login) cannot break a link that was
 * already shared. And the capture is by query parameter on ANY page (src/proxy.ts), with a first-party cookie, not by path.
 *
 * What proves "a signed-out visitor following a real referral link lands on signup with the code kept, and the signup is attributed to the referrer":
 *   - this file: the link's path is /signup, outside the gate and outside robots' disallow;
 *   - e2e/referral-capture.spec.ts: the link sets the cookie, "signup with no ?ref= in the URL but a live cookie still creates the referral", and the
 *     self-referral guard still refuses a cookie-sourced code (all run in CI against the real stack).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import robots from "@/app/robots";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "www.talentrah.com", "x-forwarded-proto": "https" }),
}));

describe("the share link", () => {
  it("is <origin>/signup?ref=<CODE>: a /signup path, never under /refer", async () => {
    const { getReferralUrl } = await import("@/lib/referrals/url");
    const url = new URL(await getReferralUrl("AB12CD34"));
    expect(url.origin).toBe("https://www.talentrah.com");
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("ref")).toBe("AB12CD34");
    expect(url.pathname.startsWith("/refer")).toBe(false);
  });

  it("the path it uses is not behind the seeker gate, and the new robots rule (/refer/) is not a prefix of it", () => {
    // robots.txt only steers crawlers (it already disallows /signup itself, which never stopped a person following a link); what matters is that
    // THIS change's rule cannot reach the link's path, and the gate (which redirects people) does not.
    expect(isProtectedSeekerPath("/billing"), "control: the gate still gates").toBe(true);
    expect(isProtectedSeekerPath("/signup")).toBe(false);
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = (Array.isArray(rule?.disallow) ? rule.disallow : [rule?.disallow]).filter((d): d is string => typeof d === "string");
    expect(disallow, "control: robots disallows what is under /refer").toContain("/refer/");
    expect("/signup".startsWith("/refer/")).toBe(false);
  });

  it("the new /refer rules do not touch where a referral link LANDS: only /refer/* is gated", () => {
    expect(isProtectedSeekerPath("/refer")).toBe(false);
    expect(isProtectedSeekerPath("/refer/anything")).toBe(true);
  });

  it("the capture is by the ?ref= query parameter on any page (not a /refer path), and the e2e that follows a real link exists", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toMatch(/searchParams\.get\("ref"\)/);
    const e2e = readFileSync("e2e/referral-capture.spec.ts", "utf8");
    expect(e2e).toContain("a valid ?ref= on the scholarship page sets a first-party cookie");
    expect(e2e).toContain("signup with no ?ref= in the URL but a live cookie still creates the referral");
  });
});
