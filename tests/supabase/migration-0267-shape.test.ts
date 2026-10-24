/**
 * Migration 0267 (the 72-hour review-claim timeout) and its rollback: their SHAPE, read from the files (no database). The behaviour is in tests/talent-directory/claim-timeout.test.ts (a real database) and the
 * rollback's catalogue equality is in tests/supabase/migration-0267-round-trip.test.ts (CI). This pins what those would only notice after somebody was hurt: ONE function and nothing else added or changed,
 * a closed list of columns it may write, no other table touched, service_role as the only caller, and a rollback that drops only that function.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const MIGRATION = join(ROOT, "supabase/migrations/0267_verification_claim_timeout.sql");
const ROLLBACK = join(ROOT, "supabase/rollbacks/0267_verification_claim_timeout.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const flat = strip(raw).replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();
const SIGNATURE = "public.release_stale_verification_claims(timestamptz, interval)";

describe("0267: the files", () => {
  it("exist under the registered number, and no other migration carries it", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
    expect(readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.startsWith("0267_"))).toEqual(["0267_verification_claim_timeout.sql"]);
    expect(readdirSync(join(ROOT, "supabase/rollbacks")).filter((f) => f.startsWith("0267_"))).toEqual(["0267_verification_claim_timeout.rollback.sql"]);
  });
});

describe("0267: adds one function and changes nothing that exists", () => {
  it("creates exactly one function, with the two defaulted parameters and an integer result", () => {
    expect(flat.match(/create (or replace )?function/g)).toHaveLength(1);
    expect(flat).toContain("create or replace function public.release_stale_verification_claims( p_now timestamptz default now(), p_older_than interval default interval '72 hours' ) returns integer");
  });

  it("adds no table, column, view, index, policy, trigger, type or extension, and drops or alters nothing", () => {
    expect(flat.length, "the migration file is empty or missing").toBeGreaterThan(0);
    expect(flat).not.toMatch(/\bcreate (table|view|materialized view|index|unique index|policy|trigger|type|extension|schema|sequence)\b/);
    expect(flat).not.toMatch(/\balter (table|function|policy|type|default privileges)\b/);
    expect(flat).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\b|\binsert\b/);
  });

  it("redefines none of the six existing functions it sits beside", () => {
    expect(flat.length, "the migration file is empty or missing").toBeGreaterThan(0);
    for (const name of ["claim_talent_verification_review", "release_talent_verification_review_claim", "resolve_talent_verification", "talent_verification_review_queue", "talent_verification_review_detail", "talent_verification_my_claims"]) {
      expect(flat, name).not.toContain(`function public.${name}`);
    }
  });
});

describe("0267: what the function may write", () => {
  it("has exactly one write: one UPDATE of public.talent_verifications that sets only status, reviewer_id and claimed_at", () => {
    expect(flat.match(/\bupdate\b/g)).toHaveLength(1);
    expect(flat).toContain("update public.talent_verifications tv set status = 'pending', reviewer_id = null, claimed_at = null where");
  });

  it("is guarded to claimed HUMAN reviews, with a strict 'older than' on the claim time and the claim-time-less case", () => {
    expect(flat).toContain("tv.status = 'claimed'");
    expect(flat).toContain("tv.review_type = 'human'");
    expect(flat).toContain("(tv.claimed_at is null or tv.claimed_at < p_now - p_older_than)");
    expect(flat).not.toMatch(/claimed_at <= /);
  });

  it("names no other table, so it cannot move a payout, a credit or a profile", () => {
    const tables = new Set([...flat.matchAll(/\b(?:from|update|into|join)\s+(public\.[a-z_]+)/g)].map((m) => m[1]));
    expect([...tables]).toEqual(["public.talent_verifications"]);
    expect(flat).not.toContain("reviewer_payout_ngn");
    expect(flat).not.toContain("credit_ledger");
    expect(flat).not.toContain("public.profiles");
  });

  it("refuses a future clock and an out-of-range or null cut-off, with the argument-error code", () => {
    expect(flat).toContain("p_now is null or p_now > pg_catalog.now() + interval '1 minute'");
    expect(flat).toContain("p_older_than is null or p_older_than < interval '1 hour' or p_older_than > interval '30 days'");
    expect(flat.match(/errcode = '22023'/g)).toHaveLength(2);
  });
});

describe("0267: who may call it", () => {
  it("is SECURITY DEFINER with an empty search_path, and every table reference is schema-qualified", () => {
    expect(flat).toContain("security definer set search_path = ''");
    expect(flat).not.toMatch(/\bset search_path = (public|'public')/);
    const body = flat.slice(flat.indexOf("as $$"), flat.indexOf("$$;"));
    expect(body).not.toMatch(/\b(from|update|into|join)\s+(?!public\.|released\b|pg_catalog\.|v_)[a-z_]+/);
  });

  it("revokes everything from PUBLIC, anon and authenticated, and grants execute to service_role alone", () => {
    expect(flat).toContain(`revoke all on function ${SIGNATURE} from public, anon, authenticated;`);
    expect(flat).toContain(`grant execute on function ${SIGNATURE} to service_role;`);
    expect(flat.match(/\bgrant\b/g)).toHaveLength(1);
  });

  it("checks its own privileges when it is applied (anon, authenticated, PUBLIC, service_role, SECURITY DEFINER, search_path)", () => {
    for (const piece of ["0267 self-check: % can execute", "0267 self-check: public can execute", "0267 self-check: service_role cannot execute", "is not security definer", "does not have an empty search_path"]) {
      expect(flat, piece).toContain(piece);
    }
    expect(flat).toContain("has_function_privilege");
    expect(flat).toContain("aclexplode");
  });
});

describe("0267: the rollback", () => {
  it("drops only that function (no cascade, no if exists that could hide a missing one) and nothing else", () => {
    expect(rollback).toContain(`drop function ${SIGNATURE};`);
    expect((rollback.match(/\bdrop\b/g) ?? []).length).toBe(1);
    expect(rollback).not.toMatch(/\bcascade\b|\bif exists\b|\balter\b|\bdelete\b|\bupdate\b|\btruncate\b|\bgrant\b|\brevoke\b/);
  });

  it("says that the code that calls the function is rolled back first", () => {
    expect(rawRollback.toLowerCase()).toContain("the daily mentorship sweep");
    expect(rawRollback.toLowerCase()).toContain("must be rolled back first");
  });
});
