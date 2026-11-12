/**
 * P6-CI (JOBS-POLISH-1): the e2e job builds and starts the app with NODE_ENV=production. Since P6, the operator invite refuses in production unless NEXT_PUBLIC_SITE_URL is a real, non-localhost
 * address (src/lib/auth/invite-origin.ts), and e2e/admin-operators-invite-form-rule.spec.ts sends one, so the job that runs it has to set the variable. NEXT_PUBLIC_ values are inlined into the
 * bundle at BUILD time, so both the Build step and the Start step carry it.
 *
 * The value is the site's own canonical origin, not a made-up CI host: the same variable feeds SITE_ORIGIN (sitemap, canonical and Open Graph URLs, src/lib/seo/site.ts), and several e2e specs
 * assert `https://www.talentrah.com` in those. Any other value would change them; this one leaves them byte-identical.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolveInviteOrigin } from "@/lib/auth/invite-origin";

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Job = { steps?: Step[] };
const jobs = (parse(readFileSync(".github/workflows/ci.yml", "utf8")) as { jobs: Record<string, Job> }).jobs;
const shard = jobs["e2e-shard"];
const step = (name: string) => shard.steps!.find((s) => s.name === name);
const siteUrl = (name: string) => step(name)?.env?.NEXT_PUBLIC_SITE_URL;

describe("the e2e-shard job (the one that runs the operator-invite spec)", () => {
  it("POSITIVE CONTROL: it exists and has the Build and Start steps this reads", () => {
    expect(shard).toBeDefined();
    expect(step("Build app")?.run).toBe("npm run build");
    expect(step("Start app")?.run).toBe("npm run start &");
  });

  for (const name of ["Build app", "Start app"]) {
    it(`${name} sets a NEXT_PUBLIC_SITE_URL that the production invite accepts (https, not localhost)`, () => {
      const value = siteUrl(name);
      expect(value, `${name} has no NEXT_PUBLIC_SITE_URL`).toBeTruthy();
      expect(value!.startsWith("https://"), `${name}: ${value} is not https`).toBe(true);
      expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: value }).ok, `${name}: ${value} is refused by the production invite`).toBe(true);
    });
  }

  it("the Build and Start steps carry the same value (a build and a server that disagree would not be testing one app)", () => {
    expect(siteUrl("Start app")).toBe(siteUrl("Build app"));
  });

  it("the value is the canonical origin the SEO code already falls back to, so no sitemap, canonical or Open Graph URL changes", () => {
    const fallback = /const FALLBACK_ORIGIN = "([^"]+)";/.exec(readFileSync("src/lib/seo/site.ts", "utf8"))?.[1];
    expect(fallback).toBe("https://www.talentrah.com");
    expect(siteUrl("Build app")).toBe(fallback);
  });
});

describe("only the e2e-shard job sets it", () => {
  it("no other job in the workflow carries NEXT_PUBLIC_SITE_URL (the unit job's build and the embed job keep what they had)", () => {
    for (const [id, job] of Object.entries(jobs)) {
      if (id === "e2e-shard") continue;
      const carries = (job.steps ?? []).some((s) => s.env && "NEXT_PUBLIC_SITE_URL" in s.env);
      expect(carries, `${id} sets NEXT_PUBLIC_SITE_URL`).toBe(false);
    }
  });
});
