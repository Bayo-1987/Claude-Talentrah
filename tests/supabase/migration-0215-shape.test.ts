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

  it("redefines handle_new_user, check_and_activate_referral and grant_referral_reward, and adds only the read-only stuck_signed_up_referrals check", () => {
    expect(Object.keys(fns).sort()).toEqual(["check_and_activate_referral", "grant_referral_reward", "handle_new_user", "stuck_signed_up_referrals"]);
  });

  for (const name of ["handle_new_user", "check_and_activate_referral", "grant_referral_reward"]) {
    it(`${name} stays SECURITY DEFINER and keeps its pinned search_path`, () => {
      expect(fns[name], name).toMatch(/security definer/i);
      expect(fns[name], name).toMatch(/set search_path to 'public'/i);
    });
  }

  it("changes no EXECUTE grant on the existing functions: the ONLY GRANT/REVOKE statements are the new stuck_signed_up_referrals check's own (ACLs of the rest stay exactly as 0211 set them)", () => {
    const own = /function public\.stuck_signed_up_referrals\(\) (from|to) /;
    const rest = code
      .split("\n")
      .filter((l) => !own.test(l))
      .join("\n");
    expect(rest).not.toMatch(/\bgrant\s+execute\b/i);
    expect(rest).not.toMatch(/\bgrant\s+all\b/i);
    expect(rest).not.toMatch(/\bto\s+(anon|public|authenticated)\b/i);
    expect(rest).not.toMatch(/\brevoke\b/i);
    // and the statements that were filtered out are exactly the four expected ones
    expect(code.split("\n").filter((l) => own.test(l))).toHaveLength(4);
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

describe("0215: a payout failure never fails the friend's own action", () => {
  const body = functions()["check_and_activate_referral"];

  it("the claim-and-grant step runs in its own subtransaction: an EXCEPTION block that catches everything and returns, and raises only a WARNING", () => {
    expect(body).toMatch(/exception\s+when others then/i);
    expect(body).toMatch(/raise warning/i);
    expect(body, "the warning names the SQLSTATE").toMatch(/sqlstate/i);
    expect(body, "and the referral").toMatch(/v_referral_id/);
    expect(body, "never turns the failure into an error for the friend").not.toMatch(/raise exception/i);
  });

  it("the EXCEPTION block covers the claim and the grant, not the early lookups", () => {
    const claim = body.indexOf("set status = 'activated'");
    const handler = body.search(/exception\s+when others then/i);
    const grant = body.indexOf("perform public.grant_referral_reward");
    const lookup = body.indexOf("limit 1");
    expect(lookup).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(lookup);
    expect(grant).toBeGreaterThan(claim);
    expect(handler).toBeGreaterThan(grant);
    // the inner BEGIN that the handler belongs to opens before the claim, after the early lookups
    const innerBegin = body.lastIndexOf("begin", claim);
    expect(innerBegin).toBeGreaterThan(lookup);
  });
});

describe("0215: stuck_signed_up_referrals is a read-only, service-role-only check", () => {
  const body = functions()["stuck_signed_up_referrals"];

  it("is SECURITY DEFINER with search_path pinned, STABLE, and writes nothing", () => {
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path to 'public'/i);
    expect(body).toMatch(/\bstable\b/i);
    expect(body, "read-only").not.toMatch(/\b(insert|update|delete|perform|truncate)\b/i);
  });

  it("returns identifiers, a timestamp and a label ONLY: no email, name or other personal field, so the check is safe to read in a log or a ticket", () => {
    const returns = body.match(/returns table \(([^)]*)\)/i)?.[1].replace(/\s+/g, " ").trim();
    expect(returns).toBe("referral_id uuid, referrer_id uuid, referred_user_id uuid, signed_up_at timestamptz, qualifies_by text");
  });

  it("lists signed_up referrals whose friend already meets the SAME activation rule check_and_activate_referral uses", () => {
    expect(body).toMatch(/status = 'signed_up'/);
    expect(body).toMatch(/is_base = true/);
    expect(body).toMatch(/applied_at is not null/);
    const activate = functions()["check_and_activate_referral"];
    expect(activate).toMatch(/is_base = true/);
    expect(activate).toMatch(/applied_at is not null/);
  });

  it("only service_role can execute it: revoked from public, anon and authenticated, granted to service_role", () => {
    const sig = "public.stuck_signed_up_referrals()";
    expect(code).toContain(`revoke all on function ${sig} from public`);
    expect(code).toContain(`revoke all on function ${sig} from anon`);
    expect(code).toContain(`revoke all on function ${sig} from authenticated`);
    expect(code).toContain(`grant execute on function ${sig} to service_role`);
    expect(code, "nothing else is granted").not.toMatch(/grant execute on function public\.stuck_signed_up_referrals\(\) to (?!service_role)/);
  });
});
