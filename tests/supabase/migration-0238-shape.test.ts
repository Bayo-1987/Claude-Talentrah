/**
 * Migration 0238 (the AI resume review attempt limit) — its shape, read from the file (no database). The behaviour is in
 * tests/talent-directory/ai-verification-attempt-limit.test.ts (database-backed, ids 0238-DB-01..14) and tests/talent-directory/verification-runner-attempt-limit.test.ts;
 * this pins what would not fail a behavioural test until somebody was hurt by it.
 *
 * The first one is the reason it exists: the claim function writes review_type 'ai' itself. Today the column default is 'ai', so a claim that left it out would still count; the day the default changes
 * (or a human-review path is made the default) a claimed AI review would stop counting toward its own limit and the limit would silently not hold. No behavioural test can see that without changing
 * the default, which a test must not do to a shared database, so the file is read here.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0238_ai_verification_attempt_limit.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0238_ai_verification_attempt_limit.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sql = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const flat = strip(sql).replace(/\s+/g, " ").toLowerCase();
const rollback = existsSync(ROLLBACK) ? strip(readFileSync(ROLLBACK, "utf8")).replace(/\s+/g, " ").toLowerCase() : "";

describe("0238: the files", () => {
  it("exist under the registered number, and name no placeholder number anywhere", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(sql).not.toMatch(/NNNN/);
    expect(readFileSync(ROLLBACK, "utf8")).not.toMatch(/NNNN/);
  });
});

describe("0238: the claim function", () => {
  it("writes review_type 'ai' on the row it inserts (it does not rely on the column default)", () => {
    expect(flat).toMatch(/insert into public\.talent_verifications \(user_id, status, review_type\) values \(p_user_id, 'pending', 'ai'\)/);
  });

  it("counts only AI reviews that were resolved (verified or rejected), never pending ones, in a 30 day window, with a limit of 2", () => {
    expect(flat).toMatch(/tv\.review_type = 'ai' and tv\.status in \('verified', 'rejected'\)/);
    expect(flat).toMatch(/interval '30 days'/);
    expect(flat).toMatch(/if v_count >= 2 then/);
    expect(flat).not.toMatch(/status in \('pending'/);
  });

  it("locks the person's profile row before it counts, so one person's claims cannot interleave", () => {
    expect(flat).toMatch(/from public\.profiles p where p\.id = p_user_id for update/);
    expect(flat.indexOf("for update")).toBeLessThan(flat.indexOf("select count(*) into v_count"));
  });

  it("fails closed: a missing or null profile returns no_profile before anything is inserted", () => {
    expect(flat).toMatch(/if p_user_id is null then return query select false, null::uuid, 'no_profile'/);
    expect(flat).toMatch(/if not found then return query select false, null::uuid, 'no_profile'/);
    expect(flat.indexOf("'no_profile'")).toBeLessThan(flat.indexOf("insert into public.talent_verifications"));
  });

  it("is SECURITY DEFINER with an empty search_path, and closed to everyone but service_role", () => {
    for (const fn of ["claim_ai_talent_verification\\(uuid\\)", "resolve_flagged_talent_verification\\(uuid, uuid, text, text\\)"]) {
      expect(flat).toMatch(new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`));
      expect(flat).toMatch(new RegExp(`grant execute on function public\\.${fn} to service_role;`));
    }
    expect(flat.match(/security definer set search_path = ''/g)?.length).toBe(2);
  });
});

describe("0238: the flagged resolver and the column", () => {
  it("only ever resolves a pending AI row as rejected, never verified, and moves no credits", () => {
    const body = flat.slice(flat.indexOf("create or replace function public.resolve_flagged_talent_verification"));
    expect(body).toMatch(/set status = 'rejected'/);
    expect(body).not.toMatch(/'verified'/);
    expect(body).toMatch(/and status = 'pending' and review_type = 'ai'/);
    expect(body).not.toMatch(/credit/);
  });

  it("does not redefine resolve_talent_verification (it stays the one place a profile is marked verified)", () => {
    expect(flat).not.toMatch(/function public\.resolve_talent_verification/);
  });

  it("flag_source is nullable, limited to pattern or model, and only allowed on a rejected AI review", () => {
    expect(flat).toMatch(/add column flag_source text;/);
    expect(flat).toMatch(/check \(flag_source is null or \(flag_source in \('pattern', 'model'\) and review_type = 'ai' and status = 'rejected'\)\)/);
  });

  it("carries a self-check that the API roles can neither read nor write the new column", () => {
    expect(flat).toMatch(/has_column_privilege\(role_name, 'public\.talent_verifications', 'flag_source', 'select'\)/);
    expect(flat).toMatch(/'insert'\)/);
    expect(flat).toMatch(/'update'\)/);
  });
});

describe("0238: the rollback", () => {
  it("drops both functions, the check and the column, and nothing else", () => {
    expect(rollback).toMatch(/drop function if exists public\.claim_ai_talent_verification\(uuid\)/);
    expect(rollback).toMatch(/drop function if exists public\.resolve_flagged_talent_verification\(uuid, uuid, text, text\)/);
    expect(rollback).toMatch(/drop constraint if exists talent_verifications_flag_source_check/);
    expect(rollback).toMatch(/drop column if exists flag_source/);
    expect(rollback).not.toMatch(/delete|truncate|update /);
  });
});
