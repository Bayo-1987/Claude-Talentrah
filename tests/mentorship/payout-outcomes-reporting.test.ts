/**
 * No database. What the job summary, the admin retry action and the cron route say about the payout outcomes that mean "the money may have moved, or may not, and
 * the record does not show it" (PAYOUT-RENEWAL-UNCHECKED-WRITES-1, PR-A).
 *
 * The rule under test: such an outcome is NEVER counted as paid, NEVER shown as "Paid.", always names the payout in the summary's errors, and always makes the job's `ok` false,
 * which the route turns into HTTP 500 so the scheduler's failure alerting fires.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const attemptPayout = vi.hoisted(() => vi.fn());
const runMentorPayoutJob = vi.hoisted(() => vi.fn());
const requirePermission = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/lib/mentorship/payouts", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/mentorship/payouts")>()), attemptPayout, runMentorPayoutJob }));
vi.mock("@/lib/admin/require-admin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/require-admin")>()), requirePermission }));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/admin-auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/admin-auth")>()), requireCronSecret: () => null }));

beforeEach(() => {
  attemptPayout.mockReset();
  runMentorPayoutJob.mockReset();
});

const blank = async () => {
  const payouts = await vi.importActual<typeof import("@/lib/mentorship/payouts")>("@/lib/mentorship/payouts");
  return { payouts, summary: payouts.newPayoutJobSummary() };
};

describe("recordOutcomeInSummary: what each outcome does to the job summary", () => {
  it("paid counts as paid and nothing else", async () => {
    const { payouts, summary } = await blank();
    payouts.recordOutcomeInSummary(summary, "p1", { outcome: "paid" });
    expect(summary).toMatchObject({ ok: true, paid: 1, unrecorded: 0, errors: [] });
  });

  it.each([
    ["paid_unrecorded", { outcome: "paid_unrecorded", reference: "mentor_payout_x", transferCode: "TRF_1" }, /paid at Paystack|not recorded/i],
    ["failure_unrecorded", { outcome: "failure_unrecorded", reason: "declined" }, /not recorded/i],
    ["indeterminate_unrecorded", { outcome: "indeterminate_unrecorded", reference: "mentor_payout_x" }, /not recorded/i],
  ] as const)("%s: never counted as paid, listed in errors with the payout id, ok false", async (_name, outcome, message) => {
    const { payouts, summary } = await blank();
    payouts.recordOutcomeInSummary(summary, "payout-123", outcome);
    expect(summary.paid, "MONEY BUG: an unrecorded outcome was counted as paid").toBe(0);
    expect(summary.unrecorded).toBe(1);
    expect(summary.ok).toBe(false);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].payoutId).toBe("payout-123");
    expect(summary.errors[0].message).toMatch(message);
  });

  it("reference_unsaved: nothing was sent, ok false, listed", async () => {
    const { payouts, summary } = await blank();
    payouts.recordOutcomeInSummary(summary, "payout-9", { outcome: "reference_unsaved" });
    expect(summary).toMatchObject({ ok: false, paid: 0, referenceUnsaved: 1 });
    expect(summary.errors[0].message).toMatch(/nothing was sent/i);
  });

  it("needs_review: a person must look, ok false, listed, nothing counted as attempted work", async () => {
    const { payouts, summary } = await blank();
    payouts.recordOutcomeInSummary(summary, "payout-7", { outcome: "needs_review" });
    expect(summary).toMatchObject({ ok: false, paid: 0, needsReview: 1 });
    expect(summary.errors[0]).toMatchObject({ payoutId: "payout-7" });
  });
});

describe("retryMentorPayoutAction: an honest answer for every outcome", () => {
  it.each([
    ["paid", { outcome: "paid" }, "ok", /^Paid\.$/],
    ["paid_unrecorded", { outcome: "paid_unrecorded", reference: "r", transferCode: "t" }, "error", /do not retry/i],
    ["failure_unrecorded", { outcome: "failure_unrecorded", reason: "x" }, "error", /could not record/i],
    ["indeterminate_unrecorded", { outcome: "indeterminate_unrecorded", reference: "r" }, "error", /could not record/i],
    ["reference_unsaved", { outcome: "reference_unsaved" }, "error", /nothing was sent/i],
    ["needs_review", { outcome: "needs_review" }, "error", /no (Paystack )?reference/i],
  ] as const)("%s", async (_name, outcome, status, message) => {
    attemptPayout.mockResolvedValueOnce(outcome);
    const { retryMentorPayoutAction } = await import("@/lib/admin/mentor-payouts/actions");
    const result = await retryMentorPayoutAction("p");
    expect(result.status).toBe(status);
    expect(result.message).toMatch(message);
    if (outcome.outcome !== "paid") expect(result.message, "MONEY BUG: a payout that is not recorded as paid was shown as 'Paid.'").not.toMatch(/^Paid\.?$/);
  });
});

describe("the cron route", () => {
  it("answers 500 when the job's ok is false, so the scheduler alerts", async () => {
    runMentorPayoutJob.mockResolvedValueOnce({ ok: false, rowsCreated: 0, attempted: 1, paid: 0, indeterminate: 0, failed: 0, unrecorded: 1, referenceUnsaved: 0, needsReview: 0, errors: [{ payoutId: "p", message: "m" }] });
    const { GET } = await import("@/app/api/admin/mentor-payouts/route");
    const res = await GET(new Request("http://localhost/api/admin/mentor-payouts"));
    expect(res.status).toBe(500);
  });
});
