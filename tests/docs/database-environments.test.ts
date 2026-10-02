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

  it("states the apply order and the rule that preview never runs ahead of production", () => {
    const text = body();
    expect(text).toMatch(/Production first/);
    expect(text).toMatch(/Nothing goes to talentrah-preview that has not already been applied to production/);
    expect(text).toMatch(/supabase\/data-fixes/);
  });

  it("is what the migrations README points at, and the stale applied-migrations table is gone", () => {
    const readme = readFileSync(path.join(ROOT, "supabase/migrations/README.md"), "utf8");
    expect(readme).toContain("docs/database-environments.md");
    expect(readme).toMatch(/production ledger.*source of truth/i);
    expect(readme, "the stale applied-migrations table is back").not.toMatch(/^\| Migration \| Status \|/m);
  });
});
