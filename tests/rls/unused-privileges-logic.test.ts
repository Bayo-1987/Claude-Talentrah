/**
 * tests/rls/unused-privileges-logic.test.ts. No database: it feeds the rule functions snapshot rows with PLANTED grants and proves each planted grant is reported (so the database-backed tests below
 * cannot be passing because the rule is blind), and that the things the rule must NOT report are not reported.
 */
import { describe, expect, it } from "vitest";
import { anonWriteFindings, maintainFindings, serviceOnlyFunctionFindings, unusedPrivilegeFindings, type SnapshotRow } from "../support/unused-privileges";

const row = (source: string, object_name: string, grantee: string, privilege_type: string): SnapshotRow => ({ source, object_name, grantee, privilege_type });
const CLEAN: SnapshotRow[] = [
  row("table", "blog_posts", "anon", "SELECT"),
  row("table", "applications", "authenticated", "INSERT"),
  row("default", "role postgres, schema public", "authenticated", "SELECT"),
  row("function", "touch_last_active()", "authenticated", "EXECUTE"),
];

describe("unusedPrivilegeFindings: a planted grant of any of the four is reported", () => {
  it("reports nothing for a clean snapshot", () => expect(unusedPrivilegeFindings(CLEAN)).toEqual([]));
  for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
    for (const who of ["anon", "authenticated", "public"]) {
      it(`reports ${priv} held by ${who} on a table`, () => expect(unusedPrivilegeFindings([...CLEAN, row("table", "profiles", who, priv)])).toEqual([`table profiles: ${who} ${priv}`]));
    }
  }
  it("reports a column-level REFERENCES grant", () => expect(unusedPrivilegeFindings([...CLEAN, row("column", "profiles.id", "authenticated", "REFERENCES")])).toHaveLength(1));
  it("reports a default-privilege grant for the postgres role in schema public", () => expect(unusedPrivilegeFindings([...CLEAN, row("default", "role postgres, schema public", "anon", "TRUNCATE")])).toHaveLength(1));
  it("does NOT report another role's default (supabase_admin's is deliberately out of scope), nor service_role", () => {
    expect(unusedPrivilegeFindings([...CLEAN, row("default", "role supabase_admin, schema public", "anon", "TRUNCATE"), row("table", "profiles", "service_role", "TRUNCATE")])).toEqual([]);
  });
});

describe("serviceOnlyFunctionFindings", () => {
  it("reports EXECUTE on either referral function held by anon, authenticated or PUBLIC", () => {
    expect(serviceOnlyFunctionFindings([...CLEAN, row("function", "count_rewarded_referrals_last_30d(p_referrer_id uuid, p_exclude_referral_id uuid)", "anon", "EXECUTE")])).toHaveLength(1);
    expect(serviceOnlyFunctionFindings([...CLEAN, row("function", "check_and_activate_referral(p_user_id uuid)", "public", "EXECUTE")])).toHaveLength(1);
  });
  it("does not report other functions", () => expect(serviceOnlyFunctionFindings(CLEAN)).toEqual([]));
});

describe("anonWriteFindings: a planted anon write grant is reported", () => {
  it("reports nothing for a clean snapshot", () => expect(anonWriteFindings(CLEAN)).toEqual([]));
  for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
    it(`reports ${priv} held by anon, and by PUBLIC, on a table`, () => {
      expect(anonWriteFindings([...CLEAN, row("table", "feedback", "anon", priv)])).toEqual([`table feedback: anon ${priv}`]);
      expect(anonWriteFindings([...CLEAN, row("table", "feedback", "public", priv)])).toEqual([`table feedback: public ${priv}`]);
    });
  }
  it("reports a column-level grant and a postgres default grant", () => {
    expect(anonWriteFindings([...CLEAN, row("column", "profiles.first_name", "anon", "UPDATE")])).toHaveLength(1);
    expect(anonWriteFindings([...CLEAN, row("default", "role postgres, schema public", "anon", "INSERT")])).toHaveLength(1);
  });
  it("does NOT report authenticated's writes, and does not report another role's default", () => {
    expect(anonWriteFindings([...CLEAN, row("table", "applications", "authenticated", "DELETE"), row("default", "role supabase_admin, schema public", "anon", "INSERT")])).toEqual([]);
  });
});

describe("maintainFindings: a planted MAINTAIN grant is reported", () => {
  it("reports nothing for a clean snapshot", () => expect(maintainFindings(CLEAN)).toEqual([]));
  for (const who of ["anon", "authenticated", "public"]) {
    it(`reports MAINTAIN held by ${who} on a table, on a column and in the postgres default`, () => {
      expect(maintainFindings([...CLEAN, row("table", "feedback", who, "MAINTAIN")])).toEqual([`table feedback: ${who} MAINTAIN`]);
      expect(maintainFindings([...CLEAN, row("column", "profiles.id", who, "MAINTAIN")])).toHaveLength(1);
      expect(maintainFindings([...CLEAN, row("default", "role postgres, schema public", who, "MAINTAIN")])).toHaveLength(1);
    });
  }
  it("does NOT report service_role, another role's default, nor other privileges", () => {
    expect(maintainFindings([...CLEAN, row("table", "profiles", "service_role", "MAINTAIN"), row("default", "role supabase_admin, schema public", "anon", "MAINTAIN"), row("table", "profiles", "anon", "SELECT")])).toEqual([]);
  });
});
