/**
 * send-501 — five public-copy claims that stopped being true when /jobs and /scholarships became
 * public landing pages (send-484, send-480), or that were never true where they were printed.
 *
 *   P4  homepage job-board section:  "Create a free account to browse them"      — /jobs is public
 *   P5  login/signup/reset side panel: "free, no account needed to preview"      — no input on those pages
 *   P6  /ats-resume-checker:          "The ATS score above …"                    — there is no score above
 *   --  /scholarships/apply-now:      "Create a free account to browse the full scholarship catalog" — public
 *   --  mentorship landing:           "Create a free account to browse approved mentors" — CORRECT, pinned as such
 *
 * Plus the standing guard: no public source file may claim an account is needed to browse jobs or
 * scholarships. The scanner is itself tested on a known-bad and known-good string, so an empty result
 * from it means "nothing found", not "incapable of finding".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JobBoardPreview } from "@/components/marketing/job-board-preview";
import { AuthHero } from "@/components/auth/auth-hero";
import { findGatedBrowseClaims, flattenMarkup } from "../support/gated-browse-claims";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => flattenMarkup(readFileSync(path.join(ROOT, rel), "utf8"));
const plain = (html: string) => flattenMarkup(html);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

describe("the scanner can find what it looks for (so an empty result means something)", () => {
  it("flags the exact stale sentences", () => {
    expect(
      findGatedBrowseClaims(
        "<p>Open roles from companies hiring across Nigeria. Create a free account to browse them, each one scored.</p>",
      ),
    ).toHaveLength(1);
    expect(
      findGatedBrowseClaims(
        `<p>{session ? "Browse." : "Create a free account to browse the full scholarship catalog and check your eligibility."}</p>`,
      ),
    ).toHaveLength(1);
    // line-wrapped in JSX, the way the real files are written
    expect(findGatedBrowseClaims("<p>Create a\n   free account to browse\n   all open jobs.</p>")).toHaveLength(1);
  });

  it("leaves true claims alone", () => {
    expect(findGatedBrowseClaims("<p>Browse them without an account; create a free account to have each one scored.</p>")).toEqual([]);
    expect(findGatedBrowseClaims("<p>Create a free account to browse approved mentors, see their real availability, and book.</p>")).toEqual([]);
    expect(findGatedBrowseClaims("<p>Create a free account to have Farah check your eligibility for a programme.</p>")).toEqual([]);
    // the personal part genuinely needs an account — this is what the copy should say
    expect(findGatedBrowseClaims("<p>Open roles from other job boards. Create a free account to see how well each matches your resume.</p>")).toEqual([]);
    expect(findGatedBrowseClaims("<h2>Create a free account to see your match score</h2><p>A free account scores every remote role against your resume.</p>")).toEqual([]);
  });
});

describe("no public page says an account is needed to browse jobs or scholarships", () => {
  it("across every component and page under src/", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(path.join(ROOT, "src/app")), ...sourceFiles(path.join(ROOT, "src/components"))]) {
      for (const hit of findGatedBrowseClaims(readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(ROOT, file)}: "${hit}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("P4 — the homepage job-board section", () => {
  const text = plain(renderToStaticMarkup(<JobBoardPreview />));

  it("says the roles can be browsed without an account, and what the account is for", () => {
    expect(text).toContain(
      "Browse them without an account; create a free account to have each one scored against your own resume.",
    );
    expect(text).not.toContain("account to browse");
  });

  it("still links to the public /jobs page", () => {
    expect(renderToStaticMarkup(<JobBoardPreview />)).toMatch(/href="\/jobs"/);
  });
});

describe("P5 — the login/signup/reset side panel", () => {
  const text = plain(renderToStaticMarkup(<AuthHero />));

  it("does not promise a no-account preview on pages that have no input", () => {
    expect(text).not.toMatch(/no account needed/i);
    expect(text).not.toMatch(/to preview/i);
  });

  it("describes what Farah does, without a free/no-account claim", () => {
    expect(text).toContain(
      "Paste a job link or description and Farah scores the match, shows what's missing, and drafts a tailored resume.",
    );
  });
});

describe("P6 — /ats-resume-checker", () => {
  const text = read("src/app/ats-resume-checker/page.tsx");

  it("does not point at a score above that is not on the page", () => {
    expect(text).not.toContain("The ATS score above");
  });

  it("says the score is one step in the tailoring flow", () => {
    expect(text).toContain("The ATS score is one step inside Talentrah's full AI resume tailoring flow.");
  });
});

describe("/scholarships/apply-now — the eligibility card", () => {
  const text = read("src/app/(app)/scholarships/apply-now/page.tsx");

  it("signed out: the catalog is open, the eligibility check is what needs an account", () => {
    expect(text).toContain(
      "Browse the full scholarship catalog without an account. Create a free account when you want Farah to check your eligibility for a specific programme.",
    );
    expect(text).not.toContain("account to browse");
  });

  it("signed out: offers the public catalog as a link, not only the signup", () => {
    // raw source, not flattened: the href lives inside a tag
    const raw = readFileSync(path.join(ROOT, "src/app/(app)/scholarships/apply-now/page.tsx"), "utf8");
    expect(raw).toContain('<Link href="/scholarships"');
    expect(raw).toContain("Browse scholarships");
    expect(raw).toContain("Create a free account");
  });

  it("signed in: unchanged", () => {
    expect(text).toContain(
      "Browse the full scholarship catalog and let Farah check your eligibility for a specific programme.",
    );
  });
});

describe("the mentorship landing — correct as written, pinned so it stays honest", () => {
  it("still says an account is needed to browse mentors, because the mentor list really is gated", () => {
    expect(read("src/components/mentorship/public-landing.tsx")).toContain(
      "Create a free account to browse approved mentors",
    );
  });
});
