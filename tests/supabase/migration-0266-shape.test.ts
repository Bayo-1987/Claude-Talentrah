/**
 * Migration 0266 (the marks foundation): its SHAPE, read from the files (no database). The behaviour is in tests/rls/verification-marks.test.ts (CI) and was proven with ten mutants on a copy of the real schema.
 * This file pins what a behavioural test would only notice after somebody was hurt: no score-like column, one writer, the employer reads state their gates themselves, the grants are by column, and the rollback refuses to
 * drop a later mark type.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0266_verification_marks.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0266_verification_marks.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const code = strip(raw);
const flat = code.replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

describe("0266: the files", () => {
  it("exist under the registered number", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
  });
});

describe("0266: the table", () => {
  const table = flat.slice(flat.indexOf("create table public.verification_marks"), flat.indexOf("create index verification_marks_user_idx"));
  it("has no column that can hold a score", () => {
    expect(table.length).toBeGreaterThan(200);
    expect(table).not.toMatch(/\b(score|percent|pct|rating|points|grade)\w*\s+(integer|int|numeric|real|double|smallint|bigint|text)/);
  });
  it("fixes expiry to earned_at + 12 months in a CHECK, in UTC", () => {
    expect(table).toContain("verification_marks_expiry_is_12_months");
    expect(table).toMatch(/expires_at = \(\(earned_at at time zone 'utc'\) \+ interval '12 months'\) at time zone 'utc'/);
  });
  it("lists exactly the five mark types and the two levels", () => {
    expect(table).toContain("'resume_reviewed', 'skills_check', 'reference_confirmed', 'mentor_interview', 'communication_check'");
    expect(table).toContain("level in ('strong', 'passed')");
  });
  it("closes the table by column: RLS on, one owner-select policy, no table-level select for authenticated, no client write, and the hash is not in the grant", () => {
    expect(flat).toContain("alter table public.verification_marks enable row level security");
    expect((flat.match(/create policy/g) ?? []).length).toBe(1);
    expect(flat).toContain("revoke all on table public.verification_marks from public, anon, authenticated, service_role");
    expect(flat).toContain("grant select (id, user_id, mark_type, field, level, review_type, earned_at, expires_at) on public.verification_marks to authenticated");
    expect(flat).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on (table )?public\.verification_marks to (public|anon|authenticated)/);
    expect(flat).not.toMatch(/grant select on (table )?public\.verification_marks to authenticated/);
  });
});

describe("0266: the functions", () => {
  it("has ONE writer, executable by service_role only, and resolve_talent_verification calls it only when the review passed", () => {
    expect(flat).toMatch(/grant execute on function public\.award_verification_mark\([^)]*\) to service_role;/);
    expect(flat).not.toMatch(/grant execute on function public\.award_verification_mark\([^)]*\) to [a-z_, ]*(authenticated|anon|public)/);
    expect(flat).toMatch(/if p_verified then perform public\.award_verification_mark\(/);
  });
  it("both reads are SECURITY DEFINER with an empty search_path, executable by authenticated, never by anon or PUBLIC", () => {
    for (const fn of ["employer_visible_marks(uuid[])", "applicant_visible_marks(uuid)"]) {
      const sig = fn.replace(/[()[\]]/g, "\\$&");
      expect(flat).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon;`));
      expect(flat).toMatch(new RegExp(`grant execute on function public\\.${sig} to authenticated, service_role;`));
    }
    const bodies = flat.slice(flat.indexOf("create or replace function public.employer_visible_marks"), flat.indexOf("-- ── privileges") > 0 ? flat.indexOf("revoke all on function public.verification_mark_is_live") : undefined);
    expect((bodies.match(/security definer/g) ?? []).length).toBe(2);
    expect((bodies.match(/set search_path = ''/g) ?? []).length).toBe(2);
  });
  it("the directory read states its own gates: subscription, listing gate, liveness; the applicants read: membership, an application, no QA, no deletion-requested, the verified-status gate, liveness", () => {
    const directory = flat.slice(flat.indexOf("create or replace function public.employer_visible_marks"), flat.indexOf("create or replace function public.applicant_visible_marks"));
    for (const needle of ["s.status = 'active' and s.expires_at > pg_catalog.now()", "talent_directory_listed_ids()", "verification_mark_is_live(m.expires_at, pg_catalog.now())", "cardinality(p_candidate_ids) > 100"]) expect(directory).toContain(needle);
    const applicants = flat.slice(flat.indexOf("create or replace function public.applicant_visible_marks"), flat.indexOf("-- ── privileges") > 0 ? flat.indexOf("revoke all on function public.verification_mark_is_live") : undefined);
    for (const needle of ["public.is_org_member(j.organization_id)", "a.applied_at is not null", "p.deletion_requested_at is null", "not public.is_qa_account(", "m.mark_type <> 'resume_reviewed' or p.talent_verification_status = 'verified'", "verification_mark_is_live(m.expires_at, pg_catalog.now())"]) expect(applicants).toContain(needle);
    expect(directory).not.toMatch(/resume_hash\s+as\s|, m\.resume_hash,|, m\.source_id|, m\.detail/);
    // the applicants read is keyed by application and returns no user id: its return table, its select list and its ordering name none
    const head = applicants.slice(0, applicants.indexOf("language plpgsql"));
    expect(head).toContain("returns table ( application_id uuid,");
    expect(head).not.toMatch(/candidate_id|user_id/);
    expect(applicants).not.toMatch(/m\.user_id as|a\.user_id as|candidate_id/);
  });
  it("the liveness rule is strict: an expiry equal to the clock is NOT live", () => {
    expect(flat).toContain("select p_expires_at > p_now");
  });
});

describe("0266: the backfill and the self-check", () => {
  it("takes the date from the profile and refuses to guess a missing one", () => {
    expect(flat).toContain("p.talent_verified_at");
    expect(flat).toContain("will not guess a date");
    expect(flat).toMatch(/order by t\.decided_at desc nulls last, t\.requested_at desc/);
  });
  it("fails the migration on a score-like column, a client write grant, a readable hash, and a parity break", () => {
    for (const needle of ["has a score-like column", "holds a write or ddl privilege", "can read a column that is not in the owner grant", "does not have exactly one resume_reviewed mark", "differs from profiles.talent_verified_at"]) expect(flat).toContain(needle);
  });
});

describe("0266: the rollback", () => {
  it("refuses when a later mark type exists, restores the 0142 resolve function, and drops the functions before the table they read", () => {
    expect(rollback).toContain("mark_type <> 'resume_reviewed'");
    expect(rollback).toContain("raise exception");
    expect(rollback).not.toContain("award_verification_mark(p_user_id");
    const iFn = rollback.indexOf("drop function public.employer_visible_marks");
    const iTable = rollback.indexOf("drop table public.verification_marks");
    expect(iFn).toBeGreaterThan(-1);
    expect(iTable).toBeGreaterThan(iFn);
    expect(rollback.indexOf("create or replace function public.resolve_talent_verification")).toBeLessThan(iFn);
  });
});
