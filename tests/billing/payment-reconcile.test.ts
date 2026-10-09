/**
 * Plan B: the daily check of stale pending payments with Paystack (src/lib/billing/reconcile.ts).
 *
 * A payment row still `pending` after a day is either a checkout the buyer abandoned or a real charge whose webhook never arrived. The check asks Paystack FIRST (read-only) and calls the existing
 * fulfillPayment ONLY when Paystack says `success`; for anything else it records the finding beside the row (migration 0247) and leaves `status` alone, because fulfillPayment would turn an
 * abandoned checkout into `failed` for good and a buyer who then paid the old link would be granted nothing. Paystack's client is faked (there is no way to make the real API return what these cases
 * need); the rows, the grant functions, the credit ledger and fulfillPayment itself are real, so "fulfilled once" and "receipt once" are measured, not assumed.
 *
 * The check selects every stale pending row account-wide, so the whole file holds a lease (a second process running it would verify THIS file's rows with its own fake).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { acquireLock } from "../support/operators-lock";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`payment reconcile test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const verify = vi.hoisted(() => vi.fn());
const sent = vi.hoisted(() => ({ emails: [] as Array<{ to: string; subject: string; text?: string }> }));
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({ emails: { send: async (m: { to: string; subject: string; text?: string }) => { sent.emails.push(m); return { data: { id: "x" }, error: null }; } } }),
}));

import { PaystackDeclineError, PaystackUnavailableError } from "@/lib/paystack/client";
import { fulfillPayment } from "@/lib/billing/fulfill";
import {
  RECONCILE_BATCH_LIMIT,
  RECONCILE_MAX_ERROR_ATTEMPTS,
  RECONCILE_RECHECK_WINDOW_DAYS,
  checkPaymentWithPaystack,
  runPaymentReconcile,
  selectReconcileCandidates,
} from "@/lib/billing/reconcile";

const OPERATOR = "operator@example.test";
const HOURS = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let releaseLock: (() => Promise<void>) | undefined;
let userId = "";
let userEmail = "";
let packId = "";
let packPriceNgn = 0;
let packCredits = 0;
const made: string[] = [];
const passIds: string[] = [];
const savedAlertTo = process.env.ADMIN_ALERT_EMAIL;

interface RowOpts {
  ageMs?: number;
  status?: "pending" | "success" | "failed" | "needs_refund";
  reference?: string | null;
  renewalForPassId?: string | null;
  checkedAgoMs?: number | null;
  result?: string | null;
  attempts?: number;
  userId?: string | null;
  amount?: number;
}
async function makeRow(o: RowOpts = {}) {
  const reference = o.reference === undefined ? `reconcile_${randomUUID()}` : o.reference;
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({
      user_id: o.userId === undefined ? userId : o.userId,
      rail: "paystack",
      amount: o.amount ?? packPriceNgn,
      currency: "NGN",
      product_type: "credit_pack",
      product_id: packId,
      paystack_reference: reference,
      status: o.status ?? "pending",
      created_at: ago(o.ageMs ?? 25 * HOURS),
      reconcile_checked_at: o.checkedAgoMs == null ? null : ago(o.checkedAgoMs),
      reconcile_result: o.result ?? null,
      reconcile_attempts: o.attempts ?? 0,
      renewal_for_pass_id: o.renewalForPassId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture: ${error?.message}`);
  made.push(data.id);
  return { id: data.id, reference: reference as string };
}
async function row(id: string) {
  const { data } = await admin.from("payment_transactions").select("status, reconcile_result, reconcile_checked_at, reconcile_attempts").eq("id", id).single();
  return data!;
}
/** A renewal charge: linked to a user_passes row, which has its own indeterminate-charge flow and which the check must never touch. */
async function makeRenewalRow(ageMs = 30 * HOURS) {
  const { data: pass } = await admin.from("passes").select("id").limit(1).single();
  const { data: up, error } = await admin
    .from("user_passes")
    .insert({ user_id: userId, pass_id: pass!.id, expires_at: ago(-86_400_000), payment_method: "card", status: "active" })
    .select("id")
    .single();
  if (error || !up) throw new Error(`renewal fixture: ${error?.message}`);
  passIds.push(up.id);
  return makeRow({ ageMs, renewalForPassId: up.id });
}
const grants = async (id: string) => (await admin.from("credit_ledger").select("id", { count: "exact", head: true }).eq("related_entity_id", id)).count ?? 0;
const verified = (reference: string, over: Record<string, unknown> = {}) => ({ status: "success", reference, amount: Math.round(packPriceNgn * 100), currency: "NGN", channel: "bank_transfer", authorization: null, ...over });
/** Paystack's answers, by reference. An unknown reference is somebody else's row: it is answered "unavailable" so this file can never write a finding onto it by accident. */
function paystackSays(map: Record<string, Record<string, unknown> | Error>) {
  verify.mockImplementation(async (ref: string) => {
    const a = map[ref];
    if (!a) throw new PaystackUnavailableError(`unexpected reference ${ref}`);
    if (a instanceof Error) throw a;
    return a;
  });
}
const mine = (cands: Array<{ id: string }>) => cands.filter((c) => made.includes(c.id)).map((c) => c.id);
const receiptsTo = (to: string) => sent.emails.filter((m) => m.to === to && /your talentrah purchase/i.test(m.subject));
const alerts = () => sent.emails.filter((m) => m.to === OPERATOR);

