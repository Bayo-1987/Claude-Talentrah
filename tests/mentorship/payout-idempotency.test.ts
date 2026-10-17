/**
 * Mentor payouts (0149) — the first OUTBOUND-money feature in this codebase,
 * held to the idempotency bar CLAUDE.md sets for anything gating on a
 * compared value: check-and-act in ONE database statement, never a
 * read-then-write. `claim_mentor_payout` and `attemptPayout`
 * (src/lib/mentorship/payouts.ts) are what this file proves, the same way
 * tests/talent-directory/subscription-idempotency.test.ts proves
 * fulfillPayment and tests/mentorship/no-show-sweep.test.ts proves the
 * refund sweep — real database, real rows, only Paystack itself mocked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { createFaultyClient, type FaultyClient } from "../support/faulty-service-client";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Payout idempotency test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const initiateTransfer = vi.hoisted(() => vi.fn());
const verifyTransfer = vi.hoisted(() => vi.fn());
const requirePermission = vi.hoisted(() => vi.fn(async () => ({})));
const revalidatePath = vi.hoisted(() => vi.fn());
const holder = vi.hoisted(() => ({ faulty: null as null | { client: unknown } }));

/**
 * The service-role client every payouts.ts write goes through is the REAL client wrapped so a chosen write can fail (tests/support/faulty-service-client.ts).
 * With no rule set it is a pass-through, so every older test in this file still runs against the real database exactly as before.
 */
vi.mock("@/lib/supabase/service-role", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/service-role")>();
  return { ...actual, createServiceRoleClient: () => (holder.faulty ? (holder.faulty.client as ReturnType<typeof actual.createServiceRoleClient>) : actual.createServiceRoleClient()) };
});
vi.mock("@/lib/admin/require-admin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/require-admin")>()), requirePermission }));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath }));

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, initiateTransfer, verifyTransfer };
});

let mentorId: string;
let menteeId: string;
const sessionIds: string[] = [];
const payoutIds: string[] = [];

beforeAll(async () => {
  const mentor = await createTestUser("payout-mentor");
  const mentee = await createTestUser("payout-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;
  const { error } = await admin.from("mentor_profiles").insert({
    user_id: mentorId,
    status: "approved",
    base_price_ngn: 15_000,
    payout_bank_code: "058",
    payout_account_number: "0123456789",
    payout_account_name: "Test Mentor",
    payout_recipient_code: "RCP_test_fixture",
    payout_bank_verified_at: new Date().toISOString(),
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

let faulty: FaultyClient<ReturnType<typeof import("@/lib/supabase/service-role").createServiceRoleClient>>;

beforeEach(async () => {
  initiateTransfer.mockReset();
  verifyTransfer.mockReset();
  requirePermission.mockClear();
  revalidatePath.mockClear();
  const actual = await vi.importActual<typeof import("@/lib/supabase/service-role")>("@/lib/supabase/service-role");
  faulty = createFaultyClient(actual.createServiceRoleClient());
  holder.faulty = faulty;
});

afterEach(async () => {
  if (payoutIds.length) await admin.from("mentor_payouts").delete().in("id", payoutIds);
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds);
  payoutIds.length = 0;
  sessionIds.length = 0;
});

/** A COMPLETED, paid session — bypasses book_mentor_session so the fixture can set an arbitrary scheduled_end/status directly. */
async function makeCompletedSession(priceNgn: number) {
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentorId,
      start_at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
      end_at: new Date(Date.now() - 5 * 24 * 3600_000 + 3600_000).toISOString(),
      is_booked: true,
    })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");

  const commission = Math.round(priceNgn * 0.15);
  const { data: session, error } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorId,
      mentee_id: menteeId,
      availability_slot_id: slot.id,
      session_type: "resume_review",
      scheduled_start: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
      scheduled_end: new Date(Date.now() - 5 * 24 * 3600_000 + 3600_000).toISOString(),
      price_ngn: priceNgn,
      platform_commission_ngn: commission,
      mentor_payout_ngn: priceNgn - commission,
      status: "completed",
    })
    .select("id, mentor_payout_ngn")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);
  return session;
}

