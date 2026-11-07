/**
 * PR-E4 gate 2: robots.txt keeps every rule it had and gains exactly one, the redirect behind "Apply on company site". Disallow is not a security control (the route answers noindex and nofollow itself);
 * it only stops crawlers spending their budget on a redirect.
 */
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

/** The disallow list as it stood before PR-E4 (recorded from the code, in order). */
const BEFORE = [
  "/admin", "/api/", "/auto-apply", "/billing", "/feedback", "/refer/", "/resume-builder", "/settings", "/tailor", "/tracker/", "/interviews/", "/onboarding", "/dashboard", "/talent-directory/verify",
  "/mentorship/", "/employer/campaigns", "/employer/jobs", "/employer/onboarding", "/employer/profile", "/employer/analytics", "/employer/talent-directory", "/employer/claim", "/login", "/signup",
  "/forgot-password", "/reset-password", "/auth/", "/extend-posting/", "/dev/",
];

describe("robots()", () => {
  const out = robots();
  const rules = Array.isArray(out.rules) ? out.rules : [out.rules];
  const disallow = (rules[0].disallow ?? []) as string[];
  it("keeps every existing disallow rule, in order, and the allow rule, the sitemap and the host", () => {
    expect(disallow.slice(0, BEFORE.length)).toEqual(BEFORE);
    expect(rules).toHaveLength(1);
    expect(rules[0].allow).toEqual(["/"]);
    expect(out.sitemap).toBe("https://www.talentrah.com/sitemap.xml");
    expect(out.host).toBe("https://www.talentrah.com");
  });
  it("adds exactly one rule: the career-site redirect, and does NOT disallow the job pages themselves", () => {
    expect(disallow.slice(BEFORE.length)).toEqual(["/jobs/*/go"]);
    expect(disallow).not.toContain("/jobs");
    expect(disallow).not.toContain("/jobs/");
  });
});
