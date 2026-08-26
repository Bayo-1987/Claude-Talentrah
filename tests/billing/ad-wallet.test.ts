/**
 * The ad wallet: atomic debit, idempotent credit, and a locked-down balance.
 *
 * WHY THE CONCURRENCY TEST COMES FIRST. `spend_credits_atomic` (0035) exists
 * because a read-then-write decrement looked correct for months while letting
 * two concurrent spends both succeed at `balance == cost`. The wallet is the
 * same shape with larger numbers, so the race was reproduced against a
 * throwaway wallet BEFORE this schema was written, using the naive JS
 * implementation someone would reach for:
 *
 *     wallet ₦5000, two concurrent debits of ₦5000
 *       debits that SUCCEEDED: 2 of 2
 *       balance after:         ₦0
 *       charged for: ₦10000   actually taken: ₦5000
 *       => RACE: ₦5000 served free
 *
 * `debit_ad_wallet` does the check and the decrement in one conditional
 * UPDATE, so that cannot happen. These tests are what keep it that way.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";

let orgId: string;
let owner: { id: string; client: DB };
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function makeWalletOrg(): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .insert({
      name: `Wallet Test Co ${randomUUID().slice(0, 8)}`,
      domain: `wallet-${randomUUID().slice(0, 8)}.example`,
      created_by: owner.id,
      verified: false,
    })
    .select("id")
    .single();
  if (error) throw error;
  createdOrgs.push(data.id);
  await admin.from("organization_members").insert({
    organization_id: data.id,
    user_id: owner.id,
    role: "owner",
  });
  return data.id;
}

async function fund(org: string, amount: number, ref?: string) {
  const { data, error } = await admin.rpc("credit_ad_wallet", {
    p_organization_id: org,
    p_amount_ngn: amount,
    p_reason: "topup",
    p_paystack_reference: ref ?? `topup_${randomUUID()}`,
  });
  if (error) throw error;
  return data![0];
}

async function debit(org: string, amount: number) {
  const { data, error } = await admin.rpc("debit_ad_wallet", {
    p_organization_id: org,
    p_amount_ngn: amount,
    p_reason: "campaign_charge",
  });
  if (error) throw error;
  return data![0];
}

async function balanceOf(org: string): Promise<number> {
  const { data } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", org).single();
  return data?.balance_ngn ?? -1;
}

async function ledgerSum(org: string): Promise<number> {
  const { data } = await admin.from("ad_wallet_ledger").select("delta_ngn").eq("organization_id", org);
  return (data ?? []).reduce((s, r) => s + r.delta_ngn, 0);
}

beforeEach(async () => {
  if (!owner) {
    const u = await createAuthedTestUser("adwallet");
    owner = u;
    createdUsers.push(u.id);
  }
  orgId = await makeWalletOrg();
}, 60_000);

afterAll(async () => {
  if (createdOrgs.length) await admin.from("organizations").delete().in("id", createdOrgs);
  await deleteTestUsers(createdUsers);
}, 60_000);

describe("debit_ad_wallet is atomic", () => {
  it("MONEY: two concurrent debits at balance == cost, exactly one succeeds", async () => {
    const COST = 5000;
    await fund(orgId, COST);

    const results = await Promise.all([debit(orgId, COST), debit(orgId, COST)]);
    const ok = results.filter((r) => r.ok).length;

    expect(
      ok,
      "RACE: both debits succeeded — a campaign charge was delivered and paid for by nobody",
    ).toBe(1);
    expect(await balanceOf(orgId)).toBe(0);
    expect(await ledgerSum(orgId), "the ledger must reconcile with the balance").toBe(0);
  });

  it("ten concurrent debits against a balance affording three: exactly three succeed", async () => {
    const COST = 2000;
    await fund(orgId, COST * 3);

    const results = await Promise.all(Array.from({ length: 10 }, () => debit(orgId, COST)));
    const ok = results.filter((r) => r.ok).length;

    expect(ok, `CAP BREACH: ${ok} of 10 got through a balance affording 3`).toBe(3);
    expect(await balanceOf(orgId)).toBe(0);
    expect(await ledgerSum(orgId)).toBe(0);
  });

  it("no lost decrement: affordable concurrent debits all land", async () => {
    // The other half of the 0035 bug — both succeeded but only one deduction
    // stuck. Four affordable debits must remove four costs.
    const COST = 1000;
    await fund(orgId, 20_000);
    const results = await Promise.all(Array.from({ length: 4 }, () => debit(orgId, COST)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await balanceOf(orgId), "a decrement was lost to a concurrent write").toBe(16_000);
    expect(await ledgerSum(orgId)).toBe(16_000);
  });

  it("refuses a debit the balance cannot cover, and reports it rather than throwing", async () => {
    // §4: the affordability answer IS this returning ok:false. There is no
    // separate 'can we afford it' check to race against.
    await fund(orgId, 1000);
    const r = await debit(orgId, 5000);
    expect(r.ok).toBe(false);
    expect(r.balance_after_ngn, "an unaffordable debit must not move the balance").toBe(1000);
    expect(await ledgerSum(orgId)).toBe(1000);
  });

  it("refuses a non-positive amount rather than treating it as a credit", async () => {
    await fund(orgId, 1000);
    await expect(debit(orgId, 0)).rejects.toThrow();
    await expect(debit(orgId, -5000)).rejects.toThrow();
    expect(await balanceOf(orgId), "a negative debit must not top the wallet up").toBe(1000);
  });
});

describe("credit_ad_wallet is idempotent on the Paystack reference", () => {
  it("a redelivered webhook does not double-credit", async () => {
    // Paystack retries. Crediting twice for one payment is the mirror of the
    // debit race and just as real.
    const ref = `topup_${randomUUID()}`;
    const first = await fund(orgId, 10_000, ref);
    expect(first.already_applied).toBe(false);

    const second = await fund(orgId, 10_000, ref);
    expect(second.already_applied, "the repeat must be recognised, not re-applied").toBe(true);

    expect(await balanceOf(orgId), "DOUBLE CREDIT: one payment funded the wallet twice").toBe(10_000);
    const { data: rows } = await admin
      .from("ad_wallet_ledger")
      .select("id")
      .eq("paystack_reference", ref);
    expect(rows ?? [], "exactly one ledger row per payment").toHaveLength(1);
  });

  it("distinct payments both credit", async () => {
    await fund(orgId, 10_000);
    await fund(orgId, 5_000);
    expect(await balanceOf(orgId)).toBe(15_000);
  });
});

describe("the low-balance signal (§7.3)", () => {
  it("fires on the debit that crosses 20% of the last top-up", async () => {
    await fund(orgId, 10_000); // threshold: 2000 remaining

    const above = await debit(orgId, 7_000); // leaves 3000 — above the line
    expect(above.low_balance, "3000 of 10000 is above the 20% line").toBe(false);

    const crossing = await debit(orgId, 1_500); // leaves 1500 — below
    expect(crossing.low_balance, "1500 of 10000 is below the 20% line").toBe(true);
  });

  it("a fresh top-up resets the baseline", async () => {
    await fund(orgId, 10_000);
    await debit(orgId, 9_000);
    await fund(orgId, 50_000); // new baseline: threshold is now 10_000
    const r = await debit(orgId, 1_000);
    expect(r.low_balance, "51000 remaining against a 50000 top-up is not low").toBe(false);
  });
});

describe("the balance is not the client's to write", () => {
  it("an org member can READ their wallet but cannot write any column", async () => {
    /*
     * The class this repo has hit five times (0028/0030/0031/0041/0045). RLS
     * row policies do not restrict columns, so the grant is revoked outright
     * with no column grant back — there is no column here a client should set.
     */
    await fund(orgId, 10_000);

    const read = await owner.client.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId);
    expect(read.data ?? [], "an org member should be able to see their own balance").toHaveLength(1);

    const write = await owner.client
      .from("ad_wallets")
      .update({ balance_ngn: 999_999 })
      .eq("organization_id", orgId);
    expect(write.error, "MONEY: a client topped up their own wallet for free").not.toBeNull();

    expect(await balanceOf(orgId), "the balance must be unchanged").toBe(10_000);
  });

  it("a client cannot forge a ledger entry", async () => {
    await fund(orgId, 1000);
    const { error } = await owner.client.from("ad_wallet_ledger").insert({
      organization_id: orgId,
      delta_ngn: 500_000,
      reason: "topup",
      balance_after_ngn: 501_000,
    });
    expect(error, "MONEY: a client wrote its own ledger entry").not.toBeNull();
    expect(await balanceOf(orgId)).toBe(1000);
  });

  it("a NON-member cannot see another organisation's balance or ledger", async () => {
    /*
     * The read side. The write lockdown above says nothing about who can look:
     * `ad_wallets` is readable through an `is_org_member` policy, and a policy
     * that is subtly wrong leaks how much every competitor is spending on ads —
     * commercially sensitive in a way a job posting is not.
     *
     * Same shape as tests/rls/cross-user.test.ts, which exists because this
     * repo has found three org-scoping holes (0026, 0027, 0028) by asking
     * exactly this question.
     */
    await fund(orgId, 42_000);

    const outsider = await createAuthedTestUser("adwallet-out");
    createdUsers.push(outsider.id);

    const wallet = await outsider.client
      .from("ad_wallets")
      .select("balance_ngn")
      .eq("organization_id", orgId);
    expect(
      wallet.data ?? [],
      "LEAK: a non-member could read another organisation's ad spend",
    ).toHaveLength(0);

    const ledger = await outsider.client
      .from("ad_wallet_ledger")
      .select("delta_ngn")
      .eq("organization_id", orgId);
    expect(
      ledger.data ?? [],
      "LEAK: a non-member could read another organisation's spend history",
    ).toHaveLength(0);

    // Positive control: the owner still can, so this is a scoping gate and not
    // a policy that denies everyone.
    const mine = await owner.client
      .from("ad_wallets")
      .select("balance_ngn")
      .eq("organization_id", orgId);
    expect(mine.data ?? [], "the owner must still see their own wallet").toHaveLength(1);
  });

  it("a client cannot call the RPCs directly", async () => {
    // The functions take organization_id as an argument, so exposing them to
    // `authenticated` would make that argument a forgeable authorisation.
    const { error } = await owner.client.rpc("credit_ad_wallet", {
      p_organization_id: orgId,
      p_amount_ngn: 1_000_000,
      p_reason: "topup",
    });
    expect(error, "MONEY: a client credited its own wallet via RPC").not.toBeNull();
  });
});

