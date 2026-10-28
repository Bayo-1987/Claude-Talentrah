/**
 * Migration 0268 (the Promoted strip) and its rollback: their SHAPE, read from the files (no database). The behaviour is in tests/talent-directory/promoted-strip.test.ts (a real database) and the rollback's catalogue
 * equality is in tests/supabase/migration-0268-rollback-catalog.test.ts. This pins what those would only notice after somebody was hurt: two functions and nothing else, a search that reads the boost nowhere, the
 * listing gate still written only in talent_directory_listed_ids, the marks table named as a hard dependency, narrow grants, and a rollback that gives back the 0234 text of the search.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const MIGRATION = "supabase/migrations/0268_talent_directory_promoted_strip.sql";
const ROLLBACK = "supabase/rollbacks/0268_talent_directory_promoted_strip.rollback.sql";
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flatten = (t: string) => strip(t).replace(/\s+/g, " ").toLowerCase();
const raw = read(MIGRATION);
const flat = flatten(raw);
const rollRaw = read(ROLLBACK);
const roll = flatten(rollRaw);
const SEARCH_SIG = "public.talent_directory_search(boolean, boolean, integer, integer, uuid)";
const HELPER_SIG = "public.talent_directory_promoted_ids(bigint, boolean, boolean, uuid[], integer)";

/** The body of a function by name in a file's text, from its create statement to the closing `$$;`. */
const fnText = (sql: string, name: string) => {
  const i = sql.indexOf(`create or replace function public.${name}(`);
  if (i < 0) return "";
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)) + 3);
};
const searchBody = flatten(fnText(raw, "talent_directory_search"));

describe("0268: the files", () => {
  it("exist under the registered number, no other file carries it, and 0266 and 0267 are not touched by this branch's names", () => {
    expect(existsSync(join(ROOT, MIGRATION))).toBe(true);
    expect(existsSync(join(ROOT, ROLLBACK))).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
    expect(readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.startsWith("0268_"))).toEqual(["0268_talent_directory_promoted_strip.sql"]);
    expect(readdirSync(join(ROOT, "supabase/rollbacks")).filter((f) => f.startsWith("0268_"))).toEqual(["0268_talent_directory_promoted_strip.rollback.sql"]);
  });
});

describe("0268: two functions, nothing else", () => {
  it("creates exactly the helper and the search, and drops only the old search (the result gains a column)", () => {
    expect(flat.match(/create or replace function public\.[a-z_]+/g)).toEqual(["create or replace function public.talent_directory_promoted_ids", "create or replace function public.talent_directory_search"]);
    expect(flat.match(/\bdrop\b/g)).toHaveLength(1);
    expect(flat).toContain(`drop function if exists ${SEARCH_SIG};`);
  });

  it("adds no table, column, view, index, policy, trigger, type or extension, and writes no data", () => {
    expect(flat.length, "the migration file is empty or missing").toBeGreaterThan(0);
    expect(flat).not.toMatch(/\bcreate (table|view|materialized view|index|unique index|policy|trigger|type|extension|schema|sequence)\b/);
    expect(flat).not.toMatch(/\balter (table|policy|type|default privileges)\b/);
    expect(flat).not.toMatch(/\b(insert into|update public|delete from|truncate)\b/);
  });

  it("redefines none of the other directory functions", () => {
    expect(flat.length).toBeGreaterThan(0);
    for (const name of ["talent_directory_listed_ids", "talent_directory_listed_count", "talent_directory_preview", "talent_directory_preview_for", "employer_job_applicants", "employer_visible_marks", "applicant_visible_marks", "award_verification_mark", "resolve_talent_verification", "release_stale_verification_claims"]) {
      expect(flat, name).not.toContain(`function public.${name}(`);
    }
  });
});

describe("0268: the strip helper", () => {
  const helper = flatten(fnText(raw, "talent_directory_promoted_ids"));
  it("has the documented signature, is SECURITY DEFINER with an empty search_path, and reads the gate from the listing function", () => {
    expect(helper).toContain("create or replace function public.talent_directory_promoted_ids( p_bucket bigint, p_remote_ready boolean default null, p_available_for_hire boolean default null, p_only_ids uuid[] default null, p_cap integer default 3 ) returns table (id uuid, pos integer)");
    expect(helper).toContain("security definer set search_path = ''");
    expect(helper).toContain("talent_directory_listed_ids()");
    expect(helper).not.toMatch(/talent_directory_opt_in|talent_verification_status/);
  });
  it("only boosted candidates, a boost that has not expired, and a cap that can never exceed three", () => {
    expect(helper).toContain("p.talent_boosted_until is not null and p.talent_boosted_until > now()");
    expect(helper).toContain("least(greatest(coalesce(p_cap, 3), 0), 3)");
  });
  it("rotates by an md5 of the id and the bucket, tie-broken by id, so the order is fixed inside a bucket", () => {
    expect(helper).toMatch(/order by pg_catalog\.md5\(p\.id::text \|\| ':' \|\| p_bucket::text\), p\.id/);
  });
  it("is executable by service_role alone", () => {
    expect(flat).toContain(`revoke all on function ${HELPER_SIG} from public, anon, authenticated;`);
    expect(flat).toContain(`grant execute on function ${HELPER_SIG} to service_role;`);
  });
});

