import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { farahMessageCharge } from "@/lib/credits/farah-message-charge";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import { checkPassCoverage, DAILY_CAP_MESSAGE } from "@/lib/passes/entitlement";

export { InsufficientCreditsError };

/**
 * Farah chat's entitlement gate (0123) — 3 free messages per account in a
 * rolling 30-day window, then checkPassCoverage, then spendCredits. Mirrors
 * src/lib/tailoring/gate.ts's check/commit split — check BEFORE the LLM
 * call so an unaffordable message never triggers (and never costs
 * Talentrah for) a real Groq request, commit only AFTER it succeeds so a
 * failed reply never burns the free allowance, the Pass's daily cap, or a
 * credit spend for nothing.
 *
 * ── WHY FREE ALLOWANCE IS CHECKED FIRST, NOT PASS COVERAGE ────────────────
 *
 * checkTailoringAllowance checks Pass coverage BEFORE its own free trial,
 * specifically so a Pass holder's first tailoring run never burns a
 * ONE-TIME flag that can never come back. That reasoning does not transfer
 * here: this free allowance is a renewable ROLLING count, not a one-time
 * flag — a slot "wasted" on a message a Pass would have covered anyway
 * rolls back off the 30-day window regardless, so there is nothing
 * permanent to protect. This order — free allowance, then Pass, then
 * credits — is the founder's own explicit call, confirmed directly, not a
 * default inherited from the tailoring gate.
 *
 * ── WHY THE FREE ALLOWANCE REUSES credit_gate_events, NOT A NEW COUNTER ───
 *
 * checkPassCoverage already reads this table for its own rolling window
 * (`outcome = 'covered_by_pass'`); adding `covered_by_free_allowance`
 * (0123) keeps one place answering "how many times has this user used this
 * gate, and how" instead of a second table nothing else needs.
 */
import { FARAH_CHAT_FREE_ALLOWANCE, freeWindowStart, nextFreeMessageAt } from "@/lib/farah/free-allowance";
export { FARAH_CHAT_FREE_ALLOWANCE };
const FARAH_CHAT_REASON = "farah_chat_message" as const;

export interface FarahChatAllowanceResult {
  isFreeAllowance: boolean;
  isPassCovered: boolean;
  creditsSpent: number;
  /** Carried through to commit purely so the covered_by_pass/free-allowance
   *  gate-event log — deferred until AFTER the LLM call succeeds — can still
   *  record the balance as of the check, not whatever it is by then. */
  creditsAvailableAtCheck: number;
  /**
   * Free messages left AFTER this one, for the panel's own indicator. `null`
   * when this message was Pass-covered — a Pass holder isn't rationed by the
   * free counter, so surfacing "0 free left" to someone with effectively
   * unlimited messages would read as a wall that isn't there (matches
   * /api/farah/history's own null-for-pass-holder rule).
   */
  freeMessagesRemaining: number | null;
}

/**
 * Rolling-30-day count of this user's free-allowance-covered messages —
 * `created_at >= now() - 30 days`, never `date_trunc('month', ...)`. A
 * calendar-month reset would let someone send 3 on the 1st and 3 more on
 * the 31st, six in two days; a rolling window never allows that, matching
 * checkPassCoverage's own daily cap and Auto-Apply's submission cap
 * (auto_apply_claim_submission, 0034), both windowed the same way.
 *
 * `now` is a parameter (default `new Date()`) so a test can pin it and
 * prove the window is genuinely rolling rather than calendar-bucketed —
 * see tests/farah/chat-gate.test.ts.
 */
async function countFreeAllowanceUsed(userId: string, now: Date): Promise<number> {
  const supabase = createServiceRoleClient();
  const since = freeWindowStart(now).toISOString();
  const { count, error } = await supabase
    .from("credit_gate_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("reason", FARAH_CHAT_REASON)
    .eq("outcome", "covered_by_free_allowance")
    .gte("created_at", since);
  if (error) {
    console.error(`[farah-chat-gate] could not count free allowance for ${userId}: ${error.message}`);
    // Fail closed: treat as exhausted, same reasoning hasActivePass gives
    // for failing closed to the credit path rather than silently granting
    // free access on a broken query.
    return FARAH_CHAT_FREE_ALLOWANCE;
  }
  return count ?? 0;
}

/**
 * Read-only — how many free messages remain right now, for the panel's "X
 * free messages left" indicator (docs ask: silence here is worse than one
 * honest line). Does not affect the gate itself and is safe to call as
 * often as a page wants to display it.
 */
export async function farahChatFreeMessagesRemaining(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const used = await countFreeAllowanceUsed(userId, now);
  return Math.max(0, FARAH_CHAT_FREE_ALLOWANCE - used);
}

/**
 * When the next free message comes back, as an ISO timestamp, or `null` when none is coming back (nothing was used in the window) or the read failed.
 *
 * Rolling, not a calendar month: the oldest free message still inside the last 30 days returns exactly 30 days after it was logged (`nextFreeMessageAt`, free-allowance.ts, which shares the window edge
 * with the count above). It ignores a Pass: a Pass holder's free messages still come back on this schedule; whether to SHOW it is the caller's decision (the history route reports no free count for a
 * Pass holder). Display-only: it never decides whether a message is free (the count does), so a failed read is `null`, not fail-closed. Safe to call as often as a page wants to show it.
 */
export async function farahChatNextFreeMessageAt(userId: string, now: Date = new Date()): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("credit_gate_events")
    .select("created_at")
    .eq("user_id", userId)
    .eq("reason", FARAH_CHAT_REASON)
    .eq("outcome", "covered_by_free_allowance")
    .gte("created_at", freeWindowStart(now).toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error(`[farah-chat-gate] could not read when the next free message returns: ${error.message}`);
    return null;
  }
  const at = nextFreeMessageAt((data ?? []).map((r) => r.created_at), now);
  return at ? at.toISOString() : null;
}