/** A payout row, already ELIGIBLE (past its hold window) — bypasses sync_mentor_payout_rows so the fixture doesn't have to wait 72 real hours. */
async function makeEligiblePayout(sessionId: string, amountNgn: number) {
  const { data: payout, error } = await admin
    .from("mentor_payouts")
    .insert({
      session_id: sessionId,
      mentor_id: mentorId,
      amount_ngn: amountNgn,
      eligible_at: new Date(Date.now() - 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !payout) throw error ?? new Error("no payout row");
  payoutIds.push(payout.id);
  return payout.id;
}

async function payoutRow(id: string) {
  const { data } = await admin
    .from("mentor_payouts")
    .select("status, attempt_count, pending_transfer_reference, paystack_transfer_code, failure_reason, last_attempted_at")
    .eq("id", id)
    .single();
  return data!;
}

describe("attemptPayout: claim_mentor_payout makes a single row's attempt idempotent under concurrency", () => {
  it("CONCURRENT attemptPayout calls on the SAME row: Paystack is charged exactly once", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    initiateTransfer.mockResolvedValue({
      transfer_code: "TRF_1",
      reference: "irrelevant-overridden-by-caller",
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const [a, b] = await Promise.all([attemptPayout(payoutId), attemptPayout(payoutId)]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(
      outcomes,
      "MONEY BUG: two concurrent attempts both won the claim on the same payout row",
    ).toEqual(["not_eligible", "paid"]);
    expect(initiateTransfer, "MONEY BUG: Paystack was asked to transfer money twice for one session").toHaveBeenCalledTimes(1);

    const after = await payoutRow(payoutId);
    expect(after.status).toBe("paid");
  });

  it("a payout already PAID cannot be re-attempted by a manual retry", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockResolvedValue({
      transfer_code: "TRF_2",
      reference: "x",
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("paid");

    const second = await attemptPayout(payoutId);
    expect(second.outcome, "MONEY BUG: a retry re-paid an already-paid session").toBe("not_eligible");
    expect(initiateTransfer, "MONEY BUG: a second transfer was requested for an already-paid session").toHaveBeenCalledTimes(1);
  });
});

describe("attemptPayout: a genuinely FAILED transfer is retryable without double-paying", () => {
  it("a declined transfer is marked failed, and a later retry with a FRESH reference can still succeed", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    const { PaystackDeclineError } = await import("@/lib/paystack/client");
    initiateTransfer.mockRejectedValueOnce(new PaystackDeclineError("Invalid recipient", 400));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("failed");
    const afterFirst = await payoutRow(payoutId);
    expect(afterFirst.status).toBe("failed");
    expect(afterFirst.pending_transfer_reference, "a DECLINED attempt must not leave a reference to resume").toBeNull();

    initiateTransfer.mockResolvedValueOnce({
      transfer_code: "TRF_retry",
      reference: "x",
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });
    const second = await attemptPayout(payoutId);
    expect(second.outcome).toBe("paid");

    expect(initiateTransfer).toHaveBeenCalledTimes(2);
    const refs = initiateTransfer.mock.calls.map((c) => c[0].reference);
    expect(
      new Set(refs).size,
      "MONEY BUG: the retry reused the failed attempt's own reference instead of minting a fresh one",
    ).toBe(2);

    const after = await payoutRow(payoutId);
    expect(after.status).toBe("paid");
  });
});

describe("attemptPayout: an INDETERMINATE outcome is resolved, never blindly retried with a new charge", () => {
  it("a network failure keeps the row retryable, and the retry VERIFIES the same reference instead of transferring again", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    const { PaystackUnavailableError } = await import("@/lib/paystack/client");
    initiateTransfer.mockRejectedValueOnce(new PaystackUnavailableError("timed out"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("indeterminate");

    const afterFirst = await payoutRow(payoutId);
    expect(afterFirst.status, "an indeterminate outcome must stay retryable, not become a terminal failure").toBe("pending");
    expect(afterFirst.pending_transfer_reference, "the outstanding reference must be retained so it can be resolved").not.toBeNull();
    const outstandingReference = afterFirst.pending_transfer_reference!;

    // The retry must VERIFY the same reference, never call initiateTransfer
    // again — Paystack may already have created that transfer.
    verifyTransfer.mockResolvedValueOnce({
      transfer_code: "TRF_resolved",
      reference: outstandingReference,
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });

    const second = await attemptPayout(payoutId);
    expect(second.outcome).toBe("paid");
    expect(verifyTransfer).toHaveBeenCalledWith(outstandingReference);
    expect(
      initiateTransfer,
      "MONEY BUG: an indeterminate outcome was resolved by transferring AGAIN instead of verifying the outstanding reference",
    ).toHaveBeenCalledTimes(1);

    const after = await payoutRow(payoutId);
    expect(after.status).toBe("paid");
    expect(after.paystack_transfer_code).toBe("TRF_resolved");
  });

  it("repeated indeterminate outcomes eventually need manual reconciliation, and the reference is KEPT, not discarded", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    const { PaystackUnavailableError } = await import("@/lib/paystack/client");
    initiateTransfer.mockRejectedValue(new PaystackUnavailableError("timed out"));
    verifyTransfer.mockRejectedValue(new PaystackUnavailableError("timed out"));

    const { attemptPayout, MAX_INDETERMINATE_PAYOUT_ATTEMPTS } = await import("@/lib/mentorship/payouts");

    let lastOutcome;
    for (let i = 0; i < MAX_INDETERMINATE_PAYOUT_ATTEMPTS + 1; i++) {
      lastOutcome = await attemptPayout(payoutId);
    }

    expect(lastOutcome!.outcome).toBe("failed");
    const after = await payoutRow(payoutId);
    expect(after.status).toBe("failed");
    expect(
      after.pending_transfer_reference,
      "MONEY BUG: the only thread back to a transfer of unknown outcome was discarded",
    ).not.toBeNull();
    expect(after.failure_reason).toMatch(/reconcil/i);
  });
});

describe("attemptPayout: the withheld-standing gate", () => {
  it("refuses to pay a mentor who is no longer approved, without ever calling Paystack", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    await admin.from("mentor_profiles").update({ status: "suspended" }).eq("user_id", mentorId);
    try {
      const { attemptPayout } = await import("@/lib/mentorship/payouts");
      const outcome = await attemptPayout(payoutId);
      expect(outcome.outcome).toBe("failed");
      expect(initiateTransfer, "a suspended mentor's payout must never reach Paystack").not.toHaveBeenCalled();

      const after = await payoutRow(payoutId);
      expect(after.status).toBe("failed");
      expect(after.failure_reason).toMatch(/not currently approved/i);
    } finally {
      await admin.from("mentor_profiles").update({ status: "approved" }).eq("user_id", mentorId);
    }
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * PAYOUT-RENEWAL-UNCHECKED-WRITES-1, PR-A: the reference is saved BEFORE money moves, and a terminal write that fails is never reported as success.
 *
 * Every test below was run against the unmodified src/lib/mentorship/payouts.ts first and failed there (reports/S3/2026-10-17-payout-checked-writes-pr-a.md prints each failure),
 * except the one pin that guards a format which was already right.
 * ─────────────────────────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function ageClaim(id: string, minutes: number) {
  const { error } = await admin
    .from("mentor_payouts")
    .update({ last_attempted_at: new Date(Date.now() - minutes * MINUTE).toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** A payout row that an earlier attempt left behind: a stored reference, at the given status, last attempted `minutesAgo` minutes ago. */
async function makeLeftBehindPayout(
  sessionId: string,
  amountNgn: number,
  opts: { status: "pending" | "processing"; reference: string | null; minutesAgo: number },
) {
  const { data, error } = await admin
    .from("mentor_payouts")
    .insert({
      session_id: sessionId,
      mentor_id: mentorId,
      amount_ngn: amountNgn,
      eligible_at: new Date(Date.now() - 3600_000).toISOString(),
      status: opts.status,
      attempt_count: 1,
      last_attempted_at: new Date(Date.now() - opts.minutesAgo * MINUTE).toISOString(),
      pending_transfer_reference: opts.reference,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no payout row");
  payoutIds.push(data.id);
  return data.id;
}

const transferResult = (amountNgn: number, reference: string, status: string, code = "TRF_ok") => ({
  transfer_code: code,
  reference,
  amount: amountNgn * 100,
  currency: "NGN",
  status,
});

async function declineError(message: string, status: number) {
  const { PaystackDeclineError } = await import("@/lib/paystack/client");
  return new PaystackDeclineError(message, status);
}

const newReference = () => `mentor_payout_${crypto.randomUUID()}`;

describe("attemptPayout: the reference is saved BEFORE initiateTransfer is called", () => {
  it("call order: the reference is on the row, and the write that saved it came first, when Paystack is asked to transfer", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    let referenceOnRowAtCall: string | null | undefined;
    let writesBeforeCall = -1;
    initiateTransfer.mockImplementation(async (p: { reference: string }) => {
      referenceOnRowAtCall = (await payoutRow(payoutId)).pending_transfer_reference;
      writesBeforeCall = faulty.calls.findIndex((c) => c.table === "mentor_payouts" && c.op === "update" && typeof c.values?.pending_transfer_reference === "string");
      return transferResult(session.mentor_payout_ngn, p.reference, "success");
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    expect(outcome.outcome).toBe("paid");

    const sent = initiateTransfer.mock.calls[0][0].reference as string;
    expect(
      referenceOnRowAtCall,
      "MONEY BUG: when initiateTransfer ran, the reference was not on the payout row, so a crash after the transfer leaves no thread back to it",
    ).toBe(sent);
    expect(writesBeforeCall, "the write that saves the reference must be recorded before the transfer call").toBeGreaterThanOrEqual(0);
  });

  it("a reference write that returns an error: initiateTransfer is never called, nothing moves, the row goes back to pending", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));
    // Every retry of the reference write fails too.
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "error", times: Infinity, match: (v) => typeof v.pending_transfer_reference === "string" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    log.mockRestore();

    expect(initiateTransfer, "MONEY BUG: a transfer was started although its reference could not be saved").not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("reference_unsaved");
    const row = await payoutRow(payoutId);
    expect(row.status, "the row must go back to the queue so the next run can try again").toBe("pending");
    expect(row.pending_transfer_reference).toBeNull();
  });

  it("a reference write that matches 0 rows: initiateTransfer is never called", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "zero", times: Infinity, match: (v) => typeof v.pending_transfer_reference === "string" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    log.mockRestore();

    expect(initiateTransfer, "MONEY BUG: a transfer was started although the reference write matched no row").not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("reference_unsaved");
  });

  it("if the reference write fails AND the row cannot be put back to pending, it stays processing with no reference and the next attempt refuses it (needs_review)", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "error", times: Infinity, match: (v) => typeof v.pending_transfer_reference === "string" });
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "error", times: Infinity, match: (v) => v.status === "pending" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("reference_unsaved");
    expect((await payoutRow(payoutId)).status).toBe("processing");

    holder.faulty = null; // the database is healthy again
    await ageClaim(payoutId, 20);
    const second = await attemptPayout(payoutId);
    log.mockRestore();

    expect(second.outcome).toBe("needs_review");
    expect(initiateTransfer, "MONEY BUG: a stuck row with no reference was sent to Paystack").not.toHaveBeenCalled();
  });
});

describe("attemptPayout: a crash after the transfer is resolved through the SAVED reference, never by a second transfer", () => {
  it("the process dies after initiateTransfer returns and before markPaid; the next attempt verifies the stored reference and starts NO new transfer", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, "success", "TRF_crashed"));
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "crash", match: (v) => v.status === "paid" });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    await expect(attemptPayout(payoutId)).rejects.toThrow(/simulated crash/);

    const stuck = await payoutRow(payoutId);
    expect(stuck.status).toBe("processing");
    const savedReference = stuck.pending_transfer_reference;
    expect(savedReference, "MONEY BUG: the transfer went out and no reference was left on the row").not.toBeNull();
    expect(initiateTransfer.mock.calls[0][0].reference).toBe(savedReference);

    holder.faulty = null;
    await ageClaim(payoutId, 16);
    verifyTransfer.mockImplementation(async (reference: string) => transferResult(session.mentor_payout_ngn, reference, "success", "TRF_crashed"));

    const second = await attemptPayout(payoutId);
    expect(second.outcome).toBe("paid");
    expect(verifyTransfer).toHaveBeenCalledWith(savedReference);
    expect(initiateTransfer, "MONEY BUG: a second transfer was started for a payout whose first transfer succeeded").toHaveBeenCalledTimes(1);
    expect((await payoutRow(payoutId)).status).toBe("paid");
  });
});

describe("attemptPayout: a stored reference is reused only when Paystack says, with a 404, that it was never created", () => {
  it("verify answers 404: initiateTransfer is called with the SAME reference, not a new one", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    verifyTransfer.mockRejectedValueOnce(await declineError("Transfer not found", 404));
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, "success"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("paid");
    expect(initiateTransfer).toHaveBeenCalledTimes(1);
    expect(initiateTransfer.mock.calls[0][0].reference, "a reference Paystack never created must be reused, not replaced").toBe(stored);
  });

  it.each([400, 401, 403, 429])("verify answers HTTP %i for the stored reference: no transfer, outcome indeterminate, reference kept", async (httpStatus) => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    verifyTransfer.mockRejectedValueOnce(await declineError(`Paystack said ${httpStatus}`, httpStatus));
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(initiateTransfer, `MONEY BUG: an HTTP ${httpStatus} on a verify call started a new transfer`).not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("indeterminate");
    const row = await payoutRow(payoutId);
    expect(row.status).toBe("pending");
    expect(row.pending_transfer_reference).toBe(stored);
  });

  it("verify answers a status nobody has seen ('received'): treated as unfinished, no transfer", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    verifyTransfer.mockResolvedValueOnce(transferResult(session.mentor_payout_ngn, stored, "received"));
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(initiateTransfer, "MONEY BUG: an unrecognised transfer status was read as 'failed' and a second transfer was started").not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("indeterminate");
  });

  it("an AFFIRMED failed (or reversed) reference is replaced by a new one, and the new one is on the row before the transfer", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    verifyTransfer.mockResolvedValueOnce(transferResult(session.mentor_payout_ngn, stored, "reversed"));
    let referenceOnRowAtCall: string | null | undefined;
    initiateTransfer.mockImplementation(async (p: { reference: string }) => {
      referenceOnRowAtCall = (await payoutRow(payoutId)).pending_transfer_reference;
      return transferResult(session.mentor_payout_ngn, p.reference, "success");
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("paid");
    const sent = initiateTransfer.mock.calls[0][0].reference as string;
    expect(sent, "a reversed transfer's reference cannot be reused: Paystack already has it").not.toBe(stored);
    expect(referenceOnRowAtCall, "MONEY BUG: the replacement reference was not saved before the transfer").toBe(sent);
  });

  it("a decline on a REUSED reference is verified once: if Paystack in fact has it and it succeeded, the payout is paid, not failed", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    verifyTransfer.mockRejectedValueOnce(await declineError("Transfer not found", 404));
    initiateTransfer.mockRejectedValueOnce(await declineError("Transfer with this reference already exists", 400));
    verifyTransfer.mockResolvedValueOnce(transferResult(session.mentor_payout_ngn, stored, "success", "TRF_exists"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(verifyTransfer).toHaveBeenCalledTimes(2);
    expect(outcome.outcome).toBe("paid");
    const row = await payoutRow(payoutId);
    expect(row.status).toBe("paid");
    expect(row.paystack_transfer_code).toBe("TRF_exists");
  });

  it("a decline on a reused reference that Paystack really does not have is a genuine decline: failed, reference cleared", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    verifyTransfer.mockRejectedValue(await declineError("Transfer not found", 404));
    initiateTransfer.mockRejectedValueOnce(await declineError("Invalid recipient", 400));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("failed");
    const row = await payoutRow(payoutId);
    expect(row.status).toBe("failed");
    expect(row.pending_transfer_reference).toBeNull();
  });
});

