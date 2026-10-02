/**
 * Refer & Earn / 0215 — the SHAPE of the migration, so the rules a CREATE OR REPLACE can silently undo cannot regress.
 *
 * WHY. `CREATE OR REPLACE FUNCTION` keeps a function's GRANTS but replaces its `SET` options and `SECURITY` mode with whatever the new text
 * says. 0211 pinned `search_path` and tightened EXECUTE on the SECURITY DEFINER functions 0215 redefines, so a redefinition that left out
 * `SET search_path` or `SECURITY DEFINER` would silently undo that hardening, and one that granted EXECUTE would re-open it. Checked here in the
 * text; the live definitions are checked in CI by tests/referrals/referral-functions-hardening.test.ts, and the migration's own self-checks
 * compare the ACL and config before and after inside the same transaction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { REFERRAL_REWARD_CREDITS } from "@/lib/referrals/rewards";

const sql = readFileSync("supabase/migrations/0215_referral_reward_on_activation.sql", "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

/** Every `create or replace function public.<name>(...)` body, up to its closing `$function$;`. */
function functions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of code.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\$function\$;/g)) out[m[1]] = m[0];
  return out;
}

describe("0215 redefines exactly the three reward functions, keeping their hardening", () => {
  const fns = functions();

  it("redefines handle_new_user, check_and_activate_referral and grant_referral_reward, and nothing else", () => {
    expect(Object.keys(fns).sort()).toEqual(["check_and_activate_referral", "grant_referral_reward", "handle_new_user"]);
  });

  for (const name of ["handle_new_user", "check_and_activate_referral", "grant_referral_reward"]) {
    it(`${name} stays SECURITY DEFINER and keeps its pinned search_path`, () => {
      expect(fns[name], name).toMatch(/security definer/i);
      expect(fns[name], name).toMatch(/set search_path to 'public'/i);
    });
  }

  it("grants EXECUTE to nobody: no GRANT, no REVOKE, and no mention of anon or public (ACLs are left exactly as 0211 set them)", () => {
    expect(code).not.toMatch(/\bgrant\s+execute\b/i);
    expect(code).not.toMatch(/\bgrant\s+all\b/i);
    expect(code).not.toMatch(/\bto\s+(anon|public|authenticated)\b/i);
    expect(code).not.toMatch(/\brevoke\b/i);
  });

  it("the self-check compares ACL and config before and after, inside the migration's own transaction", () => {
    expect(code).toMatch(/proacl/);
    expect(code).toMatch(/proconfig/);
    expect(code).toMatch(/self-check: .*(acl|execute|search_path)/i);
  });
});

describe("0215 pays the whole reward at activation, and says why when it pays less", () => {
  const fns = functions();

  it("the literal in the SQL is the TS constant (parity at the source; CI compares what the live trigger pays)", () => {
    const m = fns.check_and_activate_referral.match(/v_remainder := (\d+) - coalesce/);
    expect(m, "no remainder arithmetic").not.toBeNull();
    expect(Number(m![1])).toBe(REFERRAL_REWARD_CREDITS);
  });

  it("handle_new_user records the referral and pays nothing", () => {
    expect(fns.handle_new_user).not.toMatch(/grant_referral_reward/);
    expect(fns.handle_new_user).not.toMatch(/referral_signup_bonus/);
    expect(fns.handle_new_user).toMatch(/insert into public\.referrals/);
  });

  it("adds a NULLABLE reward_withheld_reason column, restricted to the reasons the functions write, with no default and no backfill", () => {
    expect(code).toMatch(/alter table public\.referrals\s+add column reward_withheld_reason text/i);
    expect(code).toMatch(/check \(reward_withheld_reason is null or reward_withheld_reason in \('cap', 'referrer_deleted'\)\)/i);
    expect(code).not.toMatch(/reward_withheld_reason text not null/i);
    expect(code).not.toMatch(/update public\.referrals\s+set reward_withheld_reason[^;]*where (?!id = p_referral_id|id = v_referral_id)/i);
  });

  it("the cap writes the reason ('cap') on the referral it blocked, and still pays nothing", () => {
    expect(fns.grant_referral_reward).toMatch(/reward_withheld_reason = 'cap'/);
    const afterCap = fns.grant_referral_reward.split("count_rewarded_referrals_last_30d")[1] ?? "";
    expect(afterCap.indexOf("return")).toBeGreaterThan(-1);
    expect(afterCap.indexOf("return")).toBeLessThan(afterCap.indexOf("grant_credits_atomic"));
  });

  it("a deleted referrer (referrer_id set null by 0209) no longer raises inside the friend's own trigger: it is claimed and marked 'referrer_deleted'", () => {
    expect(fns.check_and_activate_referral).toMatch(/v_referrer_id is null/);
    expect(fns.check_and_activate_referral).toMatch(/reward_withheld_reason = 'referrer_deleted'/);
  });

  it("claims the activation atomically: the UPDATE is the claim, and the function stops if it claimed nothing", () => {
    const f = fns.check_and_activate_referral;
    expect(f).toMatch(/update public\.referrals[\s\S]*where id = v_referral_id and status = 'signed_up'[\s\S]*returning reward_credits_referrer into v_paid/);
    expect(f).toMatch(/if not found then\s+return;/);
  });
});
