import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The daily ad-campaign charge job.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 *
 * `charge_ad_campaign_day` shipped in 0047 with three passing tests and no
 * caller. Verified 2026-08-26 against the tree, not assumed:
 *
 *     $ grep -rn charge_ad_campaign_day src/
 *     src/lib/supabase/types.ts:1476:      charge_ad_campaign_day: {
 *
 * — the generated type, and nothing else. vercel.json declared three crons,
 * none of them this.
 *
 * The consequence is a money leak, not a stalled feature. `resume_ad_campaign`
 * charges one day at the moment it flips a campaign to `active`, so the
 * campaign was paid for exactly one day and then advertised until its
 * `ends_on` — free. `spent_ngn` stayed at one day's rate, so the budget cap
 * never completed the campaign either. An employer paid ₦1,000 and got a
 * thirty-day run.
 *
 * A tested function nobody calls is indistinguishable from a missing one, and
 * looks better in a coverage report. tests/api/contract.test.ts now asserts
 * the schedule exists, which is the assertion that would have caught it.
 *
 * ── What happens when one charge fails mid-batch ──────────────────────────
 *
 * Read off the SQL in 0047/0046 rather than assumed, because the answer
 * decides whether the loop may continue:
 *
 *   * Insufficient funds is NOT an exception. `debit_ad_wallet` returns
 *     `ok = false` (its conditional UPDATE matching no row IS the
 *     affordability answer), and `charge_ad_campaign_day` turns that into
 *     `status = 'paused_insufficient_funds'` and returns `ok = false`
 *     normally. This is §4 working as designed — stop and surface — and it is
 *     an ordinary outcome for this job, not a failure of it.
 *   * Budget cap reached, or the day is past `ends_on`: `status = 'completed'`,
 *     `ok = true`, nothing charged.
 *   * Already charged for this date: `ok = true`, no-op. Deliberately
 *     idempotent — Vercel Cron delivery is best-effort and may duplicate.
 *   * Not `active` any more: `ok = false` with the campaign's current status,
 *     no charge.
 *
 * Only two things actually throw. `charge_ad_campaign_day` raises when the
 * campaign id does not exist — a real race, since `ad_campaigns` cascades from
 * both `organizations` and `job_postings`, so a campaign can be deleted
 * between this job reading the work-list and calling the RPC. And the
 * transport itself can fail.
 *
 * THE LOOP CONTINUES PAST BOTH. Each `.rpc()` is its own PostgREST request and
 * therefore its own transaction, so an error on campaign N cannot roll back
 * campaigns 1..N-1 — they are already charged and committed. Aborting the
 * batch there would leave the tail still `active` and still unbilled, which is
 * a narrower copy of the exact defect this file fixes. Continuing is the only
 * choice that does not manufacture the bug again.
 *
 * What the batch does NOT do is pretend it was clean: any thrown error, or a
 * failed work-list query, makes `ok` false and the route answer 500, so a
 * scheduler's failure alerting fires. Same convention as runPassRenewalJob.
 * Charges already made stand; the counters in the summary say how many.
 *
 * ── Why the work-list is read fully before anything is charged ────────────
 *
 * The filter is `last_charged_on < today`, and charging a campaign sets
 * `last_charged_on = today` — so a charged row leaves the result set. Paging
 * with OFFSET while mutating that same predicate silently skips a row per
 * page. Ids are collected first, with keyset pagination on `id`, and only
 * then charged.
 *
 * ── Why the job can be scoped to one organisation ─────────────────────────
 *
 * `organizationId` is not a test hook that leaked into the signature. There is
 * no staging database (CLAUDE.md), so an UNSCOPED batch invoked from a test
 * would debit every real employer's wallet on every CI run — and a suite's
 * cleanup cannot undo a charge to a row it did not create.
 *
 * It is also the operational tool the job needs anyway: re-running one
 * employer's charge after a support incident, or charging a single account for
 * a specific missed date, without touching anyone else. The cron path passes
 * no scope and charges everything, which is the only behaviour that bills
 * correctly.
 */

/** UTC, matching Postgres `current_date` on Supabase. See the note in runCampaignChargeJob. */
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

const PAGE_SIZE = 500;

/**
 * supabase-js does not reject on a database error — it RESOLVES with
 * `{ data: null, error }`, where `error` is a plain PostgrestError object and
 * not an `Error` instance. So the usual
 * `err instanceof Error ? err.message : String(err)` turns every genuine
 * Postgres failure into the string "[object Object]", losing the message on
 * exactly the errors worth reading. Caught by
 * tests/billing/campaign-charge-errors.ts, which asserts a "deadlock detected"
 * survives into the summary.
 */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === "string") return code ? `${message} (${String(code)})` : message;
  }
  return String(err);
}

export interface CampaignChargeOptions {
  /** Date to charge for. Defaults to today, UTC. */
  on?: string;
  /** Restrict to one organisation. Omitted by the cron, which must charge all. */
  organizationId?: string;
}

