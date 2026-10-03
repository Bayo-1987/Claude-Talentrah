/**
 * EMP-1 / E1 — ONE definition of "who is in the Talent Directory".
 *
 * Before this change the gate (`talent_directory_opt_in = true AND talent_verification_status = 'verified'`) was copied into
 * talent_directory_search (twice, 0135 then 0147). The free preview needs the same gate; a third copy would be a third place to forget
 * an edit, and a preview that shows a candidate the paid search hides (or counts one it does not) is the failure this PR exists to
 * prevent. So the gate lives in exactly one function, talent_directory_listed_ids(), and the paid search and the preview both call it.
 *
 * This is a static check over the migration files, the way tests/rls/column-privileges.test.ts is the standing check for grants: it fails
 * the moment a later migration re-copies the predicate into either reader. The behavioural parity check (every profile state) is in
 * tests/rls/talent-directory-preview.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

/** The text of the LAST migration (in filename order) that defines the function: that is the live definition. */
function liveDefinition(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  const re = new RegExp(`create or replace function public\\.${fn}\\s*\\(`, "i");
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), "utf8");
    const m = re.exec(sql);
    if (!m) continue;
    const rest = sql.slice(m.index);
    // a plpgsql/sql body ends at the first `$$;` after its opening `$$`
    const open = rest.indexOf("$$");
    const close = rest.indexOf("$$;", open + 2);
    expect(open, `${f}: could not find the body of ${fn}`).toBeGreaterThan(-1);
    expect(close, `${f}: could not find the end of ${fn}`).toBeGreaterThan(open);
    found = { file: f, body: rest.slice(0, close + 3) };
  }
  if (!found) throw new Error(`no migration defines ${fn}`);
  return found;
}

const code = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("the Talent Directory gate has one definition", () => {
  const helper = liveDefinition("talent_directory_listed_ids");
  const search = liveDefinition("talent_directory_search");
  const preview = liveDefinition("talent_directory_preview");
  const previewFor = liveDefinition("talent_directory_preview_for");
  const count = liveDefinition("talent_directory_listed_count");

  it("the helper IS the gate: opted in AND verified, both, nothing else", () => {
    const body = code(helper.body).replace(/\s+/g, " ").toLowerCase();
    expect(body).toContain("p.talent_directory_opt_in = true");
    expect(body).toContain("p.talent_verification_status = 'verified'");
    // and nothing that would widen it: no `or` between the two conditions
    expect(body).not.toMatch(/talent_directory_opt_in = true or/);
    expect(body).not.toMatch(/ or p\.talent_verification_status/);
  });

  it("the paid search reads the gate from the helper and does not restate it", () => {
    const body = code(search.body);
    expect(body).toMatch(/talent_directory_listed_ids\s*\(\s*\)/);
    expect(body, "the paid search re-copied the opt-in predicate").not.toMatch(/talent_directory_opt_in/);
    expect(body, "the paid search re-copied the verification predicate").not.toMatch(/talent_verification_status/);
  });

  it("the preview and its derivation read the gate from the helper and do not restate it", () => {
    for (const def of [preview, previewFor, count]) {
      const body = code(def.body);
      expect(def.file).toBeTruthy();
      expect(body).toMatch(/talent_directory_listed_ids\s*\(\s*\)/);
      expect(body, "a preview function re-copied the opt-in predicate").not.toMatch(/talent_directory_opt_in/);
      expect(body, "a preview function re-copied the verification predicate").not.toMatch(/talent_verification_status/);
    }
  });

  it("the paid search kept its entitlement check and its ordering (only the predicate moved)", () => {
    const body = code(search.body).replace(/\s+/g, " ");
    expect(body).toMatch(/s\.status = 'active'/);
    expect(body).toMatch(/s\.expires_at > now\(\)/);
    expect(body).toMatch(/talent_boosted_until/);
    expect(body).toMatch(/p_candidate_id/);
  });

  it("the preview never selects a column that identifies anyone", () => {
    const body = code(preview.body + previewFor.body).toLowerCase();
    for (const col of ["first_name", "last_name", "email", "phone", "avatar", "country", "company"]) {
      expect(body, `the preview function mentions ${col}`).not.toContain(col);
    }
  });

  it("every new function is locked down: revoked from public and anon, granted narrowly", () => {
    const sql = code(
      files
        .filter((f) => /^0206_/.test(f))
        .map((f) => fs.readFileSync(path.join(DIR, f), "utf8"))
        .join("\n"),
    );
    expect(sql.length, "no 0206 migration found").toBeGreaterThan(0);
    for (const fn of [
      "talent_directory_listed_ids",
      "talent_directory_listed_count",
      "talent_directory_preview_for",
      "talent_directory_years_band",
      "talent_directory_role_family",
      "talent_directory_preview",
    ]) {
      expect(sql, `${fn} is not revoked from public/anon`).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`, "i"),
      );
    }
    // only the preview itself (new) and the paid search (re-asserted, as 0147 did) reach `authenticated`
    const grants = [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to (\w+)/gi)];
    const toAuthenticated = grants.filter((g) => g[2].toLowerCase() === "authenticated").map((g) => g[1]).sort();
    expect(toAuthenticated).toEqual(["talent_directory_preview", "talent_directory_search"]);
  });
});
