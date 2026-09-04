import "server-only";
import { cache } from "react";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The single source of truth every pass-covered gate defers to. Shared
 * across tailoring, cover letters, bullet rewrites, Auto-Apply (beyond its
 * free weekly allowance), scholarship eligibility checks and SOP drafts —
 * see docs on each call site for why resume template unlock and Talent
 * Directory verification deliberately never call this.
 *
 * ── WHY `status = 'active'` ALONE IS NOT ENOUGH ─────────────────────────
 *
 * Nothing in this codebase ever flips `user_passes.status` away from
 * 'active' when `expires_at` passes — a renewal failure sets
 * `auto_renew_status = 'lapsed'`, a distinct column, and `status` itself
 * has no cron or trigger touching it after insert. Checking `status`
 * alone would treat every pass ever purchased as covering its holder
 * forever. `expires_at > now()` is the actual boundary, checked live on
 * every call rather than cached, for the same reason job/scholarship
 * listings are checked live elsewhere in this codebase: a pass that just
 * expired must stop covering actions the same request it happens, not
 * whenever something next refreshes a cached flag.
 *
 * ── WHY THIS IS AN EXISTS CHECK, NOT A SINGLE-ROW READ ──────────────────
 *
 * There is no unique constraint on `user_passes.user_id`, and
 * fulfillPayment inserts a new row on every pass purchase with no check
 * for an existing active one first — so a user can legitimately hold more
 * than one active pass (e.g. buying a 30-Day Pass while a Sprint Pass is
 * still running). `count > 0` is the correct question; picking "the" row
 * would require an arbitrary tie-break this function has no business
 * making.
 */
export async function hasActivePass(userId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .from("user_passes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if (error) {
    // Fail closed: a broken entitlement check must fall back to the normal
    // credit gate, never silently grant free access.
    console.error(`[pass-entitlement] could not check active pass for ${userId}: ${error.message}`);
    return false;
  }
  return (count ?? 0) > 0;
}

/**
 * No legitimate seeker should ever reach this — an intense day of AI usage
 * is around 15 actions (see the founder's cost-probe review, 2026-09-03).
 * 30/day exists to stop scripted abuse and runaway LLM cost, not to ration
 * real usage. One constant, so it can be retuned without touching every
 * call site that reads it.
 *
 * Counted as a rolling 24-hour window against credit_gate_events rows with
 * outcome = 'covered_by_pass', matching how Auto-Apply's own daily
 * submission cap is windowed (`auto_apply_claim_submission`, 0034) — a
 * calendar-day reset would let someone burn 30 actions at 11:59pm and
 * another 30 at 12:01am, sixty in two minutes.
 *
 * NOT wrapped in the same atomic lock spend_credits_atomic or
 * auto_apply_claim_submission use: this is a soft fair-use ceiling chosen
 * so far above real usage that a rare race letting a 31st or 32nd action
 * through under heavy concurrency costs nothing worth building a second
 * locking mechanism to prevent — unlike a credit spend or an Auto-Apply
 * submission, getting this off by one under a genuine race is not a money
 * bug.
 */
export const PASS_DAILY_ACTION_CAP = 30;

export type PassCoverageResult =
  | { covered: true }
  | { covered: false; reason: "no_active_pass" }
  | { covered: false; reason: "daily_cap_reached" };

/**
 * The one function every pass-covered gate should actually call — combines
 * hasActivePass() with the fair-use cap so no call site can wire up one and
 * forget the other.
 *
 * A capped user is NOT treated as pass-holder-with-no-pass: the distinction
 * only matters to the CALLER's error copy ("today's fair-use limit", never
 * "your pass ran out" — the pass is fine, today's ceiling just reset
 * tomorrow) — mechanically, both `no_active_pass` and `daily_cap_reached`
 * mean the same thing to every gate: fall back to the normal credit path,
 * exactly like an expired pass would.
 */
export async function checkPassCoverage(userId: string): Promise<PassCoverageResult> {
  const active = await hasActivePass(userId);
  if (!active) return { covered: false, reason: "no_active_pass" };

  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("credit_gate_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("outcome", "covered_by_pass")
    .gte("created_at", since);
  if (error) {
    console.error(`[pass-entitlement] could not check daily cap for ${userId}: ${error.message}`);
    // Fail closed to the credit path, same reasoning as hasActivePass above.
    return { covered: false, reason: "no_active_pass" };
  }
  if ((count ?? 0) >= PASS_DAILY_ACTION_CAP) {
    return { covered: false, reason: "daily_cap_reached" };
  }
  return { covered: true };
}

/**
 * Copy for the one moment the cap is actually visible to a user: they hit
 * it AND don't have enough credits either. Below the cap, or with credits
 * to spare, a capped user never sees this — the action just quietly starts
 * costing credits again, which is the point of a fair-use ceiling rather
 * than a hard cutoff.
 *
 * Deliberately does not say "pass exhausted" or "pass expired" — the pass
 * itself is untouched and will cover actions again once the rolling window
 * clears.
 */
export const DAILY_CAP_MESSAGE =
  "You've reached today's fair-use limit for Pass-covered actions — it resets within 24 hours, and your Pass is still active. This one needs credits.";

export interface ActivePassSummary {
  name: string;
  expiresAt: string;
  daysRemaining: number;
}

/**
 * For UI surfaces that need to SHOW pass identity/expiry — the masthead
 * chip, primarily — as opposed to hasActivePass()/checkPassCoverage(),
 * which only ever answer "is an action covered right now". Never used for
 * an entitlement decision: a display surface should reflect the same
 * status the gate would compute, not a second, independently-derived one.
 *
 * Same EXISTS-not-single-row reasoning as hasActivePass applies to WHICH
 * row this returns when a user holds more than one active pass: the one
 * with the LATEST expires_at, because "how long am I covered for" means
 * the outer edge of coverage, not whichever row happens to sort first.
 *
 * ── WHY `cache()` HERE AND DELIBERATELY NOT ON THE GATES ────────────────
 *
 * Request-memoized (React `cache()`, keyed on userId), so several surfaces
 * on one page — the masthead chip and anything else that wants to show
 * coverage — share a single query instead of each paying their own round
 * trip. Safe precisely BECAUSE this function is display-only: showing the
 * same pass twice on one page is the correct answer, and the memo is
 * discarded when the request ends, so nothing can go stale between page
 * loads.
 *
 * `hasActivePass` and `checkPassCoverage` are NOT wrapped, and that is the
 * decision rather than an oversight. They are entitlement GATES that decide
 * whether an action is free, and `checkPassCoverage` counts actions inside
 * a rolling window that its own callers move — memoizing it would mean a
 * request performing two covered actions checked the cap once and got the
 * pre-first-action count for the second. The rule this file already states
 * about live-checking `expires_at` on every call is the same rule: a gate
 * reads now, a display reads once.
 */
export const getActivePass = cache(async function getActivePass(
  userId: string,
): Promise<ActivePassSummary | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_passes")
    .select("expires_at, passes(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || !data.passes) {
    if (error) console.error(`[pass-entitlement] could not load active pass for ${userId}: ${error.message}`);
    return null;
  }
  const expiresAt = new Date(data.expires_at);
  const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
  return { name: data.passes.name, expiresAt: data.expires_at, daysRemaining };
});
