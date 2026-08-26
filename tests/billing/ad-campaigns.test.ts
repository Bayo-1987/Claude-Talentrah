/**
 * Ad campaigns: the status state machine, and the money boundary around it.
 *
 * THE CENTRAL PROPERTY. Resuming a paused campaign must not trust the balance
 * that caused the pause. Time passes — but the structural reason is that OTHER
 * CAMPAIGNS IN THE SAME ORGANISATION DRAW FROM THE SAME WALLET, so a
 * remembered balance is stale by construction, not merely by age.
 *
 * Demonstrated against a naive resume before this was written:
 *
 *     wallet ₦1000, campaign paused, daily rate ₦1000
 *     remembered balance at pause: ₦1000 — enough for a day
 *     a sibling campaign then spends the wallet -> ₦0
 *     NAIVE resume: activated on the remembered balance
 *       => RUNNING UNPAID: live on a ₦0 wallet, nothing charged
 *     resume_ad_campaign: ok=false, status=paused_insufficient_funds
 *       => stayed paused, nothing served free
 *
 * `resume_ad_campaign` does not read the balance and decide. It charges a day
 * through `debit_ad_wallet`, whose conditional UPDATE *is* the check — the same
 * shape as 0035 and 0046, for the third time.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB , deleteTestOrgs } from "../support/auth";
import { runCampaignChargeJob } from "@/lib/billing/campaign-charges";

let owner: { id: string; client: DB };
let orgId: string;
let jobId: string;
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

const DAILY = 1000;

async function fund(amount: number) {
  const { error } = await admin.rpc("credit_ad_wallet", {
    p_organization_id: orgId,
    p_amount_ngn: amount,
    p_reason: "topup",
    p_paystack_reference: `t_${randomUUID()}`,
  });
  if (error) throw error;
}

async function makeCampaign(status: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("ad_campaigns")
    .insert({
      organization_id: orgId,
      job_posting_id: jobId,
      name: `Campaign ${randomUUID().slice(0, 6)}`,
      daily_rate_ngn: DAILY,
      total_budget_ngn: DAILY * 30,
      created_by: owner.id,
      status: status as never,
      ...over,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function campaign(id: string) {
  const { data } = await admin
    .from("ad_campaigns")
    .select("status, spent_ngn, last_charged_on")
    .eq("id", id)
    .single();
  return data!;
}

async function walletBalance(): Promise<number> {
  const { data } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
  return data?.balance_ngn ?? 0;
}

beforeEach(async () => {
  if (!owner) {
    owner = await createAuthedTestUser("campaign");
    createdUsers.push(owner.id);
  }
  const { data: org, error } = await admin
    .from("organizations")
    .insert({
      name: `Campaign Co ${randomUUID().slice(0, 8)}`,
      domain: `camp-${randomUUID().slice(0, 8)}.example`,
      created_by: owner.id,
      verified: false,
    })
    .select("id")
    .single();
  if (error) throw error;
  orgId = org.id;
  createdOrgs.push(orgId);
  await admin.from("organization_members").insert({
    organization_id: orgId,
    user_id: owner.id,
    role: "owner",
  });
  const { data: job } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      title: `Campaign Role ${randomUUID().slice(0, 6)}`,
      company_name: "Campaign Co",
      description: "x",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  jobId = job!.id;
}, 60_000);

afterAll(async () => {
  await deleteTestOrgs(createdOrgs);
  await deleteTestUsers(createdUsers);
}, 60_000);

describe("resume re-checks affordability rather than trusting the paused balance", () => {
  it("MONEY: a sibling campaign draining the wallet keeps this one paused", async () => {
    await fund(DAILY); // exactly one day
    const id = await makeCampaign("paused_insufficient_funds");

    // A different campaign in the SAME org spends the wallet first.
    await admin.rpc("debit_ad_wallet", {
      p_organization_id: orgId,
      p_amount_ngn: DAILY,
      p_reason: "campaign_charge",
    });
    expect(await walletBalance()).toBe(0);

    const { data } = await admin.rpc("resume_ad_campaign", {
      p_campaign_id: id,
      p_actor_user_id: owner.id,
    });
    const r = data![0];

    expect(r.ok, "resume must fail when the wallet cannot cover a day").toBe(false);
    expect(
      (await campaign(id)).status,
      "RUNNING UNPAID: the campaign went live on an empty wallet",
    ).toBe("paused_insufficient_funds");
    expect((await campaign(id)).spent_ngn, "nothing should have been recorded as spent").toBe(0);
  });

  it("resumes and charges when the wallet can cover it", async () => {
    // Positive control — "never resume" would satisfy the assertion above.
    await fund(DAILY * 5);
    const id = await makeCampaign("paused_by_employer");

    const { data } = await admin.rpc("resume_ad_campaign", {
      p_campaign_id: id,
      p_actor_user_id: owner.id,
    });
    expect(data![0].ok).toBe(true);

    const c = await campaign(id);
    expect(c.status).toBe("active");
    expect(c.spent_ngn, "resuming charges a day").toBe(DAILY);
    expect(await walletBalance()).toBe(DAILY * 4);
  });

  it("a failed resume from a DELIBERATE pause reports the real reason", async () => {
    /*
     * An employer who paused on purpose and then cannot resume needs to be
     * told it is the money, not their earlier click — otherwise the UI shows
     * "you paused this" next to a button that silently does nothing.
     */
    await fund(DAILY);
    const id = await makeCampaign("paused_by_employer");
    await admin.rpc("debit_ad_wallet", {
      p_organization_id: orgId,
      p_amount_ngn: DAILY,
      p_reason: "campaign_charge",
    });

    await admin.rpc("resume_ad_campaign", { p_campaign_id: id, p_actor_user_id: owner.id });
    expect((await campaign(id)).status).toBe("paused_insufficient_funds");
  });

  it("does not double-charge when the day is already paid for", async () => {
    await fund(DAILY * 5);
    const id = await makeCampaign("active");
    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });
    const afterCharge = await walletBalance();

    await admin.rpc("pause_ad_campaign", { p_campaign_id: id });
    await admin.rpc("resume_ad_campaign", { p_campaign_id: id, p_actor_user_id: owner.id });

    expect((await campaign(id)).status).toBe("active");
    expect(await walletBalance(), "pausing and resuming within a day must be free").toBe(afterCharge);
  });
});

