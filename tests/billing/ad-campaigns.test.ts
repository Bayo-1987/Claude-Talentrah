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
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { chargeActiveCampaigns } from "@/lib/billing/campaign-charge";

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
  if (createdOrgs.length) await admin.from("organizations").delete().in("id", createdOrgs);
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

/**
 * The daily charge BATCH — the caller that was missing.
 *
 * The block above proves `charge_ad_campaign_day` is correct. It was correct
 * and it had no caller: `grep -rn charge_ad_campaign_day src/` matched only
 * the generated type, and vercel.json scheduled three crons, none of them this
 * one. So a campaign was charged exactly once — by `resume_ad_campaign`, on
 * the day the employer started it — and then ran free until its end date.
 *
 * That is why these tests target the batch rather than the function. A correct
 * function nobody calls is indistinguishable, from the wallet's point of view,
 * from a broken one.
 *
 * SCOPED TO THIS TEST'S ORG ON PURPOSE. There is no staging database
 * (CLAUDE.md); this runs against production. An unscoped batch here would
 * debit real employers' wallets.
 */
describe("the daily charge batch", () => {
  it("MONEY: two active campaigns are each charged exactly once per day", async () => {
    await fund(DAILY * 10);
    const a = await makeCampaign("active");
    const b = await makeCampaign("active");
    const before = await walletBalance();

    const first = await chargeActiveCampaigns({ organizationId: orgId });
    expect(first.charged, "both campaigns should have been charged").toBe(2);

    for (const id of [a, b]) {
      const c = await campaign(id);
      expect(c.status, `${id} should still be running`).toBe("active");
      expect(c.spent_ngn, `${id} should have been charged one day`).toBe(DAILY);
      expect(c.last_charged_on).not.toBeNull();
    }
    expect(await walletBalance()).toBe(before - DAILY * 2);

    // The day boundary has NOT passed, so a second run inside the same day is
    // the duplicate-cron case: it must charge nothing.
    const second = await chargeActiveCampaigns({ organizationId: orgId });
    expect(second.charged, "a same-day re-run must not charge again").toBe(0);
    expect(second.alreadyCharged).toBe(2);
    expect(await walletBalance()).toBe(before - DAILY * 2);

    for (const id of [a, b]) {
      expect((await campaign(id)).spent_ngn, `${id} double-charged`).toBe(DAILY);
    }
  });

  it("MONEY: crossing the day boundary charges a second day, once", async () => {
    await fund(DAILY * 10);
    // Backdated `last_charged_on` is how a day boundary is crossed without
    // waiting for one: the function's guard is `last_charged_on >= p_on_date`,
    // so yesterday's stamp is exactly the state a campaign is in when the cron
    // fires the next morning.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const id = await makeCampaign("active", { last_charged_on: yesterday, spent_ngn: DAILY });
    const before = await walletBalance();

    expect((await chargeActiveCampaigns({ organizationId: orgId })).charged).toBe(1);
    const c = await campaign(id);
    expect(c.spent_ngn, "should now be two days in").toBe(DAILY * 2);
    expect(c.status).toBe("active");
    expect(await walletBalance()).toBe(before - DAILY);
  });

  it("MONEY: a campaign that cannot afford the day is paused, never left active and unbilled", async () => {
    // Deliberately unfunded. This is the exact shape of the defect: the wrong
    // outcome is not an exception, it is a campaign that stays `active` with
    // `spent_ngn` unchanged — serving ads nobody paid for.
    const id = await makeCampaign("active");
    expect(await walletBalance()).toBe(0);

    const summary = await chargeActiveCampaigns({ organizationId: orgId });
    expect(summary.pausedInsufficientFunds).toBe(1);
    expect(summary.charged).toBe(0);

    const c = await campaign(id);
    expect(c.status, "RUNNING UNPAID: still active on an empty wallet").toBe(
      "paused_insufficient_funds",
    );
    expect(c.spent_ngn).toBe(0);
    expect(await walletBalance()).toBe(0);
  });

  it("one broke advertiser does not stop everyone else being billed", async () => {
    /*
     * The batch charges per campaign and tallies failures rather than
     * aborting. If it threw on the first unaffordable campaign, a single
     * employer with an empty wallet would silently stop billing for every
     * other advertiser — an outage that costs revenue and looks like nothing
     * at all until someone reads the logs.
     */
    const broke = await makeCampaign("active", { daily_rate_ngn: DAILY * 100, total_budget_ngn: DAILY * 1000 });
    const fine = await makeCampaign("active");
    await fund(DAILY * 2);

    const summary = await chargeActiveCampaigns({ organizationId: orgId });
    expect(summary.pausedInsufficientFunds).toBe(1);
    expect(summary.charged, "the affordable campaign must still be charged").toBe(1);
    expect((await campaign(broke)).status).toBe("paused_insufficient_funds");
    expect((await campaign(fine)).status).toBe("active");
    expect((await campaign(fine)).spent_ngn).toBe(DAILY);
  });

  it("does not touch campaigns that are not active", async () => {
    await fund(DAILY * 10);
    const before = await walletBalance();
    const paused = await makeCampaign("paused_by_employer");
    const review = await makeCampaign("pending_review");
    const draft = await makeCampaign("draft");

    const summary = await chargeActiveCampaigns({ organizationId: orgId });
    expect(summary.considered, "only active campaigns are candidates").toBe(0);
    expect(await walletBalance()).toBe(before);
    for (const id of [paused, review, draft]) {
      expect((await campaign(id)).spent_ngn).toBe(0);
    }
  });
});
