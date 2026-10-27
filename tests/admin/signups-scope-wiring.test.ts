import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE scope for "who counts as a signup" (ADMIN-NAV-SIGNUPS-COUNT-1). The list, the new-since counter, the nav's total and the nav's employer count must all be written through `signupsScope`, so the nav can never show a
 * number the page would not (a second copy of the query is how a QA account gets counted in one place and not the other). This reads src/lib/admin/people/queries.ts as text, because that is where the sharing is decided;
 * tests/admin/signups-nav-counts.test.ts is the behavioural half (same answer on the same data).
 */
const SRC = readFileSync(join(__dirname, "../../src/lib/admin/people/queries.ts"), "utf8");

/** The text of one exported async function, from its signature to the next top-level `export` (or the end). */
function body(name: string): string {
  const start = SRC.indexOf(`export async function ${name}(`);
  expect(start, `${name} is not exported from queries.ts`).toBeGreaterThanOrEqual(0);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n(?:export |\/\*\*)/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("every signup read goes through signupsScope", () => {
  it("signupsScope is defined once, and it applies the QA exclusion", () => {
    expect(SRC.match(/export function signupsScope\(/g) ?? []).toHaveLength(1);
    const scope = SRC.slice(SRC.indexOf("export function signupsScope("));
    expect(scope.slice(0, scope.indexOf("\n}\n"))).toContain("excludeQaAccounts(");
  });

  it.each(["listSignups", "countSignupsSince", "countSignups", "countSignupEmployers"])("%s reads profiles only through signupsScope (no query of its own)", (fn) => {
    const text = body(fn);
    expect(text).toContain("signupsScope(");
    expect(text, `${fn} builds its own profiles query`).not.toMatch(/\.from\("profiles"\)/);
    expect(text, `${fn} applies the exclusion itself instead of through the shared scope`).not.toContain("excludeQaAccounts(");
  });

  it("the two nav counts are head-only counts: they fetch no row", () => {
    for (const fn of ["countSignups", "countSignupEmployers"]) {
      const text = body(fn);
      expect(text, fn).toMatch(/count: "exact", head: true/);
      expect(text, fn).not.toMatch(/\.order\(|\.range\(|\.limit\(/);
    }
  });

  it("employers are counted from the PROFILES side (people, once each), never from organisations or memberships", () => {
    const text = body("countSignupEmployers");
    expect(text).toContain("organization_members!inner(");
    expect(text).not.toMatch(/from\("organizations"\)|from\("organization_members"\)/);
  });
});