export interface CampaignChargeSummary {
  /** False if anything threw or a query failed — NOT false merely because campaigns paused. */
  ok: boolean;
  /** The date charged for, passed explicitly to the RPC. */
  on: string;
  /** Null for a full run; set when the run was restricted to one organisation. */
  organizationId: string | null;
  considered: number;
  charged: number;
  /**
   * Sum of `daily_rate_ngn` over the campaigns that charged. The RPC returns
   * the balance after, not the amount, but `v_charge := c.daily_rate_ngn`
   * unconditionally and only drafts are client-editable, so the work-list
   * value is the amount taken.
   */
  chargedNgn: number;
  /** §4 working, not a failure: the wallet could not cover a day. */
  pausedInsufficientFunds: number;
  /** Reached the budget cap or ran past `ends_on`. */
  completed: number;
  /** Idempotent no-ops — a duplicate cron delivery, or a same-day resume. */
  alreadyCharged: number;
  /** Raced out of `active` between the work-list read and the lock. */
  skipped: number;
  errors: Array<{ campaignId: string; message: string }>;
  queryErrors: string[];
}

type WorkItem = { id: string; daily_rate_ngn: number };

/**
 * Every `active` campaign not yet charged for `on`.
 *
 * The `last_charged_on` filter is an optimisation that makes a duplicate run
 * cheap and uses `ad_campaigns_chargeable_idx`; it is not the correctness
 * boundary. `charge_ad_campaign_day` re-checks the same condition under
 * `SELECT … FOR UPDATE`, which is what actually stops two concurrent runs from
 * both charging the same day.
 */
async function collectWorkList(
  db: ReturnType<typeof createServiceRoleClient>,
  on: string,
  organizationId: string | null,
  queryErrors: string[],
): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  let after = "00000000-0000-0000-0000-000000000000";

  for (;;) {
    let q = db
      .from("ad_campaigns")
      .select("id, daily_rate_ngn")
      .eq("status", "active")
      .or(`last_charged_on.is.null,last_charged_on.lt.${on}`);
    if (organizationId) q = q.eq("organization_id", organizationId);

    // Keyset, not offset: stable under concurrent inserts, and there is no
    // OFFSET to be shifted by a row leaving the set.
    const { data, error } = await q
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      // A partial work-list is not a clean run. Say so rather than charging
      // the page we got and reporting success.
      queryErrors.push(`work-list page after ${after}: ${messageOf(error)}`);
      break;
    }
    if (!data || data.length === 0) break;

    items.push(...data);
    if (data.length < PAGE_SIZE) break;
    after = data[data.length - 1]!.id;
  }

  return items;
}

export async function runCampaignChargeJob(
  opts: CampaignChargeOptions = {},
): Promise<CampaignChargeSummary> {
  const on = opts.on ?? todayDateOnly();
  const organizationId = opts.organizationId ?? null;
  const db = createServiceRoleClient();
  const summary: CampaignChargeSummary = {
    ok: true,
    on,
    organizationId,
    considered: 0,
    charged: 0,
    chargedNgn: 0,
    pausedInsufficientFunds: 0,
    completed: 0,
    alreadyCharged: 0,
    skipped: 0,
    errors: [],
    queryErrors: [],
  };

  const work = await collectWorkList(db, on, organizationId, summary.queryErrors);
  summary.considered = work.length;

  /*
   * Sequential, deliberately. Campaigns belonging to one organisation all
   * debit the same `ad_wallets` row, and `debit_ad_wallet`'s conditional
   * UPDATE takes a row lock — so concurrency here buys contention on that lock
   * rather than throughput, while making the log unreadable and the failure
   * attribution worse. If this ever becomes the slow part, the fix is batching
   * inside Postgres, not more connections from here.
   */
  for (const item of work) {
    try {
      // The date is passed explicitly rather than left to the function's
      // `current_date` default so the work-list filter and the charge agree on
      // one day. Around 00:00 UTC they otherwise can disagree, and the
      // disagreement is a double charge or a skipped day.
      const { data, error } = await db.rpc("charge_ad_campaign_day", {
        p_campaign_id: item.id,
        p_on_date: on,
      });
      if (error) throw error;

      const row = data?.[0];
      if (!row) throw new Error("charge_ad_campaign_day returned no row");

      /*
       * Classified on (ok, status, balance_after_ngn) together, because no
       * single field separates the five outcomes. `balance_after_ngn` is what
       * splits a real charge from the idempotent no-op: it is only non-null
       * when debit_ad_wallet actually ran.
       *
       * One ambiguity is inherent and left as-is: a campaign this run paused,
       * and a campaign that was ALREADY `paused_insufficient_funds` when the
       * RPC re-read it under lock, return identically. Both are truthfully
       * "now paused for want of funds", so they are counted together.
       */
      if (row.ok && row.status === "active") {
        if (row.balance_after_ngn === null) {
          summary.alreadyCharged += 1;
        } else {
          summary.charged += 1;
          summary.chargedNgn += item.daily_rate_ngn;
        }
      } else if (row.ok && row.status === "completed") {
        summary.completed += 1;
      } else if (!row.ok && row.status === "paused_insufficient_funds") {
        summary.pausedInsufficientFunds += 1;
      } else {
        // Raced out of `active` between the work-list read and the lock —
        // paused by the employer, or reviewed. Nothing was charged.
        summary.skipped += 1;
      }
    } catch (err) {
      // Continue. See the header: the already-charged campaigns are committed,
      // and stopping here would leave the tail live and unbilled.
      summary.errors.push({ campaignId: item.id, message: messageOf(err) });
    }
  }

  summary.ok = summary.errors.length === 0 && summary.queryErrors.length === 0;
  return summary;
}
