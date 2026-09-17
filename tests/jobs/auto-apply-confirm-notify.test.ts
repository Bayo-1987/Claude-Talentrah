/**
 * `isSuccessfulInternalConfirm` (src/components/jobs/auto-apply-queue-item.tsx)
 * — the one behavioral distinction the whole Auto-Apply micro-feedback call
 * site depends on: `onConfirmed` (which shows `MicroFeedbackPrompt`) must
 * fire ONLY when `confirmAutoApplyAction` actually submitted internally —
 * never on a dismiss, and never on an external hand-off (which opens a new
 * tab and records a save, but never submits anything to ask "how'd that
 * go" about).
 *
 * Exported as a standalone pure function specifically so this can be proven
 * without rendering anything — the actual wiring (call the callback when
 * this returns true) is a one-line `if` in the component, and the risk
 * lives entirely in getting this predicate right across `AutoApplyResult`'s
 * three real outcomes plus the failure case.
 */
import { describe, expect, it } from "vitest";
import { isSuccessfulInternalConfirm } from "@/components/jobs/auto-apply-queue-item";
import type { AutoApplyResult } from "@/lib/auto-apply/actions";

describe("isSuccessfulInternalConfirm", () => {
  it("is true for a genuine internal submission", () => {
    const result: AutoApplyResult = { ok: true, outcome: "submitted" };
    expect(isSuccessfulInternalConfirm(result)).toBe(true);
  });

  it("is false for an external hand-off, even though it's ok: true", () => {
    const result: AutoApplyResult = {
      ok: true,
      outcome: "handed_off",
      externalUrl: "https://example.com/job/1",
    };
    expect(isSuccessfulInternalConfirm(result)).toBe(false);
  });

  it("is false for a dismiss", () => {
    const result: AutoApplyResult = { ok: true, outcome: "dismissed" };
    expect(isSuccessfulInternalConfirm(result)).toBe(false);
  });

  it("is false for any failed confirm attempt", () => {
    const result: AutoApplyResult = { ok: false, error: "Couldn't confirm: try again." };
    expect(isSuccessfulInternalConfirm(result)).toBe(false);
  });
});
