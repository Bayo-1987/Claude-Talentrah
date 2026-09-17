/**
 * `commitTailoringAllowance` (src/lib/tailoring/gate.ts) is one of only two
 * of the 8 new PostHog call sites (the other is `fulfillPayment`) that can
 * genuinely be unit-tested by calling the real function directly — it takes
 * a `userId` and needs no session, unlike the other 6 (signUpAction, the
 * resume/parse route, applyInAppAction/markAppliedExternallyAction,
 * setAutoApplyEnabledAction, bookMentorSessionAction), which all transitively
 * call createClient()/cookies() and are request-scoped for the same reason
 * `getCampaignAnalytics` is (see tests/billing/ad-serving-click-apply.test.ts's
 * own header) — confirmed by grepping this file for createClient/cookies
 * and finding neither.
 *
 * This is what actually proves the `is_first_run` property claim: true
 * ONLY when the free trial itself covered the run, not on every call —
 * checked across all three real branches (free trial, pass-covered, paid),
 * not assumed from reading the one line that sets it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import type { AllowanceResult } from "@/lib/tailoring/gate";

const captureEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent }));

const { commitTailoringAllowance } = await import("@/lib/tailoring/gate");

let userId: string;

beforeAll(async () => {
  const user = await createTestUser("posthog-tailoring");
  userId = user.id;
}, 30_000);

afterAll(async () => {
  await deleteTestUsers([userId]);
});

describe("commitTailoringAllowance fires tailoring_run with the right shape", () => {
  it("is_first_run: true when the free trial covered the run", async () => {
    captureEvent.mockClear();
    const allowance: AllowanceResult = {
      isFreeTrial: true,
      isPassCovered: false,
      creditsSpent: 0,
      creditsAvailableAtCheck: 0,
    };
    await commitTailoringAllowance(userId, "tailoring", allowance);
    expect(captureEvent).toHaveBeenCalledWith(userId, "tailoring_run", {
      kind: "tailoring",
      is_first_run: true,
    });
  });

  it("is_first_run: false when pass-covered (not the free trial)", async () => {
    captureEvent.mockClear();
    const allowance: AllowanceResult = {
      isFreeTrial: false,
      isPassCovered: true,
      creditsSpent: 0,
      creditsAvailableAtCheck: 5,
    };
    await commitTailoringAllowance(userId, "cover_letter", allowance);
    expect(captureEvent).toHaveBeenCalledWith(userId, "tailoring_run", {
      kind: "cover_letter",
      is_first_run: false,
    });
  });

  it("is_first_run: false when paid via credits (not the free trial)", async () => {
    // Real balance, so spendCredits' own atomic UPDATE has something to spend.
    await admin.from("profiles").update({ credits_balance: 100 }).eq("id", userId);
    captureEvent.mockClear();
    const allowance: AllowanceResult = {
      isFreeTrial: false,
      isPassCovered: false,
      creditsSpent: 20,
      creditsAvailableAtCheck: 100,
    };
    await commitTailoringAllowance(userId, "tailoring", allowance);
    expect(captureEvent).toHaveBeenCalledWith(userId, "tailoring_run", {
      kind: "tailoring",
      is_first_run: false,
    });
  });

  it("fires once per call, not duplicated across the branch it takes", async () => {
    captureEvent.mockClear();
    await commitTailoringAllowance(
      userId,
      "tailoring",
      { isFreeTrial: false, isPassCovered: true, creditsSpent: 0, creditsAvailableAtCheck: 0 },
    );
    expect(captureEvent).toHaveBeenCalledTimes(1);
  });
});
