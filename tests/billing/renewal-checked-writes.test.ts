/**
 * PAYOUT-RENEWAL-UNCHECKED-WRITES-1, PR-B: Pass renewals. The charge reference is saved BEFORE the card is charged, a stored reference is settled through verifyTransaction before
 * anything is charged again, and every write that decides a money outcome is checked.
 *
 * Real database, only Paystack mocked, and the service-role client wrapped so a chosen write or read can fail (tests/support/faulty-service-client.ts). With no rule set the wrapper
 * is a pass-through, so the success path here runs against the real database exactly as it does in production.
 *
 * Every test was run against main's src/lib/billing/renewals.ts first; reports/S3/2026-10-20-payout-pr-b-renewals-cancel.md prints which failed there and how, and says which
 * pass on both (pins of behaviour that must not change).
 *
 * "Unknown reference" for a TRANSACTION is HTTP 400 with the code `transaction_not_found` (owner's Paystack test-mode check, 17 Oct 2026), not "any 400" and not a 404.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { acquirePassRenewalJobLock } from "../support/operators-lock";
import { createFaultyClient, type FaultyClient } from "../support/faulty-service-client";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Renewal checked-writes test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const charge = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ faulty: null as null | { client: unknown } }));

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, chargeAuthorization: charge, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/service-role")>();
  return { ...actual, createServiceRoleClient: () => (holder.faulty ? (holder.faulty.client as ReturnType<typeof actual.createServiceRoleClient>) : actual.createServiceRoleClient()) };
});

const DAY = 86_400_000;
let userId: string;
let passId: string;
let passPriceNgn: number;
let passDays: number;
let userPassId = "NOT_SET";
let faulty: FaultyClient<ReturnType<typeof import("@/lib/supabase/service-role").createServiceRoleClient>>;
let releaseLock: (() => Promise<void>) | undefined;

beforeAll(async () => {
  releaseLock = await acquirePassRenewalJobLock(admin, "renewal-checked-writes");
  const user = await createTestUser("renewchk");
  userId = user.id;
  const { data: pass, error } = await admin.from("passes").select("id, price_ngn, duration_days").limit(1).single();
  if (error || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
  passPriceNgn = pass.price_ngn;
  passDays = pass.duration_days;
}, 300_000);

beforeEach(async () => {
  charge.mockReset();
  verify.mockReset();
  const actual = await vi.importActual<typeof import("@/lib/supabase/service-role")>("@/lib/supabase/service-role");
  faulty = createFaultyClient(actual.createServiceRoleClient());
  holder.faulty = faulty;
});

afterEach(async () => {
  holder.faulty = null;
  vi.restoreAllMocks();
  if (userPassId === "NOT_SET") return;
  await admin.from("payment_transactions").delete().eq("renewal_for_pass_id", userPassId);
  await admin.from("user_passes").delete().eq("id", userPassId);
  userPassId = "NOT_SET";
});

afterAll(async () => {
  if (userId) {
    await admin.from("user_passes").delete().eq("user_id", userId);
    await deleteTestUsers([userId]);
  }
  await releaseLock?.();
}, 60_000);

/** A due Pass (expired yesterday, renewal due today) with a saved reusable card. */
async function dueSetup(over: Partial<Database["public"]["Tables"]["user_passes"]["Insert"]> = {}) {
  const yesterday = new Date(Date.now() - DAY).toISOString();
  const { data, error } = await admin
    .from("user_passes")
    .insert({
      user_id: userId,
      pass_id: passId,
      started_at: yesterday,
      expires_at: yesterday,
      payment_method: "card",
      auto_renew: true,
      auto_renew_status: "active",
      next_renewal_date: new Date().toISOString().slice(0, 10),
      authorization_code: "AUTH_test_reusable_code",
      ...over,
    })
    .select("id, expires_at")
    .single();
  if (error || !data) throw error ?? new Error("no pass");
  userPassId = data.id;
  return data;
}

