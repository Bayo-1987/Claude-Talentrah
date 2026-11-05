/**
 * 0276 against the local database (skipped where there is none, like tests/supabase/data-export-permission-enum.test.ts): the value is a label of public.admin_permission, applying the
 * file twice is a no-op, and no role holds it. The two catalog-text checks read labels as TEXT and never cast or compare the new value to the enum type (55P04).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { haveLocalDb, runSql } from "../support/local-psql";

const SHIPPED = readFileSync(join(__dirname, "../../supabase/migrations/0276_jobs_import_permission.sql"), "utf8");
const last = (out: string) => out.trim().split("\n").pop();

/** CHECK 1 (the label is present). Expected: t */
export const CHECK_LABEL_PRESENT = `select exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.admin_permission'::regtype and e.enumlabel::text = 'jobs_import') as label_present;`;
/** CHECK 2 (granted to nobody). Expected: t */
export const CHECK_GRANTED_TO_NOBODY = `select not exists (select 1 from public.admin_role_permissions p where p.permission::text = 'jobs_import') as granted_to_nobody;`;

describe.skipIf(!haveLocalDb())("0276: the permission value and the two catalog-text checks", () => {
  it("applies twice, each time inside its own transaction, without error", () => {
    for (const run of [1, 2]) {
      const r = runSql(`begin;\n${SHIPPED}\ncommit;`);
      expect(r.ok, `run ${run}: ${r.stderr}`).toBe(true);
    }
  });
  it("CHECK 1: the label is present", () => {
    expect(last(runSql(CHECK_LABEL_PRESENT).stdout)).toBe("t");
  });
  it("CHECK 2: granted to nobody", () => {
    expect(last(runSql(CHECK_GRANTED_TO_NOBODY).stdout)).toBe("t");
  });
});
