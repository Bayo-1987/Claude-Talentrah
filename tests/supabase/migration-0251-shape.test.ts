/**
 * Migration 0251 (the owner's test accounts count as QA accounts) — its shape, read from the files (no database). Behaviour is in tests/rls/qa-account-owner-accounts.test.ts (database-backed, CI only).
 *
 *   - ONE clause is added to public.is_qa_account: the whole email, lower-cased and trimmed, matches ^stonebridgehibr1\+[a-z0-9._-]+@gmail\.com$ (anchored both ends, non-empty tag, that mailbox and domain only);
 *   - there is NO rule on the name "Amara Test" (a name is typed by whoever signs up; the email already proves the account is the owner's);
 *   - every other clause is the 0240 clause, byte for byte, and the rollback restores the 0240 function body exactly;
 *   - the helper stays pure: immutable, parallel safe, invoker, empty search_path, service_role only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const M0240 = join(__dirname, "../../supabase/migrations/0240_is_qa_account.sql");
const M0251 = join(__dirname, "../../supabase/migrations/0251_is_qa_account_owner_test_accounts.sql");
const RB0251 = join(__dirname, "../../supabase/rollbacks/0251_is_qa_account_owner_test_accounts.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (t: string) => strip(t).replace(/\s+/g, " ").trim().toLowerCase();
const raw = existsSync(M0251) ? readFileSync(M0251, "utf8") : "";
const rawRb = existsSync(RB0251) ? readFileSync(RB0251, "utf8") : "";
const raw0240 = readFileSync(M0240, "utf8");

/** The function body between $f$ ... $f$ of the first create or replace function in a file. */
function body(text: string): string {
  const m = strip(text).match(/create or replace function public\.is_qa_account[\s\S]*?as \$f\$([\s\S]*?)\$f\$;/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
const NEW_CLAUSE = String.raw`coalesce(pg_catalog.lower(pg_catalog.btrim(p_email)) ~ '^stonebridgehibr1\+[a-z0-9._-]+@gmail\.com$', false)`;

describe("0251: the files", () => {
  it("exist under number 0251 and name no placeholder", () => {
    expect(existsSync(M0251)).toBe(true);
    expect(existsSync(RB0251)).toBe(true);
    expect(raw).not.toMatch(/NNNN|PROPOSED/);
    expect(rawRb).not.toMatch(/NNNN|PROPOSED/);
  });
});

describe("0251: the function", () => {
  it("is the 0240 body with exactly one clause added, after the +qa- clause", () => {
    const b0 = body(raw0240);
    const b1 = body(raw);
    expect(b0.length).toBeGreaterThan(100);
    const first = "coalesce(pg_catalog.lower(p_email) like '%+qa-%', false)";
    expect(b0.startsWith(`select ${first} or `)).toBe(true);
    expect(b1).toBe(b0.replace(first, () => `${first} or ${NEW_CLAUSE}`));
  });
  it("pins the mailbox and the domain, anchored at both ends, with a non-empty tag, and has no wildcard", () => {
    const b1 = body(raw);
    expect(b1).toContain(NEW_CLAUSE);
    expect(b1.match(/stonebridgehibr1/g)?.length).toBe(1);
    expect(b1).not.toMatch(/like '%stonebridge|ilike|\.\*/);
  });
  it("has no rule on the name Amara Test", () => {
    expect(body(raw).toLowerCase()).not.toMatch(/amara|\btest\b/);
  });
  it("stays pure and service_role only", () => {
    const f = flat(raw);
    expect(f).toContain("immutable parallel safe set search_path = ''");
    expect(f).not.toContain("security definer");
    expect(f).toContain("revoke execute on function public.is_qa_account(text, text, text, text) from public, anon, authenticated");
    expect(f).toContain("grant execute on function public.is_qa_account(text, text, text, text) to service_role");
  });
});

describe("0251: the rollback", () => {
  it("restores the 0240 body exactly and the 0240 ACL, in one transaction", () => {
    expect(body(rawRb)).toBe(body(raw0240));
    const f = flat(rawRb);
    expect(f.startsWith("begin;")).toBe(true);
    expect(f.endsWith("commit;")).toBe(true);
    expect(f).toContain("grant execute on function public.is_qa_account(text, text, text, text) to service_role");
  });
});
