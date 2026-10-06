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

const LATEST_PASSED =
  "select tv.review_type from public.talent_verifications tv where tv.user_id = p.id and tv.status = 'verified' order by tv.decided_at desc nulls last, tv.requested_at desc limit 1";

describe("0234: the review type is READ from the candidate's latest passed review, in both functions", () => {
  it("the applicant list: the stored type of the latest passed review, and only for a verified profile", () => {
    expect(sql).toContain(`case when p.talent_verification_status = 'verified' then ( ${LATEST_PASSED} ) end`);
  });

  it("the applicant list: the review date is only shown for a verified profile", () => {
    expect(sql).toContain("case when p.talent_verification_status = 'verified' then p.talent_verified_at end");
  });

  it("the paid search: the same subquery in ITS OWN body, and it does not restate who is listed", () => {
    const start = sql.indexOf("create or replace function public.talent_directory_search");
    const body = sql.slice(sql.indexOf("$$", start), sql.indexOf("$$;", start) + 3);
    expect(body).toContain(`(${LATEST_PASSED})`);
    expect(body).not.toMatch(/talent_verification_status|talent_directory_opt_in/);
    expect(body).toContain("talent_directory_listed_ids()");
  });

  it("the type is never worked out from the score", () => {
    expect(sql).not.toMatch(/talent_verification_score is null|then 'mentor'|then 'ai'/);
  });

  it("nothing is stored: no table, column, index or write", () => {
    expect(sql).not.toMatch(/\balter table\b|\bcreate table\b|\badd column\b|\bcreate (unique )?index\b|\bupdate public\.|\binsert into\b|\bdelete from\b/);
  });
});

describe("0234 tells an employer no score and no status other than 'verified'", () => {
  const returnsOf = (fn: string) => {
    const start = sql.indexOf(`create or replace function public.${fn}`);
    const open = sql.indexOf("returns table (", start);
    return sql.slice(open, sql.indexOf(") language", open));
  };

  it("the applicant list's result has no score column and the search's result has no score column", () => {
    expect(returnsOf("employer_job_applicants")).not.toContain("talent_verification_score");
    expect(returnsOf("talent_directory_search")).not.toContain("verification_score");
    expect(returnsOf("talent_directory_search")).toContain("review_type text");
  });

  it("neither body selects the score", () => {
    for (const fn of ["employer_job_applicants", "talent_directory_search"]) {
      const start = sql.indexOf(`create or replace function public.${fn}`);
      const body = sql.slice(sql.indexOf("$$", start), sql.indexOf("$$;", start) + 3);
      expect(body, `${fn} selects the score`).not.toMatch(/talent_verification_score/);
    }
  });

  it("the applicant list's status is 'verified' or null, never the stored word", () => {
    expect(sql).toContain("case when p.talent_verification_status = 'verified' then 'verified' end,");
    expect(sql).not.toMatch(/\n\s+p\.talent_verification_status,/);
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

  it("both functions stay security definer, and both now pin an EMPTY search_path (every name in them is schema-qualified)", () => {
    expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(2);
    expect(sql).not.toContain("search_path = 'public'");
  });

  it("the search's body names every table and function with its schema, so an empty search_path cannot change what it reads", () => {
    const start = sql.indexOf("create or replace function public.talent_directory_search");
    const body = sql.slice(sql.indexOf("$$", start), sql.indexOf("$$;", start) + 3);
    const unqualified = [...body.matchAll(/\b(?:from|join)\s+(?!public\.|\()([a-z_][a-z0-9_.]*)/g)].map((m) => m[1]);
    expect(unqualified).toEqual([]);
    expect(body).toContain("auth.uid()");
    expect(body).toContain("public.talent_directory_listed_ids()");
  });

  it("the search function has a comment again (the drop removes it), saying what an employer is and is not told", () => {
    expect(sql).toMatch(/comment on function public\.talent_directory_search\(boolean, boolean, integer, integer, uuid\) is\s+'[^']*no score/);
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

  it.each(consumers)("%s does not read a score", (file) => {
    const src = code(read(file));
    expect(src).not.toMatch(/verificationScore|verification_score|talent_verification_score|reviewMethodFromScore/);
  });

  it("the applicants page passes the database's type and date through", () => {
    const src = read("src/app/employer/jobs/[id]/applicants/page.tsx");
    expect(src).toContain("resumeReviewFor(applicant.talent_verification_status, applicant.talent_review_type)");
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
    { user_id: "u2", first_name: "C", last_name: "D", country: "NG", available_for_hire: true, remote_ready: true, earliest_start_date: null, verification_score: null, verified_at: "2026-10-06T09:30:00Z", review_type: "human" },
  ];
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async () => ({ data: rows, error: null }) }) }));
  const { searchTalentDirectory } = await import("@/lib/talent-directory/queries");

  it("maps review_type to reviewType, row by row", async () => {
    const out = await searchTalentDirectory({});
    expect(out.map((c) => [c.userId, c.reviewType, c.verifiedAt])).toEqual([
      ["u1", "ai", "2026-10-05T09:30:00Z"],
      ["u2", "human", "2026-10-06T09:30:00Z"],
    ]);
  });
});