describe("attemptPayout: the transfer reference keeps its exact format", () => {
  it("is 'mentor_payout_' + a UUID, 50 characters: Paystack's maximum for a transfer reference", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, "success"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    await attemptPayout(payoutId);

    const reference = initiateTransfer.mock.calls[0][0].reference as string;
    expect(reference).toMatch(new RegExp(`^mentor_payout_${UUID}$`));
    expect(reference.length, "Paystack allows 16 to 50 characters; a longer prefix would make every payout fail").toBe(50);
  });
});

describe("attemptPayout: a terminal write that fails is NEVER reported as paid", () => {
  it("markPaid: the update returns an error twice: outcome paid_unrecorded, the error log carries payout id, reference, transfer code and intended status, and the row is not marked paid", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, "success", "TRF_unrecorded"));
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "error", times: Infinity, match: (v) => v.status === "paid" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();

    expect(outcome.outcome, "MONEY BUG: a payout whose paid status could not be written was reported as paid").toBe("paid_unrecorded");
    const reference = initiateTransfer.mock.calls[0][0].reference as string;
    expect(logged).toContain(payoutId);
    expect(logged).toContain(reference);
    expect(logged).toContain("TRF_unrecorded");
    expect(logged).toMatch(/intended_status=paid/);
    expect((await payoutRow(payoutId)).status, "the row must not claim a state the database never took").toBe("processing");
  });

  it("markPaid: the first write errors, the single retry succeeds: outcome paid and the row is paid", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, "success", "TRF_retry_ok"));
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "error", times: 1, match: (v) => v.status === "paid" });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("paid");
    const row = await payoutRow(payoutId);
    expect(row.status, "one failed write must be retried once before it is given up on").toBe("paid");
    expect(row.paystack_transfer_code).toBe("TRF_retry_ok");
  });

  it("markPaid: the update matches 0 rows because the row is no longer this attempt's (someone set it to failed): paid_unrecorded", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => {
      await admin.from("mentor_payouts").update({ status: "failed", failure_reason: "changed by hand while the transfer was out" }).eq("id", payoutId);
      return transferResult(session.mentor_payout_ngn, p.reference, "success", "TRF_zero");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    log.mockRestore();

    expect(outcome.outcome, "MONEY BUG: a paid report for a row the database did not mark paid").toBe("paid_unrecorded");
    expect((await payoutRow(payoutId)).status).toBe("failed");
  });

  it("markPaid: 0 rows but the row already holds this very payment (paid with the same transfer code): still paid", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => {
      await admin.from("mentor_payouts").update({ status: "paid", paystack_transfer_code: "TRF_same", pending_transfer_reference: null, paid_at: new Date().toISOString() }).eq("id", payoutId);
      return transferResult(session.mentor_payout_ngn, p.reference, "success", "TRF_same");
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("paid");
  });

  it("a stale attempt cannot overwrite a newer claim: its markPaid is fenced out by attempt_count and reported paid_unrecorded", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => {
      // While this attempt's transfer is out, a newer claim takes the row.
      await admin.from("mentor_payouts").update({ attempt_count: 2 }).eq("id", payoutId);
      return transferResult(session.mentor_payout_ngn, p.reference, "success", "TRF_stale");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    log.mockRestore();

    expect(outcome.outcome).toBe("paid_unrecorded");
    const row = await payoutRow(payoutId);
    expect(row.status, "the stale attempt must not write over the newer claim's row").toBe("processing");
    expect(row.pending_transfer_reference, "the reference stays so the newer claim verifies it").not.toBeNull();
  });

  it("recordFailure: the update errors (error) or matches no row (zero): failure_unrecorded, never 'failed'", async () => {
    for (const mode of ["error", "zero"] as const) {
      const session = await makeCompletedSession(15_000);
      const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
      initiateTransfer.mockRejectedValueOnce(await declineError("Invalid recipient", 400));
      faulty.reset();
      faulty.fail({ table: "mentor_payouts", op: "update", mode, times: Infinity, match: (v) => v.status === "failed" });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const { attemptPayout } = await import("@/lib/mentorship/payouts");
      const outcome = await attemptPayout(payoutId);
      log.mockRestore();

      expect(outcome.outcome, `MONEY BUG: a failure that could not be written was reported as recorded (${mode})`).toBe("failure_unrecorded");
      expect((await payoutRow(payoutId)).status).toBe("processing");
    }
  });

  it("recordIndeterminate below the ceiling: the update errors or matches no row: indeterminate_unrecorded, and the reference stays on the row", async () => {
    for (const mode of ["error", "zero"] as const) {
      const session = await makeCompletedSession(15_000);
      const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
      const { PaystackUnavailableError } = await import("@/lib/paystack/client");
      initiateTransfer.mockRejectedValueOnce(new PaystackUnavailableError("timed out"));
      faulty.reset();
      faulty.fail({ table: "mentor_payouts", op: "update", mode, times: Infinity, match: (v) => v.status === "pending" && "failure_reason" in v });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const { attemptPayout } = await import("@/lib/mentorship/payouts");
      const outcome = await attemptPayout(payoutId);
      log.mockRestore();

      expect(outcome.outcome, `an unresolved attempt that could not be recorded was reported as recorded (${mode})`).toBe("indeterminate_unrecorded");
      const row = await payoutRow(payoutId);
      expect(row.status).toBe("processing");
      expect(row.pending_transfer_reference, "the reference was saved before the transfer, so it survives this failed write").not.toBeNull();
    }
  });

  it("recordIndeterminate at the ceiling (3 unresolved attempts): the update errors: failure_unrecorded, NEEDS RECONCILIATION is logged, the reference is kept", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "pending", reference: stored, minutesAgo: 30 });
    await admin.from("mentor_payouts").update({ attempt_count: 2 }).eq("id", payoutId); // the next claim makes it attempt 3
    const { PaystackUnavailableError } = await import("@/lib/paystack/client");
    verifyTransfer.mockRejectedValue(new PaystackUnavailableError("timed out"));
    faulty.fail({ table: "mentor_payouts", op: "update", mode: "error", times: Infinity, match: (v) => v.status === "failed" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();

    expect(outcome.outcome).toBe("failure_unrecorded");
    expect(logged).toContain(payoutId);
    expect(logged).toContain(stored);
    expect((await payoutRow(payoutId)).pending_transfer_reference).toBe(stored);
  });
});

