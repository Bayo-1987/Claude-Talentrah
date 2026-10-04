/**
 * #683 — migration 0213: four trigger-only functions lose anon/authenticated EXECUTE on databases built from the repo.
 * Production already lacks those grants (early ledger entries 0013, 0016, 0017, which predate the repo), so there it is a no-op; preview and CI, which start
 * from the baseline, have them. This pins the file's shape with no database; tests/rls/trigger-function-grants.test.ts proves the behaviour.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/0213_trigger_function_grants.sql";
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const FUNCTIONS = ["apply_credit_ledger_entry", "log_application_stage_change", "trigger_check_activation_from_applications", "trigger_check_activation_from_resumes"];

describe("0213 shape", () => {
  it("exists", () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it.each(FUNCTIONS)("revokes execute on %s() from public, anon and authenticated", (fn) => {
    expect(code).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated;`));
  });

  it("revokes from exactly those four and does nothing else: no grant, no drop, no table or data change", () => {
    expect(code.match(/revoke execute on function/g)).toHaveLength(4);
    expect(code).not.toMatch(/\b(grant|drop|insert|update|delete|truncate|alter)\b\s/i);
  });

  it("explains the cause and says it is a no-op on production", () => {
    expect(sql).toMatch(/#683/);
    expect(sql).toMatch(/no-op on production/i);
    expect(sql).toMatch(/0013/);
  });

  it("ends with a self-check that fails unless no client role can execute and service_role still can", () => {
    expect(code).toMatch(/has_function_privilege\('anon'/);
    expect(code).toMatch(/has_function_privilege\('authenticated'/);
    expect(code).toMatch(/has_function_privilege\('service_role'/);
    expect(code).toMatch(/raise exception/);
  });

  it("every function it names exists in the baseline (a typo would make a repo-built database fail to build)", () => {
    const baseline = readFileSync("supabase/migrations/0000_baseline_schema.sql", "utf8");
    for (const fn of FUNCTIONS) expect(baseline).toContain(`function public.${fn}()`);
  });
});