async function pendingTx(reference: string) {
  const { error } = await admin.from("payment_transactions").insert({
    user_id: userId,
    rail: "paystack",
    amount: passPriceNgn,
    currency: "NGN",
    product_type: "pass",
    product_id: passId,
    paystack_reference: reference,
    status: "pending",
    renewal_for_pass_id: userPassId,
  });
  if (error) throw error;
}

async function passRow() {
  const { data } = await admin
    .from("user_passes")
    .select("auto_renew, auto_renew_status, status, next_renewal_date, expires_at, pending_renewal_reference, renewal_attempt_count, renewal_claimed_at, renewal_reminder_sent_at")
    .eq("id", userPassId)
    .single();
  return data!;
}

async function txRows() {
  const { data } = await admin.from("payment_transactions").select("status, paystack_reference, amount, channel, authorization_code").eq("renewal_for_pass_id", userPassId);
  return data ?? [];
}

const newRef = () => `pass_renewal_${crypto.randomUUID()}`;
const okResult = (reference: string) => ({ status: "success", reference, amount: Math.round(passPriceNgn * 100), currency: "NGN", channel: "card", gateway_response: "Approved" });
const verified = (reference: string, status: string) => ({ status, reference, amount: Math.round(passPriceNgn * 100), currency: "NGN", channel: "card" });

async function decline(message: string, status: number, code?: string) {
  const { PaystackDeclineError } = await import("@/lib/paystack/client");
  return new PaystackDeclineError(message, status, code ? { code, type: "validation_error", bodyStatus: false } : {});
}
function timeoutError() {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}
const run = async () => (await import("@/lib/billing/renewals")).runPassRenewalJob();
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
const logged = (spy: ReturnType<typeof quiet>) => spy.mock.calls.map((c) => c.join(" ")).join("\n");
const expectedExpiry = (oldIso: string) => new Date(new Date(oldIso).getTime() + passDays * DAY).getTime();

describe("the success path is unchanged", () => {
  it("a due Pass that charges cleanly ends in exactly the state it always did: one charge, one success row, extended by one period, retry state and reference cleared", async () => {
    const pass = await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));

    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.renewed).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][0]).toMatchObject({ email: expect.any(String), amountNgn: passPriceNgn, authorizationCode: "AUTH_test_reusable_code" });
    const row = await passRow();
    expect(row.auto_renew_status).toBe("active");
    expect(row.auto_renew).toBe(true);
    expect(row.status).toBe("active");
    expect(Date.parse(row.expires_at)).toBe(expectedExpiry(pass.expires_at));
    expect(row.next_renewal_date).toBe(new Date(expectedExpiry(pass.expires_at)).toISOString().slice(0, 10));
    expect(row.renewal_attempt_count).toBe(0);
    expect(row.pending_renewal_reference).toBeNull();
    expect(row.renewal_claimed_at).toBeNull();
    expect(row.renewal_reminder_sent_at).toBeNull();
    const txs = await txRows();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ status: "success", amount: passPriceNgn, channel: "card", authorization_code: "AUTH_test_reusable_code" });
    expect(txs[0].paystack_reference).toBe(charge.mock.calls[0][0].reference);
  });
});

describe("the charge reference is saved BEFORE the card is charged", () => {
  it("call order: the reference is on the Pass when chargeAuthorization runs, and it is the reference that is charged", async () => {
    await dueSetup();
    let onRow: string | null | undefined;
    charge.mockImplementation(async (p: { reference: string }) => {
      onRow = (await passRow()).pending_renewal_reference;
      return okResult(p.reference);
    });

    await run();

    expect(onRow, "MONEY BUG: when the card was charged the reference was not on the Pass, so a crash after the charge leaves no thread back to it").toBe(charge.mock.calls[0][0].reference);
  });

  it.each(["error", "zero"] as const)("the reference write fails (%s): NO charge, the Pass is not lapsed, the claim is given back, the run is not ok", async (mode) => {
    await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));
    faulty.fail({ table: "user_passes", op: "update", mode, times: Infinity, match: (v) => typeof v.pending_renewal_reference === "string" });
    const log = quiet();

    const summary = await run();
    const text = logged(log);

    expect(charge, "MONEY BUG: the card was charged although the reference could not be saved first").not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/no charge was made/i);
    expect(text).toMatch(/REFERENCE NOT SAVED/);
    const row = await passRow();
    expect(row.auto_renew_status, "a Pass whose reference could not be saved is not lapsed").toBe("active");
    expect(row.next_renewal_date).not.toBeNull();
    expect(row.renewal_claimed_at, "the claim is given back so the next run is not blocked for 15 minutes").toBeNull();
  });
});