describe("0268: the search", () => {
  it("returns the 0234 columns plus section, with the same arguments, SECURITY DEFINER and the empty search_path", () => {
    expect(searchBody).toContain("p_remote_ready boolean default null, p_available_for_hire boolean default null, p_limit integer default 20, p_offset integer default 0, p_candidate_id uuid default null");
    expect(searchBody).toContain("verified_at timestamp with time zone, review_type text, section text");
    expect(searchBody).toContain("security definer set search_path = ''");
  });
  it("reads the boost nowhere: the strip comes from the helper and no ORDER BY, WHERE or select mentions the boost", () => {
    expect(searchBody).toContain("talent_directory_promoted_ids(");
    expect(searchBody).not.toContain("talent_boosted_until");
    expect(searchBody).not.toMatch(/boost/);
  });
  it("orders the organic list by the newest live earned mark date from verification_marks, falling back to the profile's review date", () => {
    expect(searchBody).toContain("public.verification_marks");
    expect(searchBody).toContain("public.verification_mark_is_live(");
    expect(searchBody).toMatch(/coalesce\(\s*\(?select max\(m\.earned_at\)/);
    expect(searchBody).toContain("p.talent_verified_at");
  });
  it("keeps the entitlement check and leaves the listing gate where it was written (talent_directory_listed_ids), restating none of it", () => {
    expect(searchBody).toContain("s.status = 'active'");
    expect(searchBody).toContain("s.expires_at > now()");
    expect(searchBody).toContain("talent_directory_listed_ids()");
    expect(searchBody).not.toMatch(/talent_directory_opt_in|talent_verification_status/);
    expect(searchBody).toContain("p_candidate_id");
  });
  it("keeps its grants: revoked from PUBLIC and anon, executable by authenticated and service_role only", () => {
    expect(flat).toContain(`revoke all on function ${SEARCH_SIG} from public, anon;`);
    expect(flat).toContain(`grant execute on function ${SEARCH_SIG} to authenticated, service_role;`);
    expect(flat.match(/\bgrant\b/g)).toHaveLength(2);
  });
  it("refuses to apply without the marks table and its liveness function (a plpgsql body is not checked when it is created)", () => {
    expect(flat).toContain("to_regclass('public.verification_marks') is null");
    expect(flat).toContain("to_regprocedure('public.verification_mark_is_live(timestamptz, timestamptz)') is null");
    expect(flat).toContain("0268 needs 0266");
  });
  it("checks its own privileges and settings when it is applied", () => {
    for (const piece of ["0268 self-check:", "has_function_privilege", "aclexplode", "is not security definer", "does not have an empty search_path"]) expect(flat, piece).toContain(piece);
  });
});

describe("0268: the rollback", () => {
  it("drops the new search and the helper and gives the 0234 search back, text for text", () => {
    expect(roll).toContain(`drop function if exists ${SEARCH_SIG};`);
    expect(roll).toContain(`drop function ${HELPER_SIG};`);
    const restored = flatten(fnText(rollRaw, "talent_directory_search"));
    const original = flatten(fnText(read("supabase/migrations/0234_review_date_and_type_on_applicants_and_search.sql"), "talent_directory_search"));
    expect(restored.length).toBeGreaterThan(900);
    expect(restored).toBe(original);
    expect(restored).toContain("talent_boosted_until");
    expect(restored).not.toContain("section");
  });
  it("restores the grants and the comment of 0234, and no other object is touched", () => {
    expect(roll).toContain(`revoke all on function ${SEARCH_SIG} from public, anon;`);
    expect(roll).toContain(`grant execute on function ${SEARCH_SIG} to authenticated, service_role;`);
    const comment234 = flatten(read("supabase/migrations/0234_review_date_and_type_on_applicants_and_search.sql"));
    const commentOf = (t: string) => t.slice(t.indexOf(`comment on function ${SEARCH_SIG} is`), t.indexOf(";", t.indexOf(`comment on function ${SEARCH_SIG} is`)) + 1);
    expect(commentOf(roll)).toBe(commentOf(comment234));
    expect((roll.match(/\bdrop\b/g) ?? []).length).toBe(2);
    expect(roll).not.toMatch(/\bcascade\b|\bdrop table\b|\balter\b|\bdelete\b|\bupdate public\b|\btruncate\b/);
  });
  it("is one transaction and says the code that reads section is rolled back first", () => {
    expect(roll).toMatch(/^\s*begin;/);
    expect(roll).toMatch(/commit;\s*$/);
    expect(rollRaw.toLowerCase()).toContain("must be rolled back first");
  });
});