beforeAll(async () => {
  releaseLock = await acquireLock(admin, "payment_reconcile_job_invariant", "payment-reconcile");
  const u = await createTestUser("reconcile");
  userId = u.id;
  userEmail = u.email;
  const { data: pack, error } = await admin.from("credit_packs").select("id, price_ngn, credits").limit(1).single();
  if (error || !pack) throw new Error("No credit packs seeded — run `npm run seed`.");
  packId = pack.id;
  packPriceNgn = pack.price_ngn;
  packCredits = pack.credits;
  process.env.ADMIN_ALERT_EMAIL = OPERATOR;
}, 300_000);

beforeEach(() => {
  verify.mockReset();
  sent.emails.length = 0;
});

afterEach(async () => {
  if (!made.length) return;
  const ids = made.splice(0);
  const passes = passIds.splice(0);
  await admin.from("credit_ledger").delete().in("related_entity_id", ids);
  const { error } = await admin.from("payment_transactions").delete().in("id", ids);
  if (error) throw new Error(`cleanup: ${error.message}`);
  if (passes.length) await admin.from("user_passes").delete().in("id", passes);
});

afterAll(async () => {
  if (savedAlertTo === undefined) delete process.env.ADMIN_ALERT_EMAIL;
  else process.env.ADMIN_ALERT_EMAIL = savedAlertTo;
  if (userId) await deleteTestUsers([userId]);
  await releaseLock?.();
}, 120_000);

