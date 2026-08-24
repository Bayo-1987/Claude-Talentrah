import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";

type CreditReason = Database["public"]["Enums"]["credit_reason"];
type GateOutcome = Database["public"]["Enums"]["credit_gate_outcome"];

/**
 * Records that a credit gate was evaluated — whether or not it let the user
 * through.
 *
 * Why this exists: before it, a blocked attempt left no trace anywhere.
 * credit_ledger only gets a row on a *successful* spend, so someone who hit
 * a paywall and bounced was invisible — which is precisely the population
 * worth knowing about pre-monetisation.
 *
 * Written via the service-role client, same as credit_ledger and
 * payment_transactions: RLS gives the authenticated role read-only access to
 * its own rows and no write path at all, so this log can't be forged or
 * cleared by the user it describes.
 *
 * Deliberately best-effort: an instrumentation failure must never break the
 * user's actual action. A dropped analytics row is a much smaller problem
 * than a 500 on a paid action.
 */
/**
 * READING THE FUNNEL (no dashboard — deliberately; there is nothing to plot
 * until real users exist). Run these in the Supabase SQL editor.
 *
 * 1. Where do people first hit a wall, and how close were they?
 *
 *   select reason,
 *          count(*) filter (where outcome = 'blocked_insufficient_credits') as blocked,
 *          count(*) filter (where outcome = 'proceeded')                    as proceeded,
 *          round(avg(credits_required - credits_available)
 *                filter (where outcome = 'blocked_insufficient_credits'), 1) as avg_shortfall
 *   from credit_gate_events
 *   group by reason
 *   order by blocked desc;
 *
 * `avg_shortfall` is the one worth watching: a wall someone missed by 2
 * credits is a pricing/packaging problem, one they missed by 20 is a
 * different problem entirely, and the raw block count can't tell them apart.
 *
 * 2. Top-up conversion — did a block lead to a purchase within 24 hours?
 *
 *   with blocks as (
 *     select user_id, created_at
 *     from credit_gate_events
 *     where outcome = 'blocked_insufficient_credits'
 *   )
 *   select count(*)                                as blocks,
 *          count(t.id)                             as converted_within_24h,
 *          round(100.0 * count(t.id) / nullif(count(*), 0), 1) as pct
 *   from blocks b
 *   left join lateral (
 *     select pt.id from payment_transactions pt
 *     where pt.user_id = b.user_id
 *       and pt.status  = 'success'
 *       and pt.created_at between b.created_at and b.created_at + interval '24 hours'
 *     limit 1
 *   ) t on true;
 *
 * Caveat worth remembering when reading it: this attributes a purchase to
 * the block that preceded it in time, which is correlation, not proof of
 * cause. With one paywall it's a fair proxy; once there are several, a user
 * blocked twice in an hour will credit whichever came last.
 */
export async function logCreditGateEvent(params: {
  userId: string;
  reason: CreditReason;
  creditsRequired: number;
  creditsAvailable: number;
  outcome: GateOutcome;
  relatedEntityId?: string | null;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("credit_gate_events").insert({
      user_id: params.userId,
      reason: params.reason,
      credits_required: params.creditsRequired,
      credits_available: params.creditsAvailable,
      outcome: params.outcome,
      related_entity_id: params.relatedEntityId ?? null,
    });
    if (error) {
      console.error(`[credit-gate] failed to log ${params.reason}/${params.outcome}: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[credit-gate] failed to log ${params.reason}/${params.outcome}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