/**
 * Wallet TOP-UPS, and the one thing that stops a duplicate webhook becoming a
 * second credit.
 *
 * `fulfillPayment`'s "already processed" guard is a read-then-act check on
 * `payment_transactions.status`, and its own comment records that the
 * webhook/callback double-grant race is open and out of scope. That race is
 * ordinary, not exotic: the Paystack webhook and the top-up callback page both
 * fulfil the same reference, and a user landing on the callback while the
 * webhook is in flight is the normal case.
 *
 * So for a top-up, the only thing standing between that race and a
 * double-credited wallet is `ad_wallet_ledger_topup_reference_idx` — UNIQUE on
 * `paystack_reference` WHERE paystack_reference IS NOT NULL. These tests pin
 * that, and pin the two ways it can be defeated.
 */
describe("wallet top-ups are idempotent on the Paystack reference", () => {
  it("MONEY: the same reference credits once, however many times it arrives", async () => {
    const org = await makeWalletOrg();
    const reference = `ad_wallet_topup_${randomUUID()}`;

    await fund(org, 25_000, reference);
    const afterFirst = await balanceOf(org);
    expect(afterFirst).toBe(25_000);

    // Four more deliveries — webhook retries plus the callback page.
    for (let i = 0; i < 4; i += 1) await fund(org, 25_000, reference);

    expect(await balanceOf(org), "a duplicate delivery credited the wallet again").toBe(25_000);

    const { data: ledger } = await admin
      .from("ad_wallet_ledger")
      .select("id")
      .eq("paystack_reference", reference);
    expect(ledger, "the unique partial index let a second ledger row through").toHaveLength(1);
  });

  it("distinct references still credit separately — the guard is not just 'once ever'", async () => {
    const org = await makeWalletOrg();
    await fund(org, 10_000, `ad_wallet_topup_${randomUUID()}`);
    await fund(org, 10_000, `ad_wallet_topup_${randomUUID()}`);
    expect(await balanceOf(org)).toBe(20_000);
  });

  it("MONEY: a NULL reference defeats the index entirely — which is why 0050 forbids one", async () => {
    /*
     * The index is PARTIAL: `WHERE paystack_reference IS NOT NULL`. A null does
     * not collide with anything, including another null, so two deliveries both
     * insert and the wallet is credited twice.
     *
     * This test asserts the BROKEN behaviour on purpose. It is the reason
     * `payment_transactions` now CHECKs that an `ad_wallet_topup` row carries a
     * reference, and the reason fulfill.ts passes the transaction's own
     * reference rather than minting a fresh id. If someone later "tidies up"
     * either of those, this test explains what they cost.
     */
    const org = await makeWalletOrg();
    // The argument is OMITTED rather than passed as null. Its SQL default is
    // NULL, so this is the same call the database sees — and typegen renders a
    // defaulted parameter as optional-not-nullable, so omitting is also the
    // only way to express it that typechecks. Worth naming, because "we never
    // pass null" is exactly the false comfort this test exists to puncture:
    // the default supplies one.
    for (let i = 0; i < 2; i += 1) {
      await admin.rpc("credit_ad_wallet", {
        p_organization_id: org,
        p_amount_ngn: 5_000,
        p_reason: "topup",
      });
    }

    expect(
      await balanceOf(org),
      "a null reference no longer double-credits — if this fails the index was made total, " +
        "and the 0050 CHECK plus fulfill.ts's reference plumbing may now be redundant",
    ).toBe(10_000);
  });

  it("payment_transactions refuses a top-up row that could not be deduped", async () => {
    const org = await makeWalletOrg();

    // No reference: nothing downstream could dedupe it.
    const noRef = await admin.from("payment_transactions").insert({
      user_id: owner.id,
      organization_id: org,
      amount: 5_000,
      product_type: "ad_wallet_topup",
      product_id: null,
      paystack_reference: null,
      status: "pending",
    });
    expect(noRef.error?.code, "a top-up with no reference was accepted").toBe("23514");

    // No organisation: nothing to credit.
    const noOrg = await admin.from("payment_transactions").insert({
      user_id: owner.id,
      organization_id: null,
      amount: 5_000,
      product_type: "ad_wallet_topup",
      product_id: null,
      paystack_reference: `ad_wallet_topup_${randomUUID()}`,
      status: "pending",
    });
    expect(noOrg.error?.code, "a top-up with no organisation was accepted").toBe("23514");

    // The existing product types must still require product_id.
    const packNoProduct = await admin.from("payment_transactions").insert({
      user_id: owner.id,
      amount: 5_000,
      product_type: "credit_pack",
      product_id: null,
      status: "pending",
    });
    expect(packNoProduct.error?.code, "credit_pack no longer requires product_id").toBe("23514");
  });
});
