/**
 * The assessment route is PRIVATE: every response from it says noindex and Cache-Control: private, no-store (response headers, set in next.config.ts), and the page also says noindex in its own robots meta.
 * Evaluates the real headers() the same way tests/embed/embed-headers.test.ts does, so what is pinned is what a request would receive.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error TS7016
import { match } from "next/dist/compiled/path-to-regexp";
import nextConfig from "../../next.config";

type Rule = { source: string; headers: Array<{ key: string; value: string }> };
const headersFor = (rules: Rule[], path: string) => {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!match(rule.source, { decode: decodeURIComponent })(path)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
};

const JOB = "11111111-1111-1111-1111-111111111111";
const APP = "22222222-2222-2222-2222-222222222222";

describe("the assessment route sends noindex and no-store", () => {
  it("for any job and application id", async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    for (const path of [`/employer/jobs/${JOB}/applicants/${APP}/assessment`, "/employer/jobs/abc/applicants/def/assessment"]) {
      const h = headersFor(rules, path);
      expect(h["X-Robots-Tag"], path).toMatch(/noindex/);
      expect(h["X-Robots-Tag"], path).toMatch(/nofollow/);
      expect(h["Cache-Control"], path).toBe("private, no-store");
      expect(h["X-Frame-Options"], "the site-wide policy still applies").toBe("DENY");
    }
  });
  it("and ONLY that route: near-miss paths are not caught (a loosened rule would put no-store and noindex on pages that should stay as they are)", async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    const nearMisses = [
      // the sibling pages of the same applicant
      `/employer/jobs/${JOB}/applicants/${APP}/resume`,
      `/employer/jobs/${JOB}/applicants/${APP}/message`,
      `/employer/jobs/${JOB}/applicants/${APP}/schedule`,
      // the last segment, a little different
      `/employer/jobs/${JOB}/applicants/${APP}/assessments`,
      `/employer/jobs/${JOB}/applicants/${APP}/assessment-extra`,
      // one segment too many or too few
      `/employer/jobs/${JOB}/applicants/${APP}/assessment/extra`,
      `/employer/jobs/${JOB}/applicants/${APP}/${APP}/assessment`,
      `/employer/jobs/${JOB}/applicants/assessment`,
      `/employer/jobs/${JOB}/assessment`,
      `/employer/jobs/${JOB}/applicants`,
      "/employer/assessment",
      // other places a score or an applicant shows
      "/employer/jobs",
      "/jobs",
      `/jobs/${JOB}`,
    ];
    for (const path of nearMisses) {
      const h = headersFor(rules, path);
      expect(h["X-Robots-Tag"], `${path}: no X-Robots-Tag from the assessment rule`).toBeUndefined();
      expect(h["Cache-Control"], `${path}: no Cache-Control from the assessment rule`).toBeUndefined();
    }
  });
  it("Next matches header sources without regard to case, so a differently-cased last segment gets the headers too: never less private, and that URL is not a page", async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    expect(headersFor(rules, `/employer/jobs/${JOB}/applicants/${APP}/Assessment`)["Cache-Control"]).toBe("private, no-store");
  });
  it("no OTHER rule that matches the assessment path sets these two headers (a future unrelated rule that does not touch them is fine)", async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    const path = `/employer/jobs/${JOB}/applicants/${APP}/assessment`;
    const assessmentRule = "/employer/jobs/:id/applicants/:applicationId/assessment";
    expect(rules.some((r) => r.source === assessmentRule), "the assessment rule is there").toBe(true);
    const others = rules.filter((r) => r.source !== assessmentRule && match(r.source, { decode: decodeURIComponent })(path));
    for (const rule of others) {
      const keys = rule.headers.map((h) => h.key);
      expect(keys, `${rule.source} matches the assessment path and must not set X-Robots-Tag`).not.toContain("X-Robots-Tag");
      expect(keys, `${rule.source} matches the assessment path and must not set Cache-Control`).not.toContain("Cache-Control");
    }
  });
  it("the page's own robots meta says noindex, nofollow too", () => {
    const page = readFileSync(join(__dirname, "../../src/app/employer/jobs/[id]/applicants/[applicationId]/assessment/page.tsx"), "utf8");
    expect(page).toMatch(/robots:\s*\{[^}]*index:\s*false/);
    expect(page).toMatch(/robots:\s*\{[^}]*follow:\s*false/);
  });
});