/**
 * Read-only affordability check — call BEFORE askFarahChat/askFarahChatStream. Does not
 * mutate anything; pair with commitFarahChatAllowance after the LLM call
 * actually succeeds.
 */
export async function checkFarahChatAllowance(
  userId: string,
  now: Date = new Date(),
): Promise<FarahChatAllowanceResult> {
  const supabase = createServiceRoleClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .single();
  const balance = profile?.credits_balance ?? 0;

  const used = await countFreeAllowanceUsed(userId, now);
  const freeLeft = Math.max(0, FARAH_CHAT_FREE_ALLOWANCE - used);
  // A Pass is asked about only once the free messages are used, as before. The ORDER (free, then Pass, then credits) and the PRICE both come from farahMessageCharge, the one function every price label also calls.
  const coverage = freeLeft > 0 ? undefined : await checkPassCoverage(userId);
  const charge = farahMessageCharge({ freeLeft, passCovered: coverage ? coverage.covered : false, balance });

  if (charge.kind === "free") {
    // NOT logged here — see commitFarahChatAllowance. A failed LLM call
    // must not burn a free-allowance slot for a message that never
    // happened, the same ordering rule covered_by_pass already follows.
    return {
      isFreeAllowance: true,
      isPassCovered: false,
      creditsSpent: 0,
      creditsAvailableAtCheck: balance,
      freeMessagesRemaining: charge.freeAfter,
    };
  }

  if (charge.kind === "pass") {
    // Also not logged here, for the same reason: this counts against the
    // Pass's own daily fair-use cap, and a failed reply must not spend one.
    return {
      isFreeAllowance: false,
      isPassCovered: true,
      creditsSpent: 0,
      creditsAvailableAtCheck: balance,
      freeMessagesRemaining: null,
    };
  }

  if (charge.kind === "insufficient") {
    await logCreditGateEvent({
      userId,
      reason: FARAH_CHAT_REASON,
      creditsRequired: charge.required,
      creditsAvailable: balance,
      outcome: "blocked_insufficient_credits",
    });
    throw new InsufficientCreditsError(
      charge.required,
      balance,
      coverage && !coverage.covered && coverage.reason === "daily_cap_reached" ? DAILY_CAP_MESSAGE : undefined,
    );
  }

  if (charge.kind !== "credits") throw new Error("farahMessageCharge returned an unexpected kind for a gate call");

  // A credit spend is logged as 'proceeded' immediately, unlike the two
  // capped-resource branches above — nothing about this outcome is capped,
  // so there's nothing a failed LLM call could over-consume by logging early.
  await logCreditGateEvent({
    userId,
    reason: FARAH_CHAT_REASON,
    creditsRequired: charge.credits,
    creditsAvailable: balance,
    outcome: "proceeded",
  });
  return {
    isFreeAllowance: false,
    isPassCovered: false,
    creditsSpent: charge.credits,
    creditsAvailableAtCheck: balance,
    freeMessagesRemaining: 0,
  };
}

/**
 * What a commit left the account with, for the `done` event (issue #605).
 *
 * `balanceAfter` is the LEDGER's own `balance_after` for a spend — the value spend_credits_atomic
 * computed under its lock and spendCredits returns — never `creditsAvailableAtCheck - cost`: anything
 * else that touched the balance between the check and this commit (another tab, a tailoring run, a
 * top-up) would make a recomputed number wrong. `null` when nothing was spent (free allowance or Pass),
 * so the client leaves the masthead alone.
 */
export interface FarahChatCommitResult {
  balanceAfter: number | null;
}

/** Actually records the free-allowance/Pass use or spends credits — call only after the LLM call succeeds. */
export async function commitFarahChatAllowance(
  userId: string,
  allowance: FarahChatAllowanceResult,
): Promise<FarahChatCommitResult> {
  if (allowance.isFreeAllowance) {
    await logCreditGateEvent({
      userId,
      reason: FARAH_CHAT_REASON,
      creditsRequired: 0,
      creditsAvailable: allowance.creditsAvailableAtCheck,
      outcome: "covered_by_free_allowance",
    });
    return { balanceAfter: null };
  }
  if (allowance.isPassCovered) {
    await logCreditGateEvent({
      userId,
      reason: FARAH_CHAT_REASON,
      creditsRequired: 0,
      creditsAvailable: allowance.creditsAvailableAtCheck,
      outcome: "covered_by_pass",
    });
    return { balanceAfter: null };
  }
  const balanceAfter = await spendCredits(userId, allowance.creditsSpent, FARAH_CHAT_REASON);
  return { balanceAfter };
}
