import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The daily ad-campaign charge.
 *
 * WHY THIS EXISTS. `resume_ad_campaign` debits the wallet for the day it is
 * called and sets the campaign `active`. Nothing then charged it again:
 * `charge_ad_campaign_day` shipped in 0047 with three passing tests and no
 * caller, and `vercel.json` scheduled three crons, none of them this one. The
 * observable effect was that an employer paid one day's rate and advertised
 * until their end date. This is the missing caller.
 *
 * WHY A LIB AND NOT JUST A ROUTE. This project has no staging database
 * (CLAUDE.md) — the suites run against production. A test that invoked an
 * unscoped "charge every active campaign" batch would debit real employers'
 * wallets. `organizationId` exists so the test can exercise the real batch
 * against only its own throwaway org. The cron calls it with no scope.
 *
 * It is not test-only scaffolding: re-running the charge for one advertiser
 * after fixing their wallet is a real operator need, and the route exposes it
 * on the admin POST for exactly that.
 */

export interface ChargeSummary {
  considered: number;
  charged: number;
  /** Already paid for today — a duplicate run, not a failure. */
  alreadyCharged: number;
  pausedInsufficientFunds: number;
  completed: number;
  failed: number;
}

export async function chargeActiveCampaigns(
  opts: { organizationId?: string } = {},
): Promise<ChargeSummary> {
  const supabase = createServiceRoleClient();

  let query = supabase.from("ad_campaigns").select("id").eq("status", "active");
  if (opts.organizationId) query = query.eq("organization_id", opts.organizationId);

  const { data: campaigns, error } = await query;
  if (error) throw error;

  const summary: ChargeSummary = {
    considered: campaigns?.length ?? 0,
    charged: 0,
    alreadyCharged: 0,
    pausedInsufficientFunds: 0,
    completed: 0,
    failed: 0,
  };

  for (const c of campaigns ?? []) {
    /*
     * WHY ONE FAILURE DOES NOT STOP THE BATCH. A campaign whose wallet cannot
     * cover the day is not an error: charge_ad_campaign_day sets it to
     * `paused_insufficient_funds` and returns ok = false rather than raising.
     * Aborting on that would let one broke advertiser stop every other
     * campaign from being billed — an outage that costs revenue and is
     * invisible until someone reads the logs.
     *
     * The function raises in exactly one case: the campaign disappeared
     * between this select and the function's row lock. That is a race, not a
     * policy outcome, so it is caught per-campaign and counted, same
     * reasoning one level up.
     */
    try {
      /*
       * p_on_date is deliberately NOT passed. The function defaults it to
       * Postgres's current_date, and a date computed in JS could disagree
       * across a timezone or a midnight-adjacent run. The idempotency guard is
       * `last_charged_on >= p_on_date`, so a date drifting one day backwards
       * would charge a second time for a day already paid for. One clock
       * decides, and it is the one holding the row lock.
       */
      const { data, error: rpcError } = await supabase.rpc("charge_ad_campaign_day", {
        p_campaign_id: c.id,
      });
      if (rpcError) {
        summary.failed += 1;
        console.error(`[campaign-charge] ${c.id}: ${rpcError.message}`);
        continue;
      }
      const row = data?.[0];
      if (!row) {
        summary.failed += 1;
        continue;
      }
      if (row.status === "paused_insufficient_funds") summary.pausedInsufficientFunds += 1;
      else if (row.status === "completed") summary.completed += 1;
      // A no-op duplicate returns ok with a null balance; a real charge always
      // reports the balance it left behind. That is the only thing separating
      // the two, so it is what the tally reads.
      else if (row.ok && row.balance_after_ngn === null) summary.alreadyCharged += 1;
      else if (row.ok) summary.charged += 1;
      else summary.failed += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`[campaign-charge] ${c.id}:`, err);
    }
  }

  return summary;
}
