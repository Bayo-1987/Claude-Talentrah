/**
 * docs/database-environments.md is where the database rules live (the three environments, who reserves a migration
 * number, the apply order, data fixes, preview's known history). It exists so no session works without them again, so a
 * test fails if it is deleted, loses its reserved-number list, or stops naming the environments by their real identities.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HOSTED_CI_REF, PRODUCTION_REF } from "../../scripts/db-target";

// DOCS_ROOT points the test at another checkout (used to show it red against the tree before this file existed).
// DOCS_ROOT must never be set in CI: there the test always reads the checkout it runs in.
if (process.env.CI && process.env.DOCS_ROOT) throw new Error("DOCS_ROOT is set in CI. Unset it: this test must read the real checkout there.");
const ROOT = process.env.DOCS_ROOT ?? process.cwd();
const FILE = path.join(ROOT, "docs/database-environments.md");
const body = () => readFileSync(FILE, "utf8");

describe("docs/database-environments.md", () => {
  it("exists", () => {
    expect(existsSync(FILE), "docs/database-environments.md was deleted").toBe(true);
  });

  it("names the three environments, with the real project refs (not a stale copy)", () => {
    const text = body();
    expect(text).toContain(PRODUCTION_REF);
    expect(text).toContain(HOSTED_CI_REF);
    expect(text).toMatch(/talentrah-preview/);
    expect(text).toMatch(/fresh local Supabase/i);
  });

  it("carries the reserved migration numbers, with the rule that the owner reserves them", () => {
    const text = body();
    expect(text).toMatch(/^## 2\. Reserved migration numbers/m);
    expect(text).toMatch(/reserved by asking the owner first/i);
    const rows = text.match(/^\| 0\d{3}[^|]*\|(?:[^|]+\|){2,}$/gm) ?? [];
    expect(rows.length, "the reserved-number table has no rows").toBeGreaterThan(0);
  });

  // Section 3 is the order a migration takes: preview before production, one chain, each script approved by its full sha256.
  // The heading and the table are pinned so the order cannot be reworded back to "production first" without a red test.
  const section3 = () => {
    const text = body();
    const start = text.search(/^## 3\. The order for a migration$/m);
    expect(start, "the heading '## 3. The order for a migration' is missing or reworded").toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 1);
    const end = rest.search(/^## /m);
    return rest.slice(0, end === -1 ? undefined : end);
  };

  it("section 3 states the order: talentrah-preview before production, in a table of five steps", () => {
    const s = section3();
    expect(s).toMatch(/preview before production/i);
    expect(s).toContain("| Step | Where | What runs | Gate | Recorded |");
    const rows = s.match(/^\| [1-5] \| [^|]+\|/gm) ?? [];
    expect(rows.map((r) => r.replace(/\s+/g, " ").trim())).toEqual([
      "| 1 | talentrah-preview |",
      "| 2 | talentrah-preview |",
      "| 3 | production |",
      "| 4 | production |",
      "| 5 | merge |",
    ]);
  });

  it("section 3 keeps the safety rules: preview never ahead of an unapproved production apply, one hash, recorded with timestamp and sha256", () => {
    const s = section3();
    expect(s).toMatch(/never ahead of production for a migration whose production apply is not yet approved/);
    expect(s).toMatch(/Branch-only or experimental changes never go there/);
    expect(s).toMatch(/same sha256/i);
    expect(s).toMatch(/recorded with timestamp and sha256/);
    expect(s).toMatch(/approvals\/log\.md/);
    expect(s).toMatch(/Additive migrations go to production before the merge and destructive ones after the deploy/);
    // The old rule must not come back.
    expect(body()).not.toMatch(/Production first/);
    expect(body()).not.toMatch(/talentrah-preview never runs ahead of production/);
  });

  it("is still the home of the data-fix rule", () => {
    expect(body()).toMatch(/supabase\/data-fixes/);
  });

  it("is what the migrations README points at, and the stale applied-migrations table is gone", () => {
    const readme = readFileSync(path.join(ROOT, "supabase/migrations/README.md"), "utf8");
    expect(readme).toContain("docs/database-environments.md");
    expect(readme).toMatch(/production ledger.*source of truth/i);
    expect(readme, "the stale applied-migrations table is back").not.toMatch(/^\| Migration \| Status \|/m);
  });
  it("records where rollbacks live, and that nothing reading migrations may see them", () => {
    const text = body();
    expect(text).toMatch(/^## 4a\. Rollbacks live in `supabase\/rollbacks\/`/m);
    expect(text).toMatch(/not a migration/i);
    expect(text).toMatch(/tests\/scripts\/rollbacks-directory\.test\.ts/);
  });
});
