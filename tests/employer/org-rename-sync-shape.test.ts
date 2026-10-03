/**
 * Migration 0216: an organisation rename reaches the organisation's own postings (S2-13, option a).
 *
 * THE BUG. `job_postings.company_name` is a copy of `organizations.name`, taken when an employer posts. Nothing updated it when the
 * organisation was renamed, so the public job page, the feed and the JSON-LD kept showing the old name: on production the one
 * internal posting that had been through a rename read "Talentrah Portal" under an organisation now called "Talentrah".
 *
 * WHAT THIS PINS ABOUT THE FILE (the behaviour itself is tests/employer/org-rename-sync-db.test.ts, against a real database):
 *  - one trigger, on `organizations`, AFTER UPDATE OF name, firing only when the name really changes;
 *  - the function is SECURITY DEFINER with `search_path = ''` and EXECUTE revoked from public, anon and authenticated, because it
 *    writes `job_postings` on behalf of an employer whose own policies would not be the right gate for a derived column;
 *  - it is scoped by organisation AND `source_type = 'internal'`, so an external posting is never renamed;
 *  - the migration holds no standalone UPDATE of job_postings: the one-time backfill of the row that is already wrong is a separate,
 *    owner-approved data fix (supabase/data-fixes/), never a side effect of a migration.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(__dirname, "../../supabase/migrations/0216_org_rename_syncs_internal_postings.sql");
const sql = () => readFileSync(FILE, "utf8");
const code = () => sql().replace(/--[^\n]*/g, "");

describe("0216_org_rename_syncs_internal_postings.sql", () => {
  it("exists", () => {
    expect(existsSync(FILE), "the migration file is missing").toBe(true);
  });

  it("creates exactly one trigger: after update of name on organizations, only when the name changed", () => {
    const triggers = code().match(/create trigger[\s\S]*?;/gi) ?? [];
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatch(/after update of name on public\.organizations/i);
    expect(triggers[0]).toMatch(/for each row/i);
    expect(triggers[0]).toMatch(/when\s*\(\s*old\.name is distinct from new\.name\s*\)/i);
  });

  it("is SECURITY DEFINER with an empty search_path, and nobody can call it", () => {
    expect(code()).toMatch(/security definer/i);
    expect(code()).toMatch(/set search_path\s*=\s*''/i);
    expect(code()).toMatch(/revoke all on function public\.sync_org_name_to_internal_postings\(\) from public, anon, authenticated/i);
  });

  it("only touches internal postings of the renamed organisation, and only where the name differs", () => {
    const body = code().match(/create or replace function public\.sync_org_name_to_internal_postings[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(body).toMatch(/update public\.job_postings/i);
    expect(body).toMatch(/organization_id = new\.id/i);
    expect(body).toMatch(/source_type = 'internal'/i);
    expect(body).toMatch(/company_name is distinct from new\.name/i);
  });

  it("has no UPDATE of job_postings outside that function (the backfill is a separate data fix)", () => {
    const withoutFn = code().replace(/create or replace function public\.sync_org_name_to_internal_postings[\s\S]*?\$\$;/i, "");
    expect(withoutFn).not.toMatch(/update\s+public\.job_postings/i);
  });
});
