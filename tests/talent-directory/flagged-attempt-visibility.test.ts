/**
 * Where a FLAGGED verification attempt (a resume that tried to instruct the grader: rejected, score 0, fixed feedback) can and cannot be seen.
 *
 * It is recorded as a normal rejected row of the person's own verification history, and that is the ONLY place it should appear: their own verify page. Not in the directory employers search,
 * not in the anonymised preview, not on an employer's applicant list, not in a mentor's review queue, not on any public page, and not in an email. Each surface is pinned here, by the
 * cheapest test that actually fails if it changes: a pure helper for the employer applicant view (the page used to hand the raw status and score to a client component), and source and SQL
 * scans for the rest. There is no public profile page that shows verification, and no email about a verification outcome; the scans below fail the day one is added.
 *
 * What these cannot do: run the directory's SQL against a database (no database here). They read the latest definition of each function from the migrations in order.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { employerVisibleVerification } from "@/lib/talent-directory/employer-view";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${name.name}`;
    if (name.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name.name)) out.push(rel);
  }
  return out;
}

describe("an employer's applicant list: only a verified state is passed on", () => {
  it("a flagged or rejected attempt (score 0) becomes 'unverified' with no score", () => {
    expect(employerVisibleVerification("rejected", 0)).toEqual({ status: "unverified", score: null });
    expect(employerVisibleVerification("rejected", 40)).toEqual({ status: "unverified", score: null });
  });
  it("pending, claimed, unverified and anything unknown also collapse to unverified", () => {
    for (const status of ["pending", "claimed", "unverified", "", "weird"]) expect(employerVisibleVerification(status, 77)).toEqual({ status: "unverified", score: null });
  });
  it("a verified candidate keeps the score they were verified with", () => {
    expect(employerVisibleVerification("verified", 85)).toEqual({ status: "verified", score: 85 });
    expect(employerVisibleVerification("verified", null)).toEqual({ status: "verified", score: null });
  });
  it("the applicants page maps through the helper and never passes the raw status or score on", () => {
    const page = read("src/app/employer/jobs/[id]/applicants/page.tsx");
    expect(page).toContain("employerVisibleVerification(");
    expect(page).not.toMatch(/talentVerificationStatus:\s*applicant\.talent_verification_status/);
    expect(page).not.toMatch(/talentVerificationScore:\s*applicant\.talent_verification_score/);
  });
  it("the list shows the verified line only for a verified status", () => {
    const list = read("src/components/employer/applicant-list.tsx");
    expect(list).toMatch(/talentVerificationStatus === "verified"/);
  });
});

describe("the directory employers search, and its preview, list verified and opted-in candidates only", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  function latest(name: string): string {
    let body = "";
    for (const f of files) {
      const text = read(`supabase/migrations/${f}`);
      const re = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "gi");
      for (const m of text.matchAll(re)) body = m[0];
    }
    return body.replace(/\s+/g, " ").toLowerCase();
  }
  it("talent_directory_listed_ids (the one gate every reader shares) needs talent_verification_status = 'verified' and talent_directory_opt_in = true, and names no other status", () => {
    const body = latest("talent_directory_listed_ids");
    expect(body.length, "talent_directory_listed_ids not found").toBeGreaterThan(100);
    expect(body).toContain("talent_verification_status = 'verified'");
    expect(body).toContain("talent_directory_opt_in = true");
    expect(body).not.toContain("'rejected'");
    expect(body).not.toMatch(/talent_verification_status (<>|!=|in) /);
  });
  it("the paid search reads that gate (it calls talent_directory_listed_ids, not a filter of its own)", () => {
    const search = latest("talent_directory_search");
    expect(search.length, "talent_directory_search not found").toBeGreaterThan(100);
    expect(search).toContain("talent_directory_listed_ids()");
    expect(search).not.toContain("'rejected'");
  });
  it("the preview reads the same gate (it calls talent_directory_listed_ids, not its own filter)", () => {
    const preview = latest("talent_directory_preview");
    expect(preview).toContain("talent_directory_listed_ids()");
  });
});

describe("a mentor's human-review queue holds human reviews only, so an AI-graded flagged attempt never reaches it", () => {
  const sql = read("supabase/migrations/0142_talent_directory_human_review.sql").replace(/\s+/g, " ").toLowerCase();
  it("the claim and the list both filter on review_type = 'human'", () => {
    expect((sql.match(/review_type = 'human'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("nothing else reads a person's verification score or status, and nothing emails about a verification outcome", () => {
  const SRC = walk("src").filter((f) => !f.endsWith("supabase/types.ts"));
  const READ = /talent_verification_score|talent_verification_status|talent_verified_at|\bai_score\b|\bai_feedback\b/;
  const ALLOWED_READERS = new Set([
    "src/app/(app)/talent-directory/verify/page.tsx", // the person's OWN page
    "src/app/employer/jobs/[id]/applicants/page.tsx", // through employerVisibleVerification
    "src/lib/talent-directory/queries.ts",
    "src/lib/talent-directory/reviewer-runner.ts",
    "src/lib/talent-directory/verification-runner.ts",
    "src/lib/talent-directory/boost-runner.ts",
  ]);
  it("the files that mention those columns are exactly the allowed ones (a new public page or export that shows them fails here)", () => {
    const readers = SRC.filter((f) => READ.test(read(f))).sort();
    expect(readers).toEqual([...ALLOWED_READERS].sort());
  });

  it("no code that runs or reads a verification sends an email", () => {
    const MAILER = /resend|sendAdminAlert|sendEmail|\blib\/email\b|notifications\//i;
    const VERIFICATION = /runTalentVerification|gradeResumeForVerification|talent_verifications|resolve_talent_verification/;
    const offenders = SRC.filter((f) => VERIFICATION.test(read(f)) && MAILER.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("no email template or notification mentions a verification result", () => {
    const templates = SRC.filter((f) => /src\/lib\/(email|notifications)\//.test(f));
    const offenders = templates.filter((f) => /verification (failed|result|rejected)|not verified|rejected your verification/i.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