describe("a stored reference is settled through verifyTransaction before anything is charged", () => {
  it("verify answers HTTP 400 with the code transaction_not_found: the SAME reference is charged, not a new one", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored, renewal_attempt_count: 1 });
    verify.mockRejectedValueOnce(await decline("Transaction reference not found.", 400, "transaction_not_found"));
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));

    const summary = await run();

    expect(summary.renewed).toBe(1);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][0].reference, "a reference Paystack never created must be reused, not replaced").toBe(stored);
    expect((await txRows()).map((t) => t.paystack_reference)).toEqual([stored]);
  });

  it.each([
    ["400 with another code", 400, "invalid_request"],
    ["400 with no code", 400, undefined],
    ["401", 401, "invalid_key"],
    ["403", 403, undefined],
    ["404", 404, "not_found"],
    ["429", 429, "rate_limited"],
  ])("verify answers %s: indeterminate, NO charge, the reference is kept and the attempt counted", async (_label, httpStatus, code) => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored, renewal_attempt_count: 0 });
    verify.mockRejectedValueOnce(await decline(`Paystack said ${httpStatus}`, httpStatus, code));
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));

    const summary = await run();

    expect(charge, `MONEY BUG: an HTTP ${httpStatus} on a verify call led to a new charge`).not.toHaveBeenCalled();
    expect(summary.indeterminate).toBe(1);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("active");
    expect(row.pending_renewal_reference).toBe(stored);
    expect(row.renewal_attempt_count).toBe(1);
  });

  it("verify fails with a network error: indeterminate, NO charge", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored });
    verify.mockRejectedValueOnce(timeoutError());

    const summary = await run();

    expect(charge).not.toHaveBeenCalled();
    expect(summary.indeterminate).toBe(1);
    expect((await passRow()).pending_renewal_reference).toBe(stored);
  });

  it("verify says success: the Pass is extended WITHOUT a new charge, one success row, the reference cleared", async () => {
    const stored = newRef();
    const pass = await dueSetup({ pending_renewal_reference: stored, renewal_attempt_count: 1 });
    await pendingTx(stored);
    verify.mockResolvedValueOnce(verified(stored, "success"));

    const summary = await run();

    expect(charge).not.toHaveBeenCalled();
    expect(summary.renewed).toBe(1);
    const row = await passRow();
    expect(Date.parse(row.expires_at)).toBe(expectedExpiry(pass.expires_at));
    expect(row.pending_renewal_reference).toBeNull();
    expect(await txRows()).toMatchObject([{ status: "success", paystack_reference: stored }]);
  });

  it.each(["failed", "reversed"])("verify says %s: a NEW reference replaces the spent one on the Pass BEFORE it is charged", async (status) => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored, renewal_attempt_count: 1 });
    verify.mockResolvedValueOnce(verified(stored, status));
    let onRow: string | null | undefined;
    charge.mockImplementation(async (p: { reference: string }) => {
      onRow = (await passRow()).pending_renewal_reference;
      return okResult(p.reference);
    });

    await run();

    const charged = charge.mock.calls[0][0].reference as string;
    expect(charged).not.toBe(stored);
    expect(onRow, "the replacement reference must be saved before it is charged").toBe(charged);
  });

  it("a decline on a REUSED reference is verified once more: Paystack in fact has the charge and it succeeded, so the Pass is extended, not lapsed", async () => {
    const stored = newRef();
    const pass = await dueSetup({ pending_renewal_reference: stored });
    verify.mockRejectedValueOnce(await decline("Transaction reference not found.", 400, "transaction_not_found"));
    charge.mockRejectedValueOnce(await decline("Duplicate Transaction Reference", 400, "duplicate_reference"));
    verify.mockResolvedValueOnce(verified(stored, "success"));

    const summary = await run();

    expect(verify).toHaveBeenCalledTimes(2);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(summary.renewed).toBe(1);
    expect(summary.lapsed).toBe(0);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("active");
    expect(Date.parse(row.expires_at)).toBe(expectedExpiry(pass.expires_at));
  });

  it("a decline on a reused reference whose second verify still says not found is a genuine decline: lapsed, the spent reference cleared", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored });
    verify.mockRejectedValue(await decline("Transaction reference not found.", 400, "transaction_not_found"));
    charge.mockRejectedValueOnce(await decline("Insufficient funds", 400, "card_declined"));

    const summary = await run();

    expect(summary.lapsed).toBe(1);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("lapsed");
    expect(row.pending_renewal_reference).toBeNull();
  });

  it("a decline on a reused reference whose second verify cannot be read is indeterminate: not lapsed", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored });
    verify.mockRejectedValueOnce(await decline("Transaction reference not found.", 400, "transaction_not_found"));
    charge.mockRejectedValueOnce(await decline("Something was refused", 400, "validation_error"));
    verify.mockRejectedValueOnce(timeoutError());

    const summary = await run();

    expect(summary.lapsed).toBe(0);
    expect(summary.indeterminate).toBe(1);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("active");
    expect(row.pending_renewal_reference).toBe(stored);
  });
});

