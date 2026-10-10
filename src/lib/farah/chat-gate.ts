import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { farahMessageCharge } from "@/lib/credits/farah-message-charge";
import { spendCredits, grantCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { randomUUID } from "node:crypto";
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
import { FARAH_CHAT_FREE_ALLOWANCE, FARAH_CHAT_FREE_WINDOW_DAYS, FARAH_FREE_CLAIM_HOLD_SECONDS, freeWindowStart, nextFreeMessageAt } from "@/lib/farah/free-allowance";
import { MISSING_OBJECT_CODES } from "@/lib/farah/spend-ceiling";
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
  /**
   * Set only when this free message holds a pending claim (migration 0236). The route must SETTLE it: commit it after a completed reply (commitFarahChatAllowance does) or release it
   * (releaseFarahChatAllowance) after any other way out; a claim nobody settles expires by itself after FARAH_FREE_CLAIM_HOLD_SECONDS. Absent for a paid or Pass message, and for a free message
   * on the old check-then-commit path (the claim function was missing).
   */
  freeClaimId?: string;
  /**
   * Set only for a PAID message: its credit was TAKEN at the check (see checkFarahChatAllowance), before any model call. The route must SETTLE it like a free claim: commitFarahChatAllowance after a
   * completed reply (nothing more is charged), releaseFarahChatAllowance on every other way out (the credit is given back). `balanceAfter` is the ledger's own balance_after for that spend;
   * `holdId` is written to BOTH ledger rows (the spend and any refund) as related_entity_id, and to the content-free log lines, so a hold can be followed.
   */
  paidHold?: { credits: number; balanceAfter: number; holdId: string };
}

/**
 * The free-message claim (0236), asked for BEFORE the model call and only when the count says a free message is left. `claimed`: this request holds the slot. `lost`: the slot went to someone else
 * (or the claim could not be made: a failure closes, like a failed count), so the request is handled exactly as if the free messages were already used up. `legacy`: the function does not exist yet
 * (the migration is not applied), so the old check-then-commit path is used rather than turning every free message into a paid one.
 */
type FreeClaim = { kind: "claimed"; id: string; usedAfter: number } | { kind: "lost" } | { kind: "legacy" };
type ClaimRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
// The generated Database types do not list the claim functions until they are regenerated after 0236.
const rpcOf = (supabase: ReturnType<typeof createServiceRoleClient>): ClaimRpc => supabase.rpc.bind(supabase) as unknown as ClaimRpc;