describe("which rows are checked", () => {
  it("picks a pending row older than 24 h and skips young, renewal, referenceless and finished rows", async () => {
    const stale = await makeRow({ ageMs: 25 * HOURS });
    const young = await makeRow({ ageMs: 23 * HOURS });
    const fresh = await makeRow({ ageMs: 10 * 60_000 });
    const older = await makeRow({ ageMs: 300 * HOURS });
    const renewalRow = await makeRenewalRow();
    const noRef = await makeRow({ ageMs: 30 * HOURS, reference: null });
    const done = await makeRow({ ageMs: 30 * HOURS, status: "success" });
    const failed = await makeRow({ ageMs: 30 * HOURS, status: "failed" });
    const picked = mine(await selectReconcileCandidates(admin, new Date(), 500));
    expect(picked).toContain(stale.id);
    expect(picked).toContain(older.id);
    for (const r of [young, fresh, renewalRow, noRef, done, failed]) expect(picked, `wrongly picked ${r.reference}`).not.toContain(r.id);
  });

  it("checks a never-checked row once whatever its age, but re-checks a row that already has a finding only for 7 days after creation", async () => {
    const oldNever = await makeRow({ ageMs: 40 * 24 * HOURS });
    const oldCheckedAbandoned = await makeRow({ ageMs: 40 * 24 * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_abandoned" });
    const youngCheckedAbandoned = await makeRow({ ageMs: 3 * 24 * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_abandoned" });
    const edgeInside = await makeRow({ ageMs: (RECONCILE_RECHECK_WINDOW_DAYS * 24 - 1) * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_abandoned" });
    const edgeOutside = await makeRow({ ageMs: (RECONCILE_RECHECK_WINDOW_DAYS * 24 + 1) * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_failed" });
    const picked = mine(await selectReconcileCandidates(admin, new Date(), 500));
    expect(picked).toContain(oldNever.id);
    expect(picked).toContain(youngCheckedAbandoned.id);
    expect(picked).toContain(edgeInside.id);
    expect(picked, "an abandoned row older than 7 days must never be re-checked").not.toContain(oldCheckedAbandoned.id);
    expect(picked).not.toContain(edgeOutside.id);
  });

  it("does not ask again within the same day, and leaves a margin so a daily cron that drifts by minutes still finds yesterday's rows", async () => {
    const checkedTwoHoursAgo = await makeRow({ ageMs: 3 * 24 * HOURS, checkedAgoMs: 2 * HOURS, result: "paystack_abandoned" });
    const checkedAlmostADayAgo = await makeRow({ ageMs: 3 * 24 * HOURS, checkedAgoMs: 23.9 * HOURS, result: "paystack_abandoned" });
    const picked = mine(await selectReconcileCandidates(admin, new Date(), 500));
    expect(picked).not.toContain(checkedTwoHoursAgo.id);
    expect(picked, "a run 23.9 h after the last one must not skip the row because of a few minutes of cron drift").toContain(checkedAlmostADayAgo.id);
  });

  it("retries an errored row until it has failed 5 times, whatever its age, then stops", async () => {
    const four = await makeRow({ ageMs: 40 * 24 * HOURS, checkedAgoMs: 30 * HOURS, result: "error", attempts: RECONCILE_MAX_ERROR_ATTEMPTS - 1 });
    const five = await makeRow({ ageMs: 40 * 24 * HOURS, checkedAgoMs: 30 * HOURS, result: "error", attempts: RECONCILE_MAX_ERROR_ATTEMPTS });
    const picked = mine(await selectReconcileCandidates(admin, new Date(), 500));
    expect(picked).toContain(four.id);
    expect(picked).not.toContain(five.id);
  });

  it("looks at never-checked rows before rechecks, so a backlog of rechecks cannot starve new stale rows beyond the daily limit", async () => {
    const recheck = await makeRow({ ageMs: 100 * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_abandoned" });
    const fresh = await makeRow({ ageMs: 25 * HOURS });
    const all = mine(await selectReconcileCandidates(admin, new Date(), 500));
    expect(all).toContain(recheck.id);
    expect(all.indexOf(fresh.id), "a never-checked row comes before an older recheck").toBeLessThan(all.indexOf(recheck.id));
    // and with room for one, it is the never-checked row that gets it
    const first = await selectReconcileCandidates(admin, new Date(), 1);
    expect(first[0].reconcile_checked_at, "the first candidate has never been checked").toBeNull();
  });

  it("takes the oldest first and no more than the limit", async () => {
    const a = await makeRow({ ageMs: 50 * HOURS });
    const b = await makeRow({ ageMs: 49 * HOURS });
    const c = await makeRow({ ageMs: 48 * HOURS });
    const all = mine(await selectReconcileCandidates(admin, new Date(), 500));
    expect(all.indexOf(a.id)).toBeLessThan(all.indexOf(b.id));
    expect(all.indexOf(b.id)).toBeLessThan(all.indexOf(c.id));
    expect((await selectReconcileCandidates(admin, new Date(), 2)).length).toBeLessThanOrEqual(2);
    expect(RECONCILE_BATCH_LIMIT).toBe(25);
  });
});

describe("a real charge whose webhook never arrived", () => {
  it("is fulfilled once through fulfillPayment: credits granted once, status success, finding recorded, receipt to the buyer once, one alert to the operator naming the reference", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference) });
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.ok).toBe(true);
    expect(summary.fulfilled).toContain(r.reference);
    const after = await row(r.id);
    expect(after.status).toBe("success");
    expect(after.reconcile_result).toBe("fulfilled_by_check");
    expect(after.reconcile_checked_at).not.toBeNull();
    expect(await grants(r.id), "MONEY BUG: credits granted other than once").toBe(1);
    const { data: ledger } = await admin.from("credit_ledger").select("delta").eq("related_entity_id", r.id).single();
    expect(ledger!.delta).toBe(packCredits);
    expect(receiptsTo(userEmail), "the buyer's normal receipt, once").toHaveLength(1);
    const op = alerts();
    expect(op, "a lost webhook is an incident: one alert").toHaveLength(1);
    expect(op[0].text).toContain(r.reference);
    expect((op[0].text ?? "").toLowerCase()).toContain("webhook");
  });

  it("run twice: still one grant, one receipt, one alert (the second run finds nothing to do)", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference) });
    await runPaymentReconcile({ pauseMs: 0 });
    verify.mockClear();
    const second = await runPaymentReconcile({ pauseMs: 0 });
    expect(second.fulfilled).not.toContain(r.reference);
    expect(verify.mock.calls.map((c) => c[0])).not.toContain(r.reference);
    expect(await grants(r.id)).toBe(1);
    expect(receiptsTo(userEmail)).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
  });

  it("racing the webhook: exactly one grant, one receipt, whoever wins", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference) });
    await Promise.all([runPaymentReconcile({ pauseMs: 0 }), fulfillPayment(r.reference)]);
    expect(await grants(r.id), "MONEY BUG: the check and the webhook both granted").toBe(1);
    expect(receiptsTo(userEmail)).toHaveLength(1);
    expect((await row(r.id)).status).toBe("success");
  });

  it("a webhook that wins before the check reaches the row is not claimed by the check", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference) });
    await fulfillPayment(r.reference);
    sent.emails.length = 0;
    const result = await checkPaymentWithPaystack(r.reference);
    expect(result.outcome).toBe("not_pending");
    expect((await row(r.id)).reconcile_result, "only a payment the check itself fulfilled may say so").toBeNull();
    expect(alerts()).toHaveLength(0);
  });

  it("a webhook that lands between the check's question and its fulfilment wins cleanly: the check does not claim it, alert, or grant again", async () => {
    const r = await makeRow();
    let webhookRan = false;
    verify.mockImplementation(async (ref: string) => {
      if (ref !== r.reference) throw new PaystackUnavailableError(`unexpected reference ${ref}`);
      if (!webhookRan) {
        webhookRan = true;
        await fulfillPayment(ref); // the webhook delivers while the check is mid-flight
      }
      return verified(ref);
    });
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.fulfilled, "the webhook fulfilled it, not the check").not.toContain(r.reference);
    expect(await grants(r.id)).toBe(1);
    expect(receiptsTo(userEmail)).toHaveLength(1);
    expect(alerts(), "no lost webhook here: the webhook did arrive").toHaveLength(0);
    expect((await row(r.id)).reconcile_result).toBeNull();
  });

  it("an amount or currency that does not match is not granted, is recorded as an error, and the operator is told", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference, { amount: 100 }) });
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.fulfilled).not.toContain(r.reference);
    expect(await grants(r.id)).toBe(0);
    expect(receiptsTo(userEmail)).toHaveLength(0);
    expect((await row(r.id)).reconcile_result).toBe("error");
    const op = alerts();
    expect(op).toHaveLength(1);
    expect(op[0].text).toContain(r.reference);
    expect(op[0].text, "says both ways it can happen").toMatch(/amount or currency did not match the order, or .*second answer was failed or reversed/);
  });

  it("a charge for a deleted account becomes needs_refund (fulfillPayment's own path), grants nothing, sends no receipt, and is not reported as fulfilled", async () => {
    const r = await makeRow({ userId: null });
    paystackSays({ [r.reference]: verified(r.reference) });
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.fulfilled).not.toContain(r.reference);
    expect((await row(r.id)).status).toBe("needs_refund");
    expect(await grants(r.id)).toBe(0);
    expect(receiptsTo(userEmail)).toHaveLength(0);
    expect((await row(r.id)).reconcile_result).toBe("error");
  });
});

