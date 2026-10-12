import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The daily paid-hold sweep (FARAH-PAID-HOLD-SWEEP, owner's condition on #908).
 *
 * A PAID Farah message takes its credit at the check and gives it back on every exit that is not a completed reply (src/lib/farah/chat-gate.ts). A process killed between the two leaves the credit taken. This finds
 * those holds and refunds each of them once, so that residual never depends on someone noticing.
 *
 * WHAT IS AN ORPHAN. A spend row (credit_ledger: reason farah_chat_message, delta < 0, related_entity_id = the hold id) that is
 *   - older than 15 minutes (the platform's function limit is 300 s, so the request that made it is long gone), and
 *   - has NO refund row (delta > 0, same reason, same hold id), and
 *   - has NO completion marker. Two independent ones, either means "delivered": a 'proceeded' funnel row carrying the hold id (written at commit) and a saved message whose context carries the hold id (written with the reply).
 * It also catches a refund that itself failed ("REFUND FAILED" in the gate), for free. False refunds are possible only when BOTH completion writes fail for a delivered reply: one credit, the safe direction.
 *
 * "ONCE". A refund goes through grant_credits_atomic with the hold id, and migration 0252's partial unique index allows only one positive row per hold id: a second refund (another sweep running at the same time, or the
 * route's own release racing a sweep) raises 23505 and rolls back whole, balance increase included. That is counted as "already refunded", not as a failure.
 *
 * Reads are batched (one query per kind for up to 100 holds), nothing is read per row. Bounded to the last 7 days, 100 per run; a bigger backlog drains over the following runs.
 */
export const PAID_HOLD_SWEEP_MIN_AGE_MINUTES = 15;
export const PAID_HOLD_SWEEP_LOOKBACK_DAYS = 7;
export const PAID_HOLD_SWEEP_BATCH = 100;
const REASON = "farah_chat_message" as const;

type Db = SupabaseClient<Database>;

export interface PaidHoldSweepSummary {
  /** False when a read failed or any refund failed: a run that skipped holds must not look clean. */
  ok: boolean;
  readError?: string;
  /** Paid-message spend rows looked at this run. */
  examined: number;
  /** Of those, the ones with neither a refund nor a completion marker. */
  orphaned: number;
  /** Refunded by THIS run. */
  refunded: number;
  /** Refused by the unique index because another delivery of the refund got there first. */
  alreadyRefunded: number;
  failed: number;
}

export async function sweepPaidHolds(opts: { now?: Date; supabase?: Db } = {}): Promise<PaidHoldSweepSummary> {
  const supabase = opts.supabase ?? createServiceRoleClient();
  const now = opts.now ?? new Date();
  const summary: PaidHoldSweepSummary = { ok: true, examined: 0, orphaned: 0, refunded: 0, alreadyRefunded: 0, failed: 0 };
  const done = (): PaidHoldSweepSummary => {
    if (summary.failed > 0) summary.ok = false;
    // Counts only: no user id, no hold id, no text.
    console.info(`[farah-paid-hold-sweep] examined=${summary.examined} orphaned=${summary.orphaned} refunded=${summary.refunded} already=${summary.alreadyRefunded} failed=${summary.failed}`);
    return summary;
  };
  const readFailed = (message: string): PaidHoldSweepSummary => {
    summary.ok = false;
    summary.readError = message;
    console.error(`[farah-paid-hold-sweep] could not read the work list: ${message}`);
    return done();
  };

  const olderThan = new Date(now.getTime() - PAID_HOLD_SWEEP_MIN_AGE_MINUTES * 60_000).toISOString();
  const newerThan = new Date(now.getTime() - PAID_HOLD_SWEEP_LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data: spends, error: spendError } = await supabase
    .from("credit_ledger")
    .select("user_id, delta, related_entity_id")
    .eq("reason", REASON)
    .lt("delta", 0)
    .not("related_entity_id", "is", null)
    .lt("created_at", olderThan)
    .gt("created_at", newerThan)
    .order("created_at", { ascending: true })
    .limit(PAID_HOLD_SWEEP_BATCH);
  if (spendError) return readFailed(spendError.message);

  // A spend whose owner is gone (user_id null since 0209) has nobody to refund; it is not counted.
  const holds = (spends ?? []).filter((s): s is { user_id: string; delta: number; related_entity_id: string } => typeof s.related_entity_id === "string" && typeof s.user_id === "string");
  summary.examined = holds.length;
  if (holds.length === 0) return done();
  const ids = holds.map((h) => h.related_entity_id);

  const [refunds, gateMarkers, messageMarkers] = await Promise.all([
    supabase.from("credit_ledger").select("related_entity_id").eq("reason", REASON).gt("delta", 0).in("related_entity_id", ids),
    supabase.from("credit_gate_events").select("related_entity_id").eq("reason", REASON).eq("outcome", "proceeded").in("related_entity_id", ids),
    supabase.from("farah_messages").select("context").in("context->>hold" as never, ids),
  ]);
  const failedRead = refunds.error ?? gateMarkers.error ?? messageMarkers.error;
  if (failedRead) return readFailed(failedRead.message);

  const settled = new Set<string>();
  for (const r of refunds.data ?? []) if (r.related_entity_id) settled.add(r.related_entity_id);
  for (const g of gateMarkers.data ?? []) if (g.related_entity_id) settled.add(g.related_entity_id);
  for (const m of messageMarkers.data ?? []) {
    const hold = (m.context as { hold?: unknown } | null)?.hold;
    if (typeof hold === "string") settled.add(hold);
  }

  const orphans = holds.filter((h) => !settled.has(h.related_entity_id));
  summary.orphaned = orphans.length;

  for (const o of orphans) {
    const { error } = await supabase.rpc("grant_credits_atomic", {
      p_user_id: o.user_id,
      p_amount: -o.delta,
      p_reason: REASON,
      p_related_entity_id: o.related_entity_id,
    });
    if (!error) summary.refunded += 1;
    else if (error.code === "23505") summary.alreadyRefunded += 1;
    else {
      summary.failed += 1;
      console.error(`[farah-paid-hold-sweep] a refund failed (code ${error.code ?? "none"})`);
    }
  }
  return done();
}