describe("attemptPayout: a row stuck at processing with NO reference is never claimed and never transferred", () => {
  it("attemptPayout: a stale processing row with no reference returns needs_review, claims nothing, calls Paystack for nothing", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "processing", reference: null, minutesAgo: 20 });
    const before = await payoutRow(payoutId);
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);
    log.mockRestore();

    expect(outcome.outcome, "MONEY BUG: a processing row with no reference was reclaimed; its first transfer may already have gone out").toBe("needs_review");
    expect(initiateTransfer).not.toHaveBeenCalled();
    expect(verifyTransfer).not.toHaveBeenCalled();
    const after = await payoutRow(payoutId);
    expect(after.attempt_count, "the row must not have been claimed").toBe(before.attempt_count);
    expect(after.last_attempted_at).toBe(before.last_attempted_at);
    expect(after.status).toBe("processing");
  });

  it("the admin action: retryMentorPayoutAction on that row answers an honest error (never 'Paid.') and sends nothing", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "processing", reference: null, minutesAgo: 20 });
    initiateTransfer.mockResolvedValue(transferResult(session.mentor_payout_ngn, "x", "success"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { retryMentorPayoutAction } = await import("@/lib/admin/mentor-payouts/actions");
    const result = await retryMentorPayoutAction(payoutId);
    log.mockRestore();

    expect(initiateTransfer).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    expect(result.message).not.toMatch(/^Paid\.?$/);
    expect(result.message).toMatch(/Paystack/);
    expect(result.message).toMatch(/no (Paystack )?reference/i);
  });

  it("a processing row with no reference that is RECENT is another attempt in flight: not_eligible, as before", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "processing", reference: null, minutesAgo: 1 });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("not_eligible");
    expect(initiateTransfer).not.toHaveBeenCalled();
  });

  it("a stale processing row that DOES carry a reference is reclaimed and settled through verifyTransfer", async () => {
    const session = await makeCompletedSession(15_000);
    const stored = newReference();
    const payoutId = await makeLeftBehindPayout(session.id, session.mentor_payout_ngn, { status: "processing", reference: stored, minutesAgo: 20 });
    verifyTransfer.mockResolvedValueOnce(transferResult(session.mentor_payout_ngn, stored, "success", "TRF_reclaimed"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("paid");
    expect(verifyTransfer).toHaveBeenCalledWith(stored);
    expect(initiateTransfer).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * PR-A follow-up: what initiateTransfer ANSWERS is read the way verifyTransfer's answer is. Only 'failed' and 'reversed' are an affirmed failure; 'success' is paid;
 * 'pending', 'otp' and every other status (a queued 'received', one nobody has seen) is an accepted request that may still complete, so its reference stays on the row.
 * ─────────────────────────────────────────────────────────────────────────── */
describe("attemptPayout: a status initiateTransfer returns that is not success, failed or reversed keeps the reference", () => {
  it.each(["received", "queued-by-the-bank-7"])(
    "initiate answers status '%s': indeterminate, the reference and transfer code stay on the row, and the next attempt VERIFIES it and never transfers again",
    async (status) => {
      const session = await makeCompletedSession(15_000);
      const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
      initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, status, "TRF_queued"));

      const { attemptPayout } = await import("@/lib/mentorship/payouts");
      const first = await attemptPayout(payoutId);

      expect(first.outcome, `MONEY BUG: a transfer Paystack accepted with status '${status}' was recorded as a failure`).toBe("indeterminate");
      const sent = initiateTransfer.mock.calls[0][0].reference as string;
      const after = await payoutRow(payoutId);
      expect(after.status).toBe("pending");
      expect(after.pending_transfer_reference, "MONEY BUG: the reference of a transfer that may still complete was cleared").toBe(sent);
      expect(after.paystack_transfer_code).toBe("TRF_queued");

      verifyTransfer.mockResolvedValueOnce(transferResult(session.mentor_payout_ngn, sent, "success", "TRF_queued"));
      const second = await attemptPayout(payoutId);

      expect(second.outcome).toBe("paid");
      expect(verifyTransfer).toHaveBeenCalledWith(sent);
      expect(initiateTransfer, "MONEY BUG: a second transfer was started for a payout whose first transfer Paystack had accepted").toHaveBeenCalledTimes(1);
      expect((await payoutRow(payoutId)).status).toBe("paid");
    },
  );

  it("initiate answers 'received' and a later verify still says 'received': still indeterminate, still no second transfer", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, "received", "TRF_queued"));
    verifyTransfer.mockImplementation(async (reference: string) => transferResult(session.mentor_payout_ngn, reference, "received", "TRF_queued"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    expect((await attemptPayout(payoutId)).outcome).toBe("indeterminate");
    expect((await attemptPayout(payoutId)).outcome).toBe("indeterminate");

    expect(initiateTransfer).toHaveBeenCalledTimes(1);
    expect((await payoutRow(payoutId)).pending_transfer_reference).toBe(initiateTransfer.mock.calls[0][0].reference);
  });

  it.each(["failed", "reversed"])("initiate answers status '%s': recorded as a failure and the reference is cleared, so a retry mints a fresh one", async (status) => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockImplementation(async (p: { reference: string }) => transferResult(session.mentor_payout_ngn, p.reference, status, "TRF_dead"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const outcome = await attemptPayout(payoutId);

    expect(outcome.outcome).toBe("failed");
    const row = await payoutRow(payoutId);
    expect(row.status).toBe("failed");
    expect(row.pending_transfer_reference).toBeNull();
    expect(row.failure_reason).toContain(status);
  });
});
