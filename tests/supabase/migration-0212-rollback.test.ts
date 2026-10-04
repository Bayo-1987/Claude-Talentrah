/**
 * ACCT-1 PR 1 — the rollback file kept beside 0212 (supabase/rollbacks/0212_account_deletion_request.rollback.sql), checked without a database.
 *
 * What it must be: one transaction; every function and policy 0212 rewrote put back to its previous body BEFORE the new objects are dropped (so nothing
 * still refers to the flag or the helper when they go); and every object 0212 created dropped. That 0212 + this file restores the previous definitions
 * exactly is proved against the real catalogue, in a rolled-back transaction, when the PR is opened (output in the PR body); this test keeps the file
 * complete as the migration changes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const migration = read("supabase/migrations/0212_account_deletion_request.sql");
const rollback = read("supabase/rollbacks/0212_account_deletion_request.rollback.sql");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

/** Every patch call, as the literal arguments in order: the function/table, then anchor, replacement, anchor, replacement, ... */
const calls = (text: string) =>
  [...text.matchAll(/select pg_temp\.(patch_fn|patch_policy)\(([\s\S]*?)\);\n/g)].map((m) => ({
    kind: m[1],
    lits: [...m[2].matchAll(/\$(x+)\$([\s\S]*?)\$\1\$/g)].map((l) => l[2]),
  }));
const forward = calls(migration);
const back = calls(rollback);

describe("0212 rollback", () => {
  it("is one transaction", () => {
    expect(code(rollback).trim().startsWith("begin;")).toBe(true);
    expect(code(rollback).trim().endsWith("commit;")).toBe(true);
  });

  it("is generated from the same patch table: the same calls, in the same order, with every anchor and replacement swapped", () => {
    expect(forward.length).toBe(21);
    expect(back.length).toBe(forward.length);
    forward.forEach((f, i) => {
      const k = back[i];
      expect(k.kind).toBe(f.kind);
      if (f.kind === "patch_fn") {
        expect(k.lits[0]).toBe(f.lits[0]);
        const fp = f.lits.slice(1);
        const kp = k.lits.slice(1);
        expect(kp.length).toBe(fp.length);
        for (let j = 0; j < fp.length; j += 2) {
          expect(kp[j]).toBe(fp[j + 1]);
          expect(kp[j + 1]).toBe(fp[j]);
        }
      } else {
        // patch_policy(table, name-like, from, to, marker): the undo swaps from and to, drops the marker (an undo has no "already applied" shortcut), and writes its
        // anchor the way pg_policies DEPARSES the expression, which has no "public." schema prefix.
        expect(f.lits).toHaveLength(5);
        expect(k.lits).toEqual([f.lits[0], f.lits[1], f.lits[3].replace(/public\./g, ""), f.lits[2]]);
        expect(f.lits[4]).toMatch(/is_active$/);
      }
    });
  });

  it("patches the live definitions the same way (it stops unless each anchor is found exactly once) and recreates no function from a literal", () => {
    expect(rollback).toMatch(/must be found exactly once/);
    expect(code(rollback)).not.toMatch(/create or replace function public\./);
  });

  it("an undo has no 'already applied' shortcut: every undo call says so, and its helper requires the anchor exactly once or stops", () => {
    // Testing "is the replacement present" for an undo would skip it (the original text is a PART of what the patch left), and testing "is the anchor gone" would
    // skip it silently when the stored text merely differs from the anchor. So an undo never skips: it matches or it fails loudly.
    for (const text of [rollback, migration]) {
      expect(text).toMatch(/p_undo boolean default false/);
      expect(text).toMatch(/if p_undo or position\(p_pairs\[i \+ 1\] in v_new\) = 0 then/);
      expect(text).toMatch(/p_skip_if text default null/);
      expect(text).toMatch(/perform set_config\('search_path', 'public', true\)/);
    }
    const fnCalls = (t: string) => [...t.matchAll(/select pg_temp\.patch_fn\([\s\S]*?\n  \], (true|false)\);/g)].map((m) => m[1]);
    expect(fnCalls(rollback)).toHaveLength(16);
    expect(new Set(fnCalls(rollback))).toEqual(new Set(["true"]));
    expect(new Set(fnCalls(migration))).toEqual(new Set(["false"]));
  });

  it("every patch comes BEFORE any drop, so nothing refers to the flag or a helper when it goes", () => {
    const body = code(rollback);
    expect(body.lastIndexOf("select pg_temp.patch_")).toBeLessThan(body.indexOf("drop function if exists"));
  });

  it("drops every object 0212 created, AFTER the restores", () => {
    const body = code(rollback);
    const firstDrop = body.indexOf("drop function if exists");
    for (const fn of [
      "function_acl_audit()",
      "account_deletion_restore()",
      "account_deletion_status()",
      "account_deletion_confirm(uuid, text)",
      "account_deletion_confirm_precheck(uuid, text)",
      "account_deletion_stop_renewals(uuid)",
      "account_deletion_create_request(uuid, text)",
      "account_deletion_blockers(uuid)",
      "submission_applicant_is_active(uuid)",
      "application_applicant_is_active(uuid)",
      "account_is_active(uuid)",
    ]) {
      const at = body.indexOf(`drop function if exists public.${fn}`);
      expect(at, fn).toBeGreaterThan(firstDrop - 1);
      expect(at).toBeGreaterThan(body.lastIndexOf("select pg_temp.patch_"));
    }
    expect(body).toMatch(/drop table if exists public\.account_deletions;/);
    expect(body).toMatch(/alter table public\.profiles drop column if exists deletion_requested_at;/);
  });

  it("warns, in its header, that it destroys the request records and what to check first", () => {
    expect(rollback).toMatch(/WHAT IT DESTROYS/);
    expect(rollback).toMatch(/status = 'scheduled'/);
  });
});