describe("the daily charge", () => {
  it("pauses rather than running unpaid when the wallet is empty", async () => {
    await fund(DAILY);
    const id = await makeCampaign("active");

    const first = await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });
    expect(first.data![0].ok).toBe(true);

    // Next day, no money left.
    await admin.from("ad_campaigns").update({ last_charged_on: "2020-01-01" }).eq("id", id);
    const second = await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });

    expect(second.data![0].ok).toBe(false);
    expect((await campaign(id)).status).toBe("paused_insufficient_funds");
  });

  it("is idempotent — a duplicate cron run does not charge twice", async () => {
    // Vercel Cron delivery is best-effort and may duplicate; the Pass renewal
    // job carries the same caveat.
    await fund(DAILY * 5);
    const id = await makeCampaign("active");
    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });
    const once = await walletBalance();
    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });

    expect(await walletBalance(), "the same day was charged twice").toBe(once);
    expect((await campaign(id)).spent_ngn).toBe(DAILY);
  });

  it("completes rather than overspending the budget cap", async () => {
    await fund(DAILY * 10);
    const id = await makeCampaign("active", { total_budget_ngn: DAILY });
    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });
    await admin.from("ad_campaigns").update({ last_charged_on: "2020-01-01" }).eq("id", id);

    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });
    const c = await campaign(id);
    expect(c.status, "a campaign at its cap must complete, not keep charging").toBe("completed");
    expect(c.spent_ngn).toBe(DAILY);
  });
});