describe("a charge that succeeded but whose bookkeeping failed is loud and never lapses the customer", () => {
  it.each(["error", "zero"] as const)(
    "the extension write fails (%s) after a successful charge: not lapsed, the reference kept, next_renewal_date untouched, NEEDS RECONCILIATION, not ok, not counted as renewed",
    async (mode) => {
      const pass = await dueSetup();
      const before = await passRow();
      charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));
      faulty.fail({ table: "user_passes", op: "update", mode, times: Infinity, match: (v) => typeof v.expires_at === "string" });
      const log = quiet();

      const summary = await run();
      const text = logged(log);

      const reference = charge.mock.calls[0][0].reference as string;
      expect(summary.renewed, "MONEY BUG: a renewal whose extension was not written was counted as renewed").toBe(0);
      expect(summary.ok).toBe(false);
      expect(summary.lapsed).toBe(0);
      expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/NEEDS RECONCILIATION: charged but not extended/);
      expect(text).toContain(pass.id);
      expect(text).toContain(reference);
      expect(text).toMatch(/CHARGED BUT NOT EXTENDED/);
      const row = await passRow();
      expect(row.auto_renew_status, "the customer paid: never lapsed").toBe("active");
      expect(row.auto_renew).toBe(true);
      expect(row.pending_renewal_reference, "the only thread back to the charge").toBe(reference);
      expect(row.next_renewal_date).toBe(before.next_renewal_date);
      expect(Date.parse(row.expires_at)).toBe(Date.parse(before.expires_at));
    },
  );

  it("the first extension write errors once and the single retry succeeds: renewed, extended by exactly one period", async () => {
    const pass = await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));
    faulty.fail({ table: "user_passes", op: "update", mode: "error", times: 1, match: (v) => typeof v.expires_at === "string" });
    const log = quiet();

    const summary = await run();
    log.mockRestore();

    expect(summary.renewed).toBe(1);
    expect(summary.ok).toBe(true);
    expect(Date.parse((await passRow()).expires_at)).toBe(expectedExpiry(pass.expires_at));
  });

  it("the first extension write COMMITS but reports an error: the retry leaves the expiry at the one computed value, not one period more, and it does not report 'charged but not extended'", async () => {
    const pass = await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));
    faulty.fail({ table: "user_passes", op: "update", mode: "error-after", times: 1, match: (v) => typeof v.expires_at === "string" });
    const log = quiet();

    const summary = await run();
    log.mockRestore();

    expect(Date.parse((await passRow()).expires_at), "MONEY BUG: a first write that had committed was applied a second time").toBe(expectedExpiry(pass.expires_at));
    expect(summary.renewed).toBe(1);
    expect(summary.errors.map((e) => e.message).join("\n")).not.toMatch(/charged but not extended/i);
    expect(summary.ok).toBe(true);
    expect((await passRow()).pending_renewal_reference).toBeNull();
  });

  it("the reference is cleared by the SAME single update that extends the Pass, never by a second write", async () => {
    await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));

    await run();

    const updates = faulty.calls.filter((c) => c.table === "user_passes" && c.op === "update");
    const extending = updates.filter((c) => typeof c.values?.expires_at === "string");
    expect(extending).toHaveLength(1);
    expect(extending[0].values).toHaveProperty("pending_renewal_reference", null);
    const clearsOnly = updates.filter((c) => c.values && "pending_renewal_reference" in c.values && c.values.pending_renewal_reference === null && !("expires_at" in c.values));
    expect(clearsOnly, "the reference must never be cleared by a write of its own").toHaveLength(0);
  });

  it("a stale reference whose transaction was ALREADY applied does not extend a second time: expiry unchanged, one success row, no charge, the reference cleared", async () => {
    const stored = newRef();
    const future = new Date(Date.now() + 20 * DAY).toISOString();
    await dueSetup({ expires_at: future, pending_renewal_reference: stored });
    await pendingTx(stored);
    verify.mockResolvedValueOnce(verified(stored, "success"));

    const summary = await run();

    expect(charge).not.toHaveBeenCalled();
    const row = await passRow();
    expect(Date.parse(row.expires_at), "MONEY BUG: a payment that was already applied extended the Pass again").toBe(Date.parse(future));
    expect(row.pending_renewal_reference).toBeNull();
    expect(row.next_renewal_date, "the Pass must not be due again for a period already in place").toBe(future.slice(0, 10));
    expect(await txRows()).toMatchObject([{ status: "success", paystack_reference: stored }]);
    expect(summary.errors.map((e) => e.message).join("\n")).not.toMatch(/charged but not extended/i);
  });

  it("the payment-row write fails but the extension works: extended anyway, error logged, listed, not ok", async () => {
    const pass = await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));
    faulty.fail({ table: "payment_transactions", op: "insert", mode: "error", times: Infinity });
    const log = quiet();

    const summary = await run();
    const text = logged(log);

    expect(summary.renewed).toBe(1);
    expect(Date.parse((await passRow()).expires_at)).toBe(expectedExpiry(pass.expires_at));
    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/could not be recorded/i);
    expect(text).toMatch(/PAYMENT ROW NOT RECORDED/);
    expect(text).toContain(charge.mock.calls[0][0].reference);
  });

  it("the existing-row READ errors: no blind insert and no update is issued, the failure is reported as the payment-row failure, the Pass is still extended", async () => {
    const stored = newRef();
    const pass = await dueSetup({ pending_renewal_reference: stored });
    await pendingTx(stored);
    verify.mockResolvedValueOnce(verified(stored, "success"));
    faulty.fail({ table: "payment_transactions", op: "select", mode: "error", times: Infinity });
    const log = quiet();

    const summary = await run();
    log.mockRestore();

    const writes = faulty.calls.filter((c) => c.table === "payment_transactions" && (c.op === "insert" || c.op === "update"));
    expect(writes, "MONEY BUG: a failed read was treated as 'no row' and a row was written blind").toHaveLength(0);
    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/read/i);
    expect(Date.parse((await passRow()).expires_at)).toBe(expectedExpiry(pass.expires_at));
    expect((await txRows()).map((t) => t.status)).toEqual(["pending"]);
  });

  it("a unique violation (23505) on the payment-row insert is followed by a re-read and an UPDATE to success, in that order, and ends as one success row", async () => {
    await dueSetup();
    charge.mockImplementation(async (p: { reference: string }) => okResult(p.reference));
    faulty.fail({
      table: "payment_transactions",
      op: "insert",
      mode: "error",
      code: "23505",
      times: 1,
      // The row a concurrent writer made just before our insert.
      onFire: async () => pendingTx(charge.mock.calls[0][0].reference as string),
    });

    const summary = await run();

    const order = faulty.calls.filter((c) => c.table === "payment_transactions").map((c) => `${c.op}:${c.outcome}`);
    expect(order, "read, failed insert, re-read, update").toEqual(["select:sent", "insert:error", "select:sent", "update:sent"]);
    expect(summary.renewed).toBe(1);
    const txs = await txRows();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ status: "success", channel: "card", authorization_code: "AUTH_test_reusable_code" });
  });

  it("a recovered PENDING row ends as success with its channel and card token set, and there is still exactly one row for the reference", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored });
    await pendingTx(stored);
    verify.mockResolvedValueOnce(verified(stored, "success"));

    await run();

    const txs = await txRows();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ paystack_reference: stored, status: "success", channel: "card", authorization_code: "AUTH_test_reusable_code" });
  });

  it("the mismatch update fails: logged at error level, listed in summary.errors, the Pass is still lapsed", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored });
    await pendingTx(stored);
    verify.mockResolvedValueOnce({ ...verified(stored, "success"), amount: 1 });
    faulty.fail({ table: "payment_transactions", op: "update", mode: "error", times: Infinity });
    const log = quiet();

    const summary = await run();
    const text = logged(log);

    expect(charge).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/could not be marked failed/);
    expect(text).toContain(stored);
    expect((await passRow()).auto_renew_status).toBe("lapsed");
  });

  it("a failed-charge payment row that cannot be written: logged, listed, not ok, the lapse that follows is unchanged", async () => {
    await dueSetup();
    charge.mockRejectedValueOnce(await decline("Insufficient funds", 400, "card_declined"));
    faulty.fail({ table: "payment_transactions", op: "insert", mode: "error", times: Infinity });
    const log = quiet();

    const summary = await run();
    log.mockRestore();

    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/could not be recorded/);
    expect((await passRow()).auto_renew_status).toBe("lapsed");
    expect(summary.lapsed).toBe(1);
  });

  it.each(["error", "zero"] as const)("markLapsed fails (%s): lapsed is NOT counted, the failure is listed, not ok, the Pass is still active", async (mode) => {
    await dueSetup();
    charge.mockRejectedValueOnce(await decline("Insufficient funds", 400, "card_declined"));
    faulty.fail({ table: "user_passes", op: "update", mode, times: Infinity, match: (v) => v.auto_renew_status === "lapsed" });
    const log = quiet();

    const summary = await run();
    log.mockRestore();

    expect(summary.lapsed, "MONEY BUG: a lapse the database did not take was counted as done").toBe(0);
    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/lapse could not be recorded/i);
    expect((await passRow()).auto_renew_status).toBe("active");
  });
});

