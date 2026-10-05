/**
 * VERIFY-1 0a-2 (0234): the two employer reads answer WHEN a resume was reviewed and BY WHOM, and the screens show that without ever being handed a score.
 *
 * This is the static side (the migration's text and the code that reads it). The behaviour of the functions themselves, on every candidate state, is
 * tests/rls/talent-directory-mentor-reviewed.test.ts (it needs a database, so CI runs it); the rule they apply is proved from the code in
 * tests/talent-directory/review-method-proof.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");
const flat = (s: string) => code(s).replace(/\s+/g, " ").toLowerCase();

const MIGRATION = "supabase/migrations/0234_review_date_and_type_on_applicants_and_search.sql";
const sql = flat(read(MIGRATION));

describe("0234: the review type is derived in SQL, one rule, in both functions", () => {
  it("the applicant list: 'mentor' for a verified profile with no stored score, 'ai' for a verified one with a score, null otherwise", () => {
    expect(sql).toContain(
      "case when p.talent_verification_status = 'verified' and p.talent_verification_score is null then 'mentor' when p.talent_verification_status = 'verified' then 'ai' end",
    );
  });

  it("the applicant list: the review date is only shown for a verified profile", () => {
    expect(sql).toContain("case when p.talent_verification_status = 'verified' then p.talent_verified_at end");
  });

  it("the paid search: the same rule, from the score alone (the listing gate guarantees 'verified')", () => {
    expect(sql).toContain("case when p.talent_verification_score is null then 'mentor' else 'ai' end");
  });

  it("nothing is stored: no table, column or update", () => {
    expect(sql).not.toMatch(/\balter table\b|\bcreate table\b|\badd column\b|\bupdate public\.|\binsert into\b|\bdelete from\b/);
  });
});

describe("0234 changes nothing about who sees what", () => {
  it("the applicant list keeps its organisation-membership check, its applied-only filter, the deletion filter and no opt-in condition", () => {
    const start = sql.indexOf("create or replace function public.employer_job_applicants");
    const open = sql.indexOf("$$", start);
    const body = sql.slice(open, sql.indexOf("$$;", open + 2) + 3);
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("public.is_org_member(j.organization_id)");
    expect(body).toContain("a.applied_at is not null");
    expect(body).toContain("p.deletion_requested_at is null");
    expect(body).not.toContain("talent_directory_opt_in");
  });

  it("both functions stay security definer with their pinned search_path", () => {
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain("security definer set search_path = 'public'");
  });

  it("neither function is ever granted to anon or public, and both are granted to authenticated and service_role", () => {
    for (const fn of ["employer_job_applicants(uuid)", "talent_directory_search(boolean, boolean, integer, integer, uuid)"]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated, service_role`);
    }
    // every grant's RECIPIENTS (the words after "to"), whatever the function is called
    const recipients = [...sql.matchAll(/\bgrant [^;]*? to ([^;]*);/g)].map((m) => m[1].trim());
    expect(recipients.length).toBeGreaterThan(0);
    for (const r of recipients) expect(r).toBe("authenticated, service_role");
  });

  it("the search is recreated with `create or replace function public.talent_directory_search(` so the single-gate check keeps reading the live definition", () => {
    expect(code(read(MIGRATION))).toMatch(/create or replace function public\.talent_directory_search\s*\(/i);
  });
});

describe("the screens read the database's type and never a score", () => {
  const consumers = [
    "src/app/employer/jobs/[id]/applicants/page.tsx",
    "src/app/employer/talent-directory/page.tsx",
    "src/app/employer/talent-directory/[candidateId]/page.tsx",
    "src/components/employer/applicant-list.tsx",
  ];

  it.each(consumers)("%s does not read a score or the verification status", (file) => {
    const src = code(read(file));
    expect(src).not.toMatch(/verificationScore|verification_score|talent_verification_status|reviewMethodFromScore/);
  });

  it("the applicants page passes the database's type and date through", () => {
    const src = read("src/app/employer/jobs/[id]/applicants/page.tsx");
    expect(src).toContain("resumeReviewFor(applicant.talent_review_type)");
    expect(src).toContain("resumeReviewedAt: applicant.talent_verified_at");
  });

  it("both directory pages read the type the search answers with", () => {
    expect(read("src/app/employer/talent-directory/page.tsx")).toContain("reviewMethodFromType(c.reviewType)");
    expect(read("src/app/employer/talent-directory/[candidateId]/page.tsx")).toContain("reviewMethodFromType(candidate.reviewType)");
  });
});

describe("searchTalentDirectory carries the database's review type through to the pages", async () => {
  const { vi } = await import("vitest");
  const rows = [
    { user_id: "u1", first_name: "A", last_name: "B", country: "NG", available_for_hire: true, remote_ready: true, earliest_start_date: null, verification_score: 88, verified_at: "2026-10-05T09:30:00Z", review_type: "ai" },
    { user_id: "u2", first_name: "C", last_name: "D", country: "NG", available_for_hire: true, remote_ready: true, earliest_start_date: null, verification_score: null, verified_at: "2026-10-06T09:30:00Z", review_type: "mentor" },
  ];
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async () => ({ data: rows, error: null }) }) }));
  const { searchTalentDirectory } = await import("@/lib/talent-directory/queries");

  it("maps review_type to reviewType, row by row", async () => {
    const out = await searchTalentDirectory({});
    expect(out.map((c) => [c.userId, c.reviewType, c.verifiedAt])).toEqual([
      ["u1", "ai", "2026-10-05T09:30:00Z"],
      ["u2", "mentor", "2026-10-06T09:30:00Z"],
    ]);
  });
});
