/**
 * 0221: the job_postings INSERT policy definition matches production's (#683).
 * Behaviour is checked by tests/rls/job-posting-insert-policy.test.ts (database, CI); this pins the migration file's shape with no database.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/0221_job_postings_insert_policy_definition.sql";
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const POLICY = `org members can manage their org's internal postings`;

describe("0221 shape", () => {
  it("exists", () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it("alters exactly the one policy, and only its WITH CHECK", () => {
    expect(code.match(/alter policy/gi)).toHaveLength(1);
    expect(code).toContain(`alter policy "${POLICY}" on public.job_postings`);
    expect(code).toMatch(/alter policy[\s\S]*?\bwith check \(/i);
    expect(code).not.toMatch(/\b(drop|create policy|grant|revoke|insert into|delete from|update public)\b/i);
  });

  it("contains every clause of the reviewed definition (twelve conditions)", () => {
    for (const c of [
      "source_type = 'internal'::public.job_source_type",
      "public.is_org_member(organization_id)",
      "unlisted_at is null",
      "removed_at is null",
      "removal_reason is null",
      "removed_by is null",
      "admin_review_decision is null",
      "admin_reviewed_at is null",
      "admin_reviewed_by is null",
      "banner_path is null",
      "claimed_by_organization_id is null",
      "claimed_at is null",
    ]) {
      expect(code, c).toContain(c);
    }
  });

  it("explains the cause (0114, and the production-only 0128 entry), says it is a no-op on production and that 0128 is not edited", () => {
    expect(sql).toMatch(/#683/);
    expect(sql).toMatch(/0114/);
    expect(sql).toMatch(/0128_claimable_job_postings/);
    expect(sql).toMatch(/no-op on production/i);
    expect(sql).toMatch(/0128 file is not edited/i);
  });

  it("ends with a self-check against production's expression that raises on a mismatch", () => {
    expect(code).toMatch(/v_expected/);
    expect(code).toMatch(/banner_path IS NULL/);
    expect(code).toMatch(/raise exception 'self-check/);
  });

  it("the repo's 0128 file is untouched by this change (the new migration is the fix)", () => {
    const f = readFileSync("supabase/migrations/0128_claim_your_listing.sql", "utf8");
    expect(f).not.toMatch(/banner_path/);
  });
});
