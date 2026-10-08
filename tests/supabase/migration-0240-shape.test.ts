/**
 * Migration 0240 (public.is_qa_account and the four database surfaces that use it) — its shape, read from the files (no database). The behaviour is in
 * tests/rls/qa-account-exclusion.test.ts (database-backed, CI only); this pins what a behavioural test would not catch until somebody was hurt by it:
 *
 *   - the four functions are PATCHED from their live definitions (anchor exactly once, one predicate added), never recreated from a copy of their body: a copy would silently revert any
 *     change that landed since (that is how 0212 avoided it, and 0240 uses the same helper);
 *   - the predicate is identical in all four and in the rollback, which is the exact swap of it;
 *   - the helper is pure: immutable, invoker, empty search_path, service_role only (no policy calls it, so no client role needs it);
 *   - the name rule is case-sensitive on "QA" (so "Qasim" and "Qa Hoang" stay visible) and the email tag is case-insensitive.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0240_is_qa_account.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0240_is_qa_account.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const flat = strip(raw).replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

const ANCHOR = "and p.deletion_requested_at is null";
const PREDICATE = "and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)";
const REPLACEMENT = `${ANCHOR} ${PREDICATE}`;
const SIGNATURES = [
  "public.talent_directory_listed_ids()",
  "public.talent_directory_portfolio_items(uuid)",
  "public.request_talent_directory_contact(uuid, uuid, text, uuid)",
  "public.referral_leaderboard(timestamptz, timestamptz, integer)",
];

/** The patch_fn call for one signature, from the file with comments removed: [anchor, replacement, undo flag]. */
function patchCall(text: string, signature: string): { anchor: string; replacement: string; undo: string } | null {
  const body = strip(text);
  const m = body.match(new RegExp(`pg_temp\\.patch_fn\\(\\$x\\$${signature.replace(/[()]/g, "\\$&")}\\$x\\$, array\\[\\s*\\$x\\$([^$]*)\\$x\\$,\\s*\\$x\\$([^$]*)\\$x\\$\\s*\\], (true|false)\\);`));
  return m ? { anchor: m[1], replacement: m[2], undo: m[3] } : null;
}

describe("0240: the files", () => {
  it("exist under the registered number, and name no placeholder number anywhere", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
    expect(rawRollback).not.toMatch(/NNNN/);
  });
});

describe("0240: the four functions are patched from their live definitions", () => {
  it.each(SIGNATURES)("%s: the anchor is the 0212 line, the replacement is that line plus the one predicate, applied (not undone)", (sig) => {
    const call = patchCall(raw, sig);
    expect(call, `a patch_fn call for ${sig}`).not.toBeNull();
    expect(call!.anchor).toBe(ANCHOR);
    expect(call!.replacement).toBe(REPLACEMENT);
    expect(call!.undo).toBe("false");
  });

  it("patches exactly these four and no other function, and never recreates one from a copy of its body", () => {
    expect((flat.match(/pg_temp\.patch_fn\(\$x\$public\./g) ?? []).length).toBe(4);
    for (const fn of ["talent_directory_listed_ids", "talent_directory_portfolio_items", "request_talent_directory_contact", "referral_leaderboard"]) {
      expect(flat, `${fn} must not be recreated from a copy`).not.toMatch(new RegExp(`create (or replace )?function public\\.${fn}\\b`));
    }
    expect(flat).not.toMatch(/\bcreate (or replace )?policy\b|\balter policy\b|\bdrop policy\b/);
  });

  it("requires its anchor exactly once and stops otherwise (the helper keeps 0212's guard)", () => {
    expect(flat).toMatch(/if v_cnt <> 1 then raise exception '0240: anchor/);
    expect(flat).toMatch(/v_def := pg_get_functiondef\(v_oid\)/);
  });
});

describe("0240: the helper", () => {
  it("is immutable, SECURITY INVOKER (no definer anywhere in the migration), with an empty search_path", () => {
    expect(flat).toMatch(/create or replace function public\.is_qa_account\(p_email text, p_first text, p_last text, p_display text\) returns boolean language sql immutable parallel safe set search_path = '' as \$f\$/);
    expect(flat).not.toMatch(/security definer/);
  });

  it("is closed to every client role and open to service_role only", () => {
    expect(flat).toMatch(/revoke execute on function public\.is_qa_account\(text, text, text, text\) from public, anon, authenticated;/);
    expect(flat).toMatch(/grant execute on function public\.is_qa_account\(text, text, text, text\) to service_role;/);
  });

  it("qualifies every function it calls with pg_catalog (an empty search_path must not be able to change what it means)", () => {
    const body = flat.slice(flat.indexOf("$f$"), flat.lastIndexOf("$f$"));
    const calls = body.match(/\b(lower|btrim|left|concat_ws)\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(body.match(/pg_catalog\.(lower|btrim|left|concat_ws)\(/g)?.length).toBe(calls.length);
  });

  it("is case-insensitive on the email tag only, and case-sensitive on 'QA' in names", () => {
    const body = flat.slice(flat.indexOf("$f$"), flat.lastIndexOf("$f$"));
    expect(body).toMatch(/pg_catalog\.lower\(p_email\) like '%\+qa-%'/);
    expect(body.match(/pg_catalog\.lower\(/g)?.length).toBe(1);
    expect(body).not.toMatch(/ilike|upper\(|lower\(p_(first|last|display)/);
    // the literals are the upper-case ones (flat is lower-cased, so read them from the raw text)
    const rawBody = strip(raw).slice(strip(raw).indexOf("$f$"), strip(raw).lastIndexOf("$f$"));
    expect(rawBody).toMatch(/= 'QA'/);
    expect(rawBody).toMatch(/, 3\) = 'QA '/);
  });

  it("is null-safe: every term is coalesced, so the function never returns null", () => {
    const body = flat.slice(flat.indexOf("$f$"), flat.lastIndexOf("$f$"));
    expect(body.match(/coalesce\(/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("0240: the rollback is the exact undo", () => {
  it.each(SIGNATURES)("%s: the same pair with anchor and replacement swapped, undone", (sig) => {
    const call = patchCall(rawRollback, sig);
    expect(call, `a rollback patch_fn call for ${sig}`).not.toBeNull();
    expect(call!.anchor).toBe(REPLACEMENT);
    expect(call!.replacement).toBe(ANCHOR);
    expect(call!.undo).toBe("true");
  });

  it("removes the predicate from all four BEFORE it drops the helper, inside one transaction", () => {
    expect(rollback.trim().startsWith("begin;")).toBe(true);
    expect(rollback.trim().endsWith("commit;")).toBe(true);
    const drop = rollback.indexOf("drop function public.is_qa_account(text, text, text, text);");
    expect(drop).toBeGreaterThan(-1);
    for (const sig of SIGNATURES) expect(rollback.indexOf(`pg_temp.patch_fn($x$${sig}$x$`)).toBeLessThan(drop);
  });
});
