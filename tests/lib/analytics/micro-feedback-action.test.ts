/**
 * `captureMicroFeedbackReactionAction` (src/lib/analytics/actions.ts) — the
 * thin Server Action wrapper `MicroFeedbackPrompt` calls, since `captureEvent`
 * itself is server-only and needs `after()`'s request context.
 *
 * `captureEvent`'s own resilience (never throws, swallows network/after()
 * failures) is already proven once for all 9 events in
 * tests/lib/analytics/posthog.test.ts — not re-derived here. What this file
 * pins is specific to the wrapper itself: it resolves the session user, and
 * it must never throw when there isn't one (both real call sites already
 * require a session to reach the result being reacted to, but a pulse-check
 * reaction must never be the thing that breaks the page if that's ever
 * wrong).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCaptureEvent = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/analytics/posthog", () => ({ captureEvent: mockCaptureEvent }));
});

afterEach(() => {
  vi.doUnmock("@/lib/analytics/posthog");
  vi.doUnmock("@/lib/supabase/server");
  mockCaptureEvent.mockReset();
});

describe("signed in", () => {
  beforeEach(() => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-42" } } }) },
      }),
    }));
  });

  it("routes a positive reaction through captureEvent with the exact context/reaction shape", async () => {
    const { captureMicroFeedbackReactionAction } = await import("@/lib/analytics/actions");
    await captureMicroFeedbackReactionAction("tailoring_result", "positive");
    expect(mockCaptureEvent).toHaveBeenCalledWith("user-42", "micro_feedback_reaction", {
      context: "tailoring_result",
      reaction: "positive",
    });
  });

  it("routes a needs_work reaction from the auto_apply_confirm context the same way", async () => {
    const { captureMicroFeedbackReactionAction } = await import("@/lib/analytics/actions");
    await captureMicroFeedbackReactionAction("auto_apply_confirm", "needs_work");
    expect(mockCaptureEvent).toHaveBeenCalledWith("user-42", "micro_feedback_reaction", {
      context: "auto_apply_confirm",
      reaction: "needs_work",
    });
  });
});

describe("not signed in", () => {
  beforeEach(() => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    }));
  });

  it("never throws, and never reaches captureEvent — nothing to attribute the reaction to", async () => {
    const { captureMicroFeedbackReactionAction } = await import("@/lib/analytics/actions");
    await expect(captureMicroFeedbackReactionAction("tailoring_result", "positive")).resolves.toBeUndefined();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });
});