describe("recordIndeterminate: each of its three writes, when it fails, is loud and the bound stays intact", () => {
  it("the pending payment-row insert fails (not a unique violation): listed, not ok, the attempt is still counted and the reference kept", async () => {
    await dueSetup();
    charge.mockRejectedValueOnce(timeoutError());
    faulty.fail({ table: "payment_transactions", op: "insert", mode: "error", times: Infinity });
    const log = quiet();

    const summary = await run();
    log.mockRestore();

    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/pending payment .* could not be recorded/);
    expect(summary.indeterminate).toBe(1);
    expect((await passRow()).renewal_attempt_count).toBe(1);
  });

  it("the reference and attempt write fails: loud, not ok, NOT counted as an indeterminate attempt", async () => {
    await dueSetup();
    charge.mockRejectedValueOnce(timeoutError());
    faulty.fail({ table: "user_passes", op: "update", mode: "error", times: Infinity, match: (v) => "renewal_attempt_count" in v && v.renewal_claimed_at === null && typeof v.pending_renewal_reference === "string" });
    const log = quiet();

    const summary = await run();
    const text = logged(log);

    expect(summary.ok).toBe(false);
    expect(summary.indeterminate, "an attempt that was not recorded must not be reported as recorded").toBe(0);
    expect(text).toMatch(/UNRECORDED indeterminate attempt/);
    expect((await passRow()).auto_renew_status).toBe("active");
  });

  it("the give-up counter write fails at the three-attempt ceiling: loud, not ok, the Pass is lapsed and the reference is kept", async () => {
    const stored = newRef();
    await dueSetup({ pending_renewal_reference: stored, renewal_attempt_count: 2 });
    verify.mockRejectedValueOnce(timeoutError());
    faulty.fail({ table: "user_passes", op: "update", mode: "error", times: Infinity, match: (v) => "last_renewal_failure_at" in v && !("pending_renewal_reference" in v) });
    const log = quiet();

    const summary = await run();
    const text = logged(log);

    expect(summary.ok).toBe(false);
    expect(summary.errors.map((e) => e.message).join("\n")).toMatch(/give-up counters .* could not be written/);
    expect(text).toContain(stored);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("lapsed");
    expect(row.pending_renewal_reference).toBe(stored);
  });
});