describe("a checkout that was never paid: asked first, nothing changed", () => {
  it("abandoned: status stays pending, the finding is recorded, nothing granted, no alert; and a later webhook success still fulfils it", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference, { status: "abandoned" }) });
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.ok).toBe(true);
    const after = await row(r.id);
    expect(after.status, "fulfillPayment would have made this `failed` for good").toBe("pending");
    expect(after.reconcile_result).toBe("paystack_abandoned");
    expect(after.reconcile_checked_at).not.toBeNull();
    expect(await grants(r.id)).toBe(0);
    expect(alerts()).toHaveLength(0);

    // the buyer pays the old link tomorrow; the webhook arrives
    paystackSays({ [r.reference]: verified(r.reference) });
    const late = await fulfillPayment(r.reference);
    expect(late.status).toBe("success");
    expect((await row(r.id)).status).toBe("success");
    expect(await grants(r.id)).toBe(1);
    expect(receiptsTo(userEmail)).toHaveLength(1);
  });

  it("an abandoned row older than 7 days that has been checked is not asked about again", async () => {
    const r = await makeRow({ ageMs: 8 * 24 * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_abandoned" });
    paystackSays({});
    await runPaymentReconcile({ pauseMs: 0 });
    expect(verify.mock.calls.map((c) => c[0])).not.toContain(r.reference);
    expect((await row(r.id)).reconcile_checked_at).not.toBeNull();
  });

  it("an abandoned row inside the 7 days is asked about again the next day and the finding is refreshed", async () => {
    const r = await makeRow({ ageMs: 3 * 24 * HOURS, checkedAgoMs: 30 * HOURS, result: "paystack_abandoned" });
    paystackSays({ [r.reference]: verified(r.reference, { status: "abandoned" }) });
    await runPaymentReconcile({ pauseMs: 0 });
    expect(verify.mock.calls.map((c) => c[0])).toContain(r.reference);
    const checkedAt = new Date((await row(r.id)).reconcile_checked_at!).getTime();
    expect(Date.now() - checkedAt).toBeLessThan(60_000);
  });

  it.each([
    ["failed", "paystack_failed"],
    ["reversed", "paystack_reversed"],
  ])("Paystack says %s: recorded as %s, status untouched (the buyer may still pay), nothing granted", async (paystackStatus, word) => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference, { status: paystackStatus }) });
    await runPaymentReconcile({ pauseMs: 0 });
    const after = await row(r.id);
    expect(after.status).toBe("pending");
    expect(after.reconcile_result).toBe(word);
    expect(await grants(r.id)).toBe(0);
  });

  it.each(["pending", "ongoing", "processing", "queued", "a-status-nobody-has-seen"])("Paystack says %s: recorded as unsettled, status untouched", async (paystackStatus) => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference, { status: paystackStatus }) });
    await runPaymentReconcile({ pauseMs: 0 });
    const after = await row(r.id);
    expect(after.status).toBe("pending");
    expect(after.reconcile_result).toBe("paystack_unsettled");
  });

  it("Paystack does not know the reference (404): recorded as not found, status untouched", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: new PaystackDeclineError("Transaction reference not found", 404, { bodyStatus: false }) });
    await runPaymentReconcile({ pauseMs: 0 });
    const after = await row(r.id);
    expect(after.status).toBe("pending");
    expect(after.reconcile_result).toBe("paystack_not_found");
  });
});

