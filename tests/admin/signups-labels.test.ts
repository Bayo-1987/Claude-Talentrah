import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The two places that name the Signups list say "Signups" (ADMIN-NAV-SIGNUPS-COUNT-ABSORB-1): the list lists everyone with an account, so neither its browser-tab title nor the link to it on the /admin/people landing page says "job seekers".
 * Read as text; the pages need an admin session to render.
 */
const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const SIGNUPS_PAGE = read("src/app/admin/(protected)/people/signups/page.tsx");
const PEOPLE_PAGE = read("src/app/admin/(protected)/people/page.tsx");

describe("the Signups list is called Signups", () => {
  it("its browser-tab title is 'Signups — Talentrah admin'", () => {
    expect(SIGNUPS_PAGE).toContain('title: "Signups — Talentrah admin"');
    expect(SIGNUPS_PAGE).not.toContain("Job-seeker signups");
  });

  it("the /admin/people landing page links to it with the text 'Signups'", () => {
    expect(PEOPLE_PAGE).toMatch(/<Link href="\/admin\/people\/signups" className="underline">\s*Signups\s*<\/Link>/);
    expect(PEOPLE_PAGE).not.toContain("Job-seeker signups");
  });
});