describe("a genuine decline still ends the subscription, and clears the spent reference", () => {
  it("a fresh decline: lapsed, one failed row, the reference cleared so the ops screen does not list it as stuck", async () => {
    await dueSetup();
    charge.mockRejectedValueOnce(await decline("Insufficient funds", 400, "card_declined"));

    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.lapsed).toBe(1);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("lapsed");
    expect(row.pending_renewal_reference).toBeNull();
    expect((await txRows()).map((t) => t.status)).toEqual(["failed"]);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * Follow-up to PR-B (no-downgrade rule, early lapse, stale-reference boundary).
 * ─────────────────────────────────────────────────────────────────────────── */

/** A payment row at a final status, with distinctive values so any overwrite shows. */
async function seedPaymentRow(reference: string, status: "success" | "failed") {
  const { error } = await admin.from("payment_transactions").insert({
    user_id: userId,
    rail: "paystack",
    amount: passPriceNgn,
    currency: "NGN",
    product_type: "pass",
    product_id: passId,
    paystack_reference: reference,
    status,
    channel: "bank",
    authorization_code: "AUTH_seeded_row",
    renewal_for_pass_id: userPassId,
  });
  if (error) throw error;
}
const fullRows = async (reference: string) => (await admin.from("payment_transactions").select("*").eq("paystack_reference", reference)).data ?? [];

describe("recordIndeterminate never changes an existing payment row (the no-downgrade rule)", () => {
  it.each(["success", "failed"] as const)(
    "a row already at '%s' for the reference: the pending insert loses on the unique key and the row is byte-for-byte unchanged, with no second row",
    async (status) => {
      const stored = newRef();
      await dueSetup({ pending_renewal_reference: stored });
      await seedPaymentRow(stored, status);
      const before = await fullRows(stored);
      verify.mockRejectedValueOnce(await decline("Transaction reference not found.", 400, "transaction_not_found"));
      charge.mockRejectedValueOnce(timeoutError()); // not a decline: recordIndeterminate runs with an amount, so it tries the pending insert

      const summary = await run();

      expect(charge).toHaveBeenCalledTimes(1);
      expect(summary.indeterminate).toBe(1);
      const after = await fullRows(stored);
      expect(after, "MONEY BUG: an existing payment row was changed by the indeterminate path").toEqual(before);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe(status);
      const updates = faulty.calls.filter((c) => c.table === "payment_transactions" && c.op !== "select" && c.op !== "insert");
      expect(updates, "a lost unique race is 'already exists': nothing else is written").toHaveLength(0);
    },
  );

  it.each(["success", "failed"] as const)(
    "the insert loses a RACE (a concurrent writer made the row '%s' just before it): treated as already existing, nothing further is written, the row is unchanged",
    async (status) => {
      await dueSetup();
      charge.mockRejectedValueOnce(timeoutError());
      let reference = "";
      faulty.fail({
        table: "payment_transactions",
        op: "insert",
        mode: "error",
        code: "23505",
        times: 1,
        onFire: async () => {
          reference = charge.mock.calls[0][0].reference as string;
          await seedPaymentRow(reference, status);
        },
      });

      const summary = await run();

      expect(summary.indeterminate).toBe(1);
      const rows = await fullRows(reference);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status, channel: "bank", authorization_code: "AUTH_seeded_row" });
      const others = faulty.calls.filter((c) => c.table === "payment_transactions" && c.op !== "select");
      expect(others.map((c) => `${c.op}:${c.outcome}`), "only the one failed insert, nothing after it").toEqual(["insert:error"]);
    },
  );
});

describe("an early lapse (nothing to charge) keeps a stored reference", () => {
  it("a Pass with a missing card token and a stored pending_renewal_reference: lapsed, and the reference is STILL on the row; Paystack is not asked anything", async () => {
    const stored = newRef();
    await dueSetup({ authorization_code: null, pending_renewal_reference: stored });

    const summary = await run();

    expect(summary.lapsed).toBe(1);
    expect(charge).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    const row = await passRow();
    expect(row.auto_renew_status).toBe("lapsed");
    expect(row.pending_renewal_reference, "MONEY BUG: the only thread back to money that may have moved was cleared by a lapse that asked Paystack nothing").toBe(stored);
  });

  it("a Pass with a missing card token and NO stored reference lapses as before", async () => {
    await dueSetup({ authorization_code: null });
    const summary = await run();
    expect(summary.lapsed).toBe(1);
    const row = await passRow();
    expect(row.auto_renew_status).toBe("lapsed");
    expect(row.pending_renewal_reference).toBeNull();
  });
});

describe("a recovered success whose period is already in place: decided on INSTANTS against the start of the next UTC day", () => {
  /*
   * A due Pass has next_renewal_date <= today (UTC date), and next_renewal_date is the UTC date of its expiry, so a genuinely due Pass expires BEFORE the start of the next UTC
   * day. A recovered success on a Pass whose expiry is at or after that instant has already been applied: it is not extended again. All date arithmetic is UTC.
   * The clock is pinned (Date only) at 12:00:00Z so the boundary cannot move under the test.
   */
  const pinned = () => {
    const now = new Date();
    const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
    const boundary = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return { noon, boundary };
  };
  afterEach(() => vi.useRealTimers());

  async function recoveredAt(expiryMs: number) {
    const stored = newRef();
    const { noon } = pinned();
    const pass = await dueSetup({ expires_at: new Date(expiryMs).toISOString(), pending_renewal_reference: stored });
    await pendingTx(stored);
    verify.mockResolvedValueOnce(verified(stored, "success"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(noon);
    const summary = await run();
    vi.useRealTimers();
    return { stored, pass, summary };
  }

  it("one second BEFORE the boundary: genuinely new, the Pass IS extended by one period and the reference cleared", async () => {
    const { boundary } = pinned();
    const { summary, pass } = await recoveredAt(boundary - 1000);
    expect(summary.renewed).toBe(1);
    const row = await passRow();
    expect(Date.parse(row.expires_at)).toBe(expectedExpiry(pass.expires_at));
    expect(row.pending_renewal_reference).toBeNull();
    expect(charge).not.toHaveBeenCalled();
  });

  it("exactly AT the boundary: already in place, expiry unchanged, next_renewal_date is the expiry's UTC date, the reference cleared", async () => {
    const { boundary } = pinned();
    await recoveredAt(boundary);
    const row = await passRow();
    expect(Date.parse(row.expires_at)).toBe(boundary);
    expect(row.next_renewal_date).toBe(new Date(boundary).toISOString().slice(0, 10));
    expect(row.pending_renewal_reference).toBeNull();
    expect(await txRows()).toMatchObject([{ status: "success" }]);
  });

  it("one second AFTER the boundary: already in place, expiry unchanged, next_renewal_date is the expiry's UTC date", async () => {
    const { boundary } = pinned();
    await recoveredAt(boundary + 1000);
    const row = await passRow();
    expect(Date.parse(row.expires_at)).toBe(boundary + 1000);
    expect(row.next_renewal_date).toBe(new Date(boundary + 1000).toISOString().slice(0, 10));
    expect(row.pending_renewal_reference).toBeNull();
  });

  it("a recovered success that is genuinely new (expired two hours before the boundary) still extends", async () => {
    const { boundary } = pinned();
    const { summary, pass } = await recoveredAt(boundary - 2 * 3_600_000);
    expect(summary.renewed).toBe(1);
    expect(Date.parse((await passRow()).expires_at)).toBe(expectedExpiry(pass.expires_at));
  });
});
