/**
 * The words the Paystack check may record (src/lib/billing/reconcile.ts) and the closed list migration 0247's CHECK allows must be the same list. A word added in one place only would either be
 * refused by the database at run time (the finding lost) or sit unused in the migration. Reads the migration file; no database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECONCILE_RESULTS } from "@/lib/billing/reconcile";

const sql = readFileSync(join(__dirname, "../../supabase/migrations/0247_payment_reconcile_columns.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

describe("reconcile result words", () => {
  it("are exactly the migration's CHECK list", () => {
    const m = /reconcile_result in \(([^)]*)\)/i.exec(sql);
    expect(m, "no closed list in 0247").not.toBeNull();
    const words = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(words).toEqual([...RECONCILE_RESULTS].sort());
  });
});