async function claimFreeMessage(userId: string): Promise<FreeClaim> {
  // supabase-js's rpc() returns a thenable that is NOT a Promise (no .catch), so the call is awaited inside try/catch.
  let data: unknown;
  let error: { message: string; code?: string } | null;
  try {
    ({ data, error } = await rpcOf(createServiceRoleClient())("claim_farah_free_message", {
      p_user_id: userId,
      p_allowance: FARAH_CHAT_FREE_ALLOWANCE,
      p_window_days: FARAH_CHAT_FREE_WINDOW_DAYS,
      p_hold_seconds: FARAH_FREE_CLAIM_HOLD_SECONDS,
    }));
  } catch (err) {
    data = null;
    error = { message: String(err), code: "thrown" };
  }
  if (error) {
    if (error.code && MISSING_OBJECT_CODES.has(error.code)) {
      console.error(`[farah-chat-gate] free claim function missing (code=${error.code}): migration 0236 may not be applied; using the check-then-commit path`);
      return { kind: "legacy" };
    }
    console.error(`[farah-chat-gate] free claim failed (code=${error.code ?? "none"})`);
    return { kind: "lost" };
  }
  const row = Array.isArray(data) ? (data[0] as { ok?: unknown; claim_id?: unknown; used?: unknown } | undefined) : undefined;
  if (row && row.ok === true && typeof row.claim_id === "string" && typeof row.used === "number") return { kind: "claimed", id: row.claim_id, usedAfter: row.used };
  return { kind: "lost" };
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
 * Rolling, not a calendar month: a free message returns 30 days after it was logged, and a person is free again once fewer than 3 are inside the window, so it is the (n - 3 + 1)th oldest of the n
 * inside it, plus 30 days (`nextFreeMessageAt`, free-allowance.ts, which shares the window edge with the count above). That row is the 3rd NEWEST for every n >= 3 (the oldest when n is 3, the second
 * oldest when n is 4), so this reads only the 3 newest in-window rows, newest first: no bound to hit and at most 3 rows however many there are. n can be above 3 because parallel requests can over-commit
 * (characterised in chat-gate-concurrent-commit.test.ts; possible today and NOT fixed here), which is why taking the oldest row alone would be wrong. It ignores a Pass: a Pass holder's free messages still come back on this schedule; whether to SHOW it is the caller's decision (the history route reports no free count for a
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
    .order("created_at", { ascending: false })
    .limit(FARAH_CHAT_FREE_ALLOWANCE);
  if (error) {
    console.error(`[farah-chat-gate] could not read when the next free message returns: ${error.message}`);
    return null;
  }
  const at = nextFreeMessageAt((data ?? []).map((r) => r.created_at), now);
  return at ? at.toISOString() : null;
}

/**
 * The entitlement gate — call BEFORE askFarahChat/askFarahChatStream, and settle what it returns: commitFarahChatAllowance after a completed reply, releaseFarahChatAllowance on every other exit.
 *
 * A FREE message holds a claim on a free slot (0236). A PAID message now takes its credit HERE, in the one atomic spend (spend_credits_atomic, 0035), instead of after the reply. The old order was
 * check the balance, stream the reply, then spend: two tabs at a balance of 1 both passed the check, both streamed a full reply, and the loser's spend threw inside the stream after its reply had
 * already been read, so that reply was free and was never saved. Spending first makes the loser's spend fail BEFORE any model call or streaming (the route answers 402). The credit is given back
 * (grantCredits, same reason) by the release on every exit that is not a completed reply: a failed model call, a cut-off reply, a reader that went away, an early refusal.
 *
 * RESIDUAL WINDOW, stated plainly: a paid hold has no expiry (the free claim expires by itself in the database after FARAH_FREE_CLAIM_HOLD_SECONDS; a paid hold would need its own table and a
 * migration). If the process is killed between the spend and the release (a platform timeout or a crash mid-stream), the credit is not given back. Before this change that failure charged nothing.
 * It is bounded to one credit per killed request and is findable: every hold writes a content-free "[farah-paid-hold]" line when it starts and when it completes or is released, and both ledger rows
 * carry the same related_entity_id (the hold id), so a spend row with no refund row and no saved reply can be found by a read-only comparison.
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
  let freeLeft = Math.max(0, FARAH_CHAT_FREE_ALLOWANCE - used);
  // The count above is a cheap read and only a pre-filter: when it says a free message is left, the slot is CLAIMED here, in one locked step in the database, before the model is called (0236). A request
  // that loses the claim goes down the Pass / credits / refusal path exactly as if the free messages were already used; one that wins carries the claim to the route to settle.
  let freeClaimId: string | undefined;
  if (freeLeft > 0) {
    const claim = await claimFreeMessage(userId);
    if (claim.kind === "claimed") {
      freeClaimId = claim.id;
      freeLeft = Math.max(0, FARAH_CHAT_FREE_ALLOWANCE - (claim.usedAfter - 1)); // the claim's own count includes the messages in flight
    } else if (claim.kind === "lost") {
      freeLeft = 0;
    }
  }
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
      ...(freeClaimId ? { freeClaimId } : {}),
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

  // The credit is taken NOW (see the header): one atomic spend before any model call. The loser of a race for the last credit fails here and is refused like any other unaffordable message.
  const holdId = randomUUID();
  let balanceAfter: number;
  try {
    balanceAfter = await spendCredits(userId, charge.credits, FARAH_CHAT_REASON, holdId);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      await logCreditGateEvent({
        userId,
        reason: FARAH_CHAT_REASON,
        creditsRequired: err.required,
        creditsAvailable: err.available,
        outcome: "blocked_insufficient_credits",
      });
      throw new InsufficientCreditsError(err.required, err.available, coverage && !coverage.covered && coverage.reason === "daily_cap_reached" ? DAILY_CAP_MESSAGE : undefined);
    }
    throw err;
  }
  console.info(`[farah-paid-hold] started hold=${holdId} credits=${charge.credits}`);

  // A credit spend is logged as 'proceeded' immediately, unlike the two capped-resource branches above: nothing about this outcome is capped.
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
    paidHold: { credits: charge.credits, balanceAfter, holdId },
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
  if (allowance.isFreeAllowance && allowance.freeClaimId) {
    // The claim becomes the free-allowance event in the database, in one statement (0236). It never turns a delivered reply into an error: a claim that had already expired (the slot may be someone
    // else's) or a failed call leaves the message unrecorded, which is the direction a failure here has always gone (the reply is still delivered, nothing is charged).
    try {
      const { data, error } = await rpcOf(createServiceRoleClient())("commit_farah_free_claim", { p_claim_id: allowance.freeClaimId, p_user_id: userId, p_credits_available: allowance.creditsAvailableAtCheck });
      if (error) console.error(`[farah-chat-gate] a free claim could not be recorded (code=${error.code ?? "none"})`);
      else if (data !== true) console.error("[farah-chat-gate] a free claim could not be recorded (expired or already settled)");
    } catch {
      console.error("[farah-chat-gate] a free claim could not be recorded (code=thrown)");
    }
    return { balanceAfter: null };
  }
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
  if (allowance.paidHold) {
    // The credit was taken at the check and the reply is complete: nothing more to charge. The balance reported is the ledger's own balance_after for that spend.
    console.info(`[farah-paid-hold] completed hold=${allowance.paidHold.holdId}`);
    return { balanceAfter: allowance.paidHold.balanceAfter };
  }
  // An allowance that carries no hold (built by hand; the check always sets one for a paid message) is charged here, as before.
  const balanceAfter = await spendCredits(userId, allowance.creditsSpent, FARAH_CHAT_REASON);
  return { balanceAfter };
}

/**
 * Gives a held free-message claim back (0236): call it on every way out of the route that is NOT a completed reply (a failure, a cut-off reply, a reader that went away, an early refusal), so a
 * message that never happened never uses a free slot. A paid, Pass or legacy free message holds no claim and this does nothing. It never throws: if the release itself fails, the claim expires by
 * itself after FARAH_FREE_CLAIM_HOLD_SECONDS, and one content-free line says so.
 */
export async function releaseFarahChatAllowance(userId: string, allowance: FarahChatAllowanceResult): Promise<void> {
  if (allowance.paidHold) {
    // Give the credit taken at the check back. Never throws: a refund that fails is logged loudly (the one case an account is left a credit short) and the exit it belongs to carries on.
    const { credits, holdId } = allowance.paidHold;
    try {
      await grantCredits(userId, credits, FARAH_CHAT_REASON, holdId);
      console.info(`[farah-paid-hold] released hold=${holdId} credits=${credits}`);
    } catch {
      console.error(`[farah-paid-hold] REFUND FAILED hold=${holdId} credits=${credits}: the credit taken for a message that was not delivered was not given back`);
    }
    return;
  }
  if (!allowance.freeClaimId) return;
  try {
    const { error } = await rpcOf(createServiceRoleClient())("release_farah_free_claim", { p_claim_id: allowance.freeClaimId, p_user_id: userId });
    if (error) console.error(`[farah-chat-gate] could not release a free claim (code=${error.code ?? "none"}); it expires by itself`);
  } catch {
    console.error("[farah-chat-gate] could not release a free claim (code=thrown); it expires by itself");
  }
}