describe("a client cannot move a campaign into a paid state", () => {
  it("cannot jump a draft straight to active", async () => {
    /*
     * The state machine is a trigger, not an app-layer rule, because
     * ad_campaigns has a member-scoped UPDATE policy — an app-layer check
     * would be reachable around with a direct PATCH, the 0037 lesson.
     */
    const id = await makeCampaign("draft");
    const { error } = await owner.client.from("ad_campaigns").update({ status: "active" }).eq("id", id);
    expect(error, "FREE ADS: a client activated its own campaign").not.toBeNull();
    expect((await campaign(id)).status).toBe("draft");
  });

  it("cannot rewrite spent_ngn to reclaim budget", async () => {
    await fund(DAILY * 5);
    const id = await makeCampaign("active");
    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });

    const { error } = await owner.client.from("ad_campaigns").update({ spent_ngn: 0 }).eq("id", id);
    expect(error, "MONEY: a client zeroed its own spend").not.toBeNull();
    expect((await campaign(id)).spent_ngn).toBe(DAILY);
  });

  it("cannot write status at all — not even the submit transition (0048)", async () => {
    /*
     * 0047 tried to allow `draft -> pending_review` from the client and was
     * internally inconsistent: the trigger permitted it, but `status` was
     * never in the column grant, so the branch was unreachable. This test is
     * what found it. 0048 resolved it toward the stricter side — no client
     * writes status, ever — which is what 0047's own comment already claimed.
     */
    const id = await makeCampaign("draft");
    const { error } = await owner.client
      .from("ad_campaigns")
      .update({ status: "pending_review" })
      .eq("id", id);
    expect(error, "status must not be client-writable").not.toBeNull();
    expect((await campaign(id)).status).toBe("draft");

    // The supported path.
    const { data } = await admin.rpc("submit_ad_campaign_for_review", {
      p_campaign_id: id,
      p_actor_user_id: owner.id,
    });
    expect(data).toBe("pending_review");
  });

  it("cannot write its own review decision", async () => {
    const id = await makeCampaign("pending_review");
    const { error } = await owner.client
      .from("ad_campaigns")
      .update({ reviewed_by: owner.id, review_note: "looks good to me" })
      .eq("id", id);
    expect(error, "a client wrote its own review decision").not.toBeNull();
  });

  it("approval does NOT go straight live — it lands paused, so going live always charges", async () => {
    /*
     * Approval says the ad is acceptable; it says nothing about whether the
     * wallet can pay for it. Exactly one path leads from not-running to
     * running, and it charges. Two paths would be two places to forget.
     */
    const id = await makeCampaign("pending_review");
    const { data } = await admin.rpc("set_ad_campaign_review", {
      p_campaign_id: id,
      p_approve: true,
      p_reviewer_id: owner.id,
      p_note: "ok",
    });
    expect(data).toBe("paused_by_employer");
    expect((await campaign(id)).spent_ngn, "approval must not charge").toBe(0);
  });

  it("cannot call the money RPCs directly", async () => {
    const id = await makeCampaign("paused_by_employer");
    const resume = await owner.client.rpc("resume_ad_campaign", {
      p_campaign_id: id,
      p_actor_user_id: owner.id,
    });
    expect(resume.error, "a client resumed its own campaign, bypassing the charge").not.toBeNull();

    const charge = await owner.client.rpc("charge_ad_campaign_day", { p_campaign_id: id });
    expect(charge.error).not.toBeNull();
  });
});

describe("cross-organisation isolation", () => {
  it("cannot create a campaign against another org's posting", async () => {
    /*
     * An ad for a competitor, paid for by the victim. The INSERT policy checks
     * the posting belongs to the same org rather than merely that the actor is
     * a member of the org named in the row.
     */
    const outsider = await createAuthedTestUser("campaign-out");
    createdUsers.push(outsider.id);

    const { data: theirOrg } = await admin
      .from("organizations")
      .insert({
        name: `Outsider Co ${randomUUID().slice(0, 8)}`,
        domain: `out-${randomUUID().slice(0, 8)}.example`,
        created_by: outsider.id,
        verified: false,
      })
      .select("id")
      .single();
    createdOrgs.push(theirOrg!.id);
    await admin.from("organization_members").insert({
      organization_id: theirOrg!.id,
      user_id: outsider.id,
      role: "owner",
    });

    const { error } = await outsider.client.from("ad_campaigns").insert({
      organization_id: theirOrg!.id,
      job_posting_id: jobId, // belongs to the OTHER org
      name: "Ad for someone else's job",
      daily_rate_ngn: DAILY,
      total_budget_ngn: DAILY * 5,
      created_by: outsider.id,
      status: "draft",
    });
    expect(error, "a campaign was created against another org's posting").not.toBeNull();
  });

  it("a non-member cannot read another org's campaigns or spend", async () => {
    await fund(DAILY * 3);
    const id = await makeCampaign("active");
    await admin.rpc("charge_ad_campaign_day", { p_campaign_id: id });

    const outsider = await createAuthedTestUser("campaign-peek");
    createdUsers.push(outsider.id);

    const { data } = await outsider.client
      .from("ad_campaigns")
      .select("name, daily_rate_ngn, spent_ngn")
      .eq("organization_id", orgId);
    expect(
      data ?? [],
      "LEAK: a non-member could read another organisation's ad campaigns and spend",
    ).toHaveLength(0);

    // Positive control.
    const mine = await owner.client.from("ad_campaigns").select("id").eq("organization_id", orgId);
    expect((mine.data ?? []).length, "the owner must still see their own").toBeGreaterThan(0);
  });
});

