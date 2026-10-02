import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { takesRowLockBeforeUpdating } from "./row-lock-check";

const LOCKED = `
CREATE OR REPLACE FUNCTION public.redeem_job_expiry_extend_token(p_token_hash text, p_now timestamptz)
 AS $function$
begin
  select * into r from public.job_expiry_reminders where token_hash = p_token_hash for update;
  update public.job_postings j set expires_at = j.expires_at + interval '30 days';
end;
$function$`;

describe("takesRowLockBeforeUpdating", () => {
  it("accepts a definition that locks the token row first", () => {
    expect(takesRowLockBeforeUpdating(LOCKED)).toBe(true);
  });

  it("MUTANT: rejects the same function with the lock removed", () => {
    const lockless = LOCKED.replace(" for update", "");
    expect(lockless).not.toBe(LOCKED);
    expect(takesRowLockBeforeUpdating(lockless)).toBe(false);
  });

  it("MUTANT: rejects a lock that only appears in a comment", () => {
    const commentOnly = LOCKED.replace(" for update;", "; -- for update");
    expect(takesRowLockBeforeUpdating(commentOnly)).toBe(false);
  });

  it("MUTANT: rejects a lock taken AFTER the posting is moved", () => {
    const lateLock = `
      update public.job_postings j set expires_at = j.expires_at + interval '30 days';
      select * into r from public.job_expiry_reminders where token_hash = p_token_hash for update;`;
    expect(takesRowLockBeforeUpdating(lateLock)).toBe(false);
  });

  it("the migration file as written passes it (so CI, which applies the file, gets a locked function)", () => {
    const sql = readFileSync(path.join(__dirname, "../../../supabase/migrations/0207_job_expiry_reminders.sql"), "utf8");
    const start = sql.indexOf("create or replace function public.redeem_job_expiry_extend_token(");
    const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
    expect(start).toBeGreaterThan(-1);
    expect(takesRowLockBeforeUpdating(sql.slice(start, end))).toBe(true);
  });
});