describe("when Paystack cannot be asked", () => {
  it("an outage is an error: attempts + 1, status untouched, no alert; the 5th failure stops the retries", async () => {
    const r = await makeRow({ attempts: RECONCILE_MAX_ERROR_ATTEMPTS - 1 });
    paystackSays({ [r.reference]: new PaystackUnavailableError("timeout") });
    await runPaymentReconcile({ pauseMs: 0 });
    const after = await row(r.id);
    expect(after.status).toBe("pending");
    expect(after.reconcile_result).toBe("error");
    expect(after.reconcile_attempts).toBe(RECONCILE_MAX_ERROR_ATTEMPTS);
    expect(alerts()).toHaveLength(0);
    verify.mockClear();
    await admin.from("payment_transactions").update({ reconcile_checked_at: ago(30 * HOURS) }).eq("id", r.id);
    await runPaymentReconcile({ pauseMs: 0 });
    expect(verify.mock.calls.map((c) => c[0]), "after 5 errors the row is left for a person").not.toContain(r.reference);
  });

  it("a decline that is not a 404 (a bad key, a bad request) is an error, not a finding about the payment", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: new PaystackDeclineError("Invalid key", 401) });
    await runPaymentReconcile({ pauseMs: 0 });
    const after = await row(r.id);
    expect(after.reconcile_result).toBe("error");
    expect(after.reconcile_attempts).toBe(1);
  });

  /** Paystack confirms on the check's own question, then fails on fulfillPayment's second question. */
  function secondAskFails(reference: string, err: Error) {
    let calls = 0;
    verify.mockImplementation(async (ref: string) => {
      if (ref !== reference) throw new PaystackUnavailableError(`unexpected reference ${ref}`);
      calls += 1;
      if (calls === 1) return verified(ref);
      throw err;
    });
  }

  it("a Paystack blip on fulfilment's own second question is retried quietly: an error recorded, no 'someone has paid and has nothing' email", async () => {
    const r = await makeRow();
    secondAskFails(r.reference, new PaystackUnavailableError("timeout"));
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    const after = await row(r.id);
    expect(after.status).toBe("pending");
    expect(after.reconcile_result).toBe("error");
    expect(after.reconcile_attempts).toBe(1);
    expect(summary.problems).toHaveLength(0);
    expect(alerts(), "five days of emails for one blip").toHaveLength(0);
  });

  it("the same blip on the LAST attempt does email, because nobody else will look", async () => {
    const r = await makeRow({ attempts: RECONCILE_MAX_ERROR_ATTEMPTS - 1 });
    secondAskFails(r.reference, new PaystackUnavailableError("timeout"));
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.problems).toContain(r.reference);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].text).toContain(r.reference);
  });

  it("a failure that is not Paystack's (a database fault in the grant) emails at once", async () => {
    const r = await makeRow();
    secondAskFails(r.reference, new Error("connection reset by peer"));
    const summary = await runPaymentReconcile({ pauseMs: 0 });
    expect(summary.problems).toContain(r.reference);
    expect(alerts()).toHaveLength(1);
    expect((await row(r.id)).reconcile_attempts).toBe(1);
  });

  it("one row's failure does not stop the others", async () => {
    const bad = await makeRow({ ageMs: 60 * HOURS });
    const good = await makeRow({ ageMs: 50 * HOURS });
    paystackSays({ [bad.reference]: new PaystackUnavailableError("timeout"), [good.reference]: verified(good.reference, { status: "abandoned" }) });
    await runPaymentReconcile({ pauseMs: 0 });
    expect((await row(bad.id)).reconcile_result).toBe("error");
    expect((await row(good.id)).reconcile_result).toBe("paystack_abandoned");
  });
});