describe("the batch runner — the caller charge_ad_campaign_day never had", () => {
  /*
   * 0047 shipped the daily charge with three passing tests and nothing calling
   * it. `resume_ad_campaign` charges the day it activates a campaign, so a
   * campaign went live having paid for one day and then advertised until its
   * end date for free — and `spent_ngn` never grew, so the budget cap never
   * completed it either.
   *
   * Every run here is SCOPED to this test's organisation. Unscoped is what the
   * cron does and what bills correctly, but there is no staging database
   * (CLAUDE.md): an unscoped run from a test would debit every real employer's
   * wallet, and no cleanup can undo a charge to a row the suite did not create.
   */
  const on = new Date().toISOString().slice(0, 10);
  const run = () => runCampaignChargeJob({ on, organizationId: orgId });

  it("MONEY: charges an active campaign for the day", async () => {
    await fund(DAILY * 5);
    const id = await makeCampaign("active");

    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.considered).toBe(1);
    expect(summary.charged, "the active campaign was not charged").toBe(1);
    expect(summary.chargedNgn).toBe(DAILY);
    expect(await walletBalance()).toBe(DAILY * 4);

    const c = await campaign(id);
    expect(c.spent_ngn).toBe(DAILY);
    expect(c.last_charged_on).toBe(on);
  });

  it("MONEY: a campaign that cannot be paid does not stop the ones after it", async () => {
    /*
     * The mid-batch failure decision, proven rather than asserted in a comment.
     * Funded for two days, four campaigns: two charge, and the batch must keep
     * going PAST the first failure to reach the fourth. The check is that no
     * campaign is left `active` with nothing charged — an unreached campaign
     * looks exactly like that, and it is the state that bills nobody while
     * still advertising.
     */
    await fund(DAILY * 2);
    const ids = [
      await makeCampaign("active"),
      await makeCampaign("active"),
      await makeCampaign("active"),
      await makeCampaign("active"),
    ];

    const summary = await run();

    expect(summary.considered).toBe(4);
    expect(summary.charged).toBe(2);
    expect(
      summary.pausedInsufficientFunds,
      "the batch stopped at the first unaffordable campaign instead of continuing",
    ).toBe(2);
    // An empty wallet is the designed §4 outcome, not a job failure.
    expect(summary.ok, "pausing is not an error — a 500 here would page someone nightly").toBe(true);
    expect(summary.errors).toEqual([]);
    expect(await walletBalance()).toBe(0);

    const states = await Promise.all(ids.map(campaign));
    expect(
      states.filter((c) => c.status === "active" && c.last_charged_on === null),
      "a campaign was never reached: still active, still unbilled",
    ).toHaveLength(0);
    expect(states.filter((c) => c.status === "paused_insufficient_funds")).toHaveLength(2);
  });

  it("a duplicate delivery the same day charges nothing twice", async () => {
    // Vercel Cron delivery is best-effort and may duplicate.
    await fund(DAILY * 5);
    await makeCampaign("active");

    await run();
    const afterFirst = await walletBalance();
    const second = await run();

    expect(await walletBalance(), "the same day was charged twice").toBe(afterFirst);
    // The work-list filter excludes it, so it is not even considered again.
    // (charge_ad_campaign_day would no-op anyway — that is tested above on the
    //  RPC directly. This asserts the cheaper outer guard also holds.)
    expect(second.considered).toBe(0);
    expect(second.charged).toBe(0);
  });

  it("MONEY: crossing the day boundary charges a second day, exactly once", async () => {
    /*
     * The duplicate-delivery test above proves the SAME day is not charged
     * twice. This is the other half, and it is the half that fails silently:
     * a work-list filter that excluded a campaign too eagerly would look
     * identical to a correctly idempotent one on a single day's run, and only
     * show up as a campaign that never bills again after its first day —
     * which is the original defect wearing a different hat.
     *
     * Driven through the runner's own `on` rather than by backdating the row,
     * so what is exercised is the filter the cron actually runs with.
     */
    await fund(DAILY * 5);
    const id = await makeCampaign("active");

    expect((await run()).charged).toBe(1);
    expect((await campaign(id)).spent_ngn).toBe(DAILY);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const next = await runCampaignChargeJob({ on: tomorrow, organizationId: orgId });

    expect(next.considered, "yesterday's campaign was not picked up the next day").toBe(1);
    expect(next.charged).toBe(1);

    const c = await campaign(id);
    expect(c.spent_ngn, "should be two days in, not one and not three").toBe(DAILY * 2);
    expect(c.last_charged_on).toBe(tomorrow);
    expect(c.status).toBe("active");
    expect(await walletBalance()).toBe(DAILY * 3);
  });

  it("does not touch campaigns that are not active", async () => {
    await fund(DAILY * 5);
    const drafted = await makeCampaign("draft");
    const paused = await makeCampaign("paused_by_employer");
    const review = await makeCampaign("pending_review");

    const summary = await run();

    expect(summary.considered, "the job charged something that was not live").toBe(0);
    expect(await walletBalance()).toBe(DAILY * 5);
    for (const id of [drafted, paused, review]) {
      expect((await campaign(id)).spent_ngn).toBe(0);
    }
  });
});
