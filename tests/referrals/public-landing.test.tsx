/**
 * Refer & Earn (send-515) — ReferPublicLanding, the signed-out visitor's entry point at `/refer` (the pattern #607 set for /jobs and
 * /tracker). Static: no props, no database, and above all NO leaderboard call: 0211 revokes anon's EXECUTE on referral_leaderboard, so a
 * signed-out page that called it would error. Every number comes from the reward constants and CREDIT_COSTS; there are no invented
 * statistics, testimonials or user counts.
 *
 * The component does not exist when this file is first committed, so it is loaded at runtime (loadModule).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";

interface Landing {
  ReferPublicLanding: () => React.ReactElement;
}
async function render() {
  const { ReferPublicLanding } = await loadModule<Landing>("@/components/referrals/refer-public-landing");
  return renderToStaticMarkup(<ReferPublicLanding />);
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("structure", () => {
  it("has exactly one <h1>, a 'Refer & Earn' eyebrow, and never says 'Nigeria'", async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain("Refer &amp; Earn");
    expect(html).not.toMatch(/nigeria/i);
  });

  it("explains it in three steps", async () => {
    const html = await render();
    expect(html).toContain("Share your link");
    expect(html).toContain("They create an account");
    expect(html).toContain("You are paid when they activate");
  });

  it("states the reward from the constants, when it pays (activation, in plain words), the cap, and that referring yourself does not count", async () => {
    const t = text(await render());
    expect(t).toContain("50 credits, enough for 2 resume tailorings");
    expect(t).toContain("saved a resume");
    expect(t).toContain("applied to a job");
    expect(t).toContain("Up to 10 rewarded referrals in any 30 days.");
    expect(t).toMatch(/Referring yourself/);
  });

  it("does not say that a signup pays", async () => {
    const t = text(await render());
    expect(t).not.toMatch(/signs? up.{0,40}(earn|get|receive).{0,20}credit/i);
  });

  it("the call to action is 'Create a free account to get your link', through signup, returning to /refer", async () => {
    const html = await render();
    expect(html).toContain('href="/signup?redirectTo=%2Frefer"');
    expect(html).toContain("Create a free account to get your link");
    // Visible text uses the house term, never "sign up"/"sign in" as copy (the hrefs legitimately contain /signup).
    expect(text(html)).not.toMatch(/\bsign(ing)? ?up\b/i);
    expect(text(html)).not.toMatch(/\bsign(ing)? ?in\b/i);
  });

  it("scopes what is free: reading needs no account, the link and the reward do", async () => {
    expect(text(await render())).toMatch(/needs no account/i);
  });
});

describe("it never reaches for what a signed-out visitor cannot have", () => {
  it("links to no gated path (every href passes the seeker gate)", async () => {
    const html = await render();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(1);
    for (const h of hrefs) {
      const pathname = new URL(h, "http://site.test").pathname;
      expect(isProtectedSeekerPath(pathname), `${h} is gated`).toBe(false);
    }
    // control: the gate does gate
    expect(isProtectedSeekerPath("/billing")).toBe(true);
  });

  it("makes no leaderboard call and shows none (anon cannot execute referral_leaderboard after 0211)", () => {
    // Comments may explain WHY there is none; the code must not mention it.
    const src = readFileSync(path.join(process.cwd(), "src/components/referrals/refer-public-landing.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/leaderboard/i);
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/createClient|supabase/i);
  });

  it("invents no statistic, testimonial or user count", async () => {
    const t = text(await render());
    expect(t).not.toMatch(/\b\d[\d,]*\+?\s+(users|members|people|friends|referrals have|jobseekers|job seekers)\b/i);
    expect(t).not.toMatch(/testimonial|\bsaid\b|\bsays\b|“|”/i);
  });
});