describe("limits", () => {
  it("looks at no more rows than the limit in a run", async () => {
    const rows = [];
    for (let i = 0; i < 4; i++) rows.push(await makeRow({ ageMs: (100 + i) * HOURS }));
    paystackSays(Object.fromEntries(rows.map((r) => [r.reference, verified(r.reference, { status: "abandoned" })])));
    await runPaymentReconcile({ pauseMs: 0, limit: 3 });
    const checked = (await Promise.all(rows.map((r) => row(r.id)))).filter((x) => x.reconcile_result === "paystack_abandoned");
    expect(checked.length).toBeLessThanOrEqual(3);
  });

  it("stops at its time budget and says so, leaving the rest for the next run", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference, { status: "abandoned" }) });
    const summary = await runPaymentReconcile({ pauseMs: 0, deadlineMs: 0 });
    expect(summary.stopped).toBe("deadline");
    expect((await row(r.id)).reconcile_result).toBeNull();
  });

  it("with no candidates it makes no Paystack call", async () => {
    await runPaymentReconcile({ pauseMs: 0, limit: 0 });
    expect(verify).not.toHaveBeenCalled();
  });

  it("a candidate query that fails is reported as not ok, not as a clean empty run", async () => {
    // Whatever the check chains onto the client, the awaited result is an error.
    const chain: unknown = new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "boom" } }) : chain),
      apply: () => chain,
    });
    const broken = { from: () => chain } as never;
    const summary = await runPaymentReconcile({ pauseMs: 0, supabase: broken });
    expect(summary.ok).toBe(false);
    expect(summary.queryError).toContain("boom");
  });
});

describe("the one-reference check behind the Finance button", () => {
  it("asks about a stale pending row even if it was checked this morning or has used its 5 errors, and fulfils it if Paystack says success", async () => {
    const r = await makeRow({ checkedAgoMs: HOURS, result: "error", attempts: RECONCILE_MAX_ERROR_ATTEMPTS });
    paystackSays({ [r.reference]: verified(r.reference) });
    const out = await checkPaymentWithPaystack(r.reference);
    expect(out.outcome).toBe("fulfilled_by_check");
    expect(await grants(r.id)).toBe(1);
    expect(receiptsTo(userEmail)).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
  });

  it("records an abandoned finding without changing status", async () => {
    const r = await makeRow();
    paystackSays({ [r.reference]: verified(r.reference, { status: "abandoned" }) });
    const out = await checkPaymentWithPaystack(r.reference);
    expect(out.outcome).toBe("paystack_abandoned");
    expect((await row(r.id)).status).toBe("pending");
  });

  it("refuses a renewal charge, a finished payment and a reference that does not exist, without calling Paystack", async () => {
    const done = await makeRow({ status: "success" });
    const renewal = await makeRenewalRow();
    expect((await checkPaymentWithPaystack(done.reference)).outcome).toBe("not_pending");
    expect((await checkPaymentWithPaystack(renewal.reference)).outcome).toBe("not_eligible");
    expect((await checkPaymentWithPaystack(`reconcile_${randomUUID()}`)).outcome).toBe("not_found");
    expect(verify).not.toHaveBeenCalled();
  });
});
