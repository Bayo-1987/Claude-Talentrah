/**
 * `captureEvent` (src/lib/analytics/posthog.ts) is the one shared path all 9
 * real product-event call sites route through, so its own resilience is
 * tested once, here, rather than reproducing the same proof 9 times.
 *
 * TWO SEPARATE FAILURE MODES, both load-bearing, both proven directly rather
 * than assumed:
 *
 *   1. `after()` (next/server) throws SYNCHRONOUSLY the instant it's called
 *      outside a real Next.js request — already documented in this
 *      codebase's own tests/billing/ad-serving-click-apply.test.ts header
 *      for applyInAppAction's pre-existing ad-event instrumentation.
 *      `commitTailoringAllowance` (tailoring/gate.ts) and `fulfillPayment`
 *      (billing/fulfill.ts) both have EXISTING unit tests that call them
 *      directly, outside any request — so captureEvent must swallow this
 *      itself, or adding one line to either function breaks those tests.
 *   2. Even inside a real request, the PostHog client itself (a network
 *      call) can throw or reject — this must never surface past
 *      captureEvent either.
 *
 * NEITHER FAILURE MODE CAN BE PROVEN BY `expect(() => captureEvent(...)).not
 * .toThrow()` ALONE for mode 2, and an earlier draft of this file got that
 * wrong: caught only by deliberately sabotaging the inner try/catch and
 * finding the test still passed. `captureEvent` never awaits the async
 * callback it hands to `after()` — real callers never do either, that's the
 * whole point of a fire-and-forget capture — so a throw inside that callback
 * becomes a REJECTED PROMISE, not a synchronous exception, and surfaces
 * (if anything) as an unhandled rejection well after captureEvent has
 * already returned. The mock `after` below captures that promise so the
 * relevant tests can await and inspect it directly, which is what actually
 * proves the inner try/catch is doing something.
 *
 * `vi.resetModules()` + dynamic re-import between cases is needed because
 * captureEvent caches its client in a module-level singleton (deliberately —
 * see the module's own header on why a fresh client per call is wrong for
 * this SDK), which would otherwise leak one test's POSTHOG_API_KEY state
 * into the next.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

let mockAfter: ReturnType<typeof vi.fn>;
/** The promise `after()`'s own callback returns — see the file header. */
let lastAfterPromise: Promise<void> | undefined;
let mockCapture: ReturnType<typeof vi.fn>;
let mockFlush: ReturnType<typeof vi.fn>;
let mockPostHogCtor: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.POSTHOG_API_KEY;
  delete process.env.POSTHOG_HOST;

  lastAfterPromise = undefined;
  // Behaves like a real request: invokes the callback and hands back its
  // promise for inspection, exactly what Next.js's own after() does with
  // the work it defers until the response has been sent.
  mockAfter = vi.fn((cb: () => Promise<void>) => {
    lastAfterPromise = cb();
  });
  vi.doMock("next/server", () => ({ after: mockAfter }));

  mockCapture = vi.fn();
  mockFlush = vi.fn(async () => {});
  mockPostHogCtor = vi.fn(function (this: unknown) {
    return { capture: mockCapture, flush: mockFlush };
  });
  vi.doMock("posthog-node", () => ({ PostHog: mockPostHogCtor }));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.doUnmock("next/server");
  vi.doUnmock("posthog-node");
});

describe("no POSTHOG_API_KEY (local dev, CI)", () => {
  it("never constructs a client or touches the network", async () => {
    const { captureEvent } = await import("@/lib/analytics/posthog");
    expect(() => captureEvent("user-1", "signup")).not.toThrow();
    await lastAfterPromise;
    expect(mockPostHogCtor).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe("POSTHOG_API_KEY set", () => {
  beforeEach(() => {
    process.env.POSTHOG_API_KEY = "posthog-test-placeholder";
  });

  it("captures with the right distinctId/event/properties shape", async () => {
    const { captureEvent } = await import("@/lib/analytics/posthog");
    captureEvent("user-42", "mentor_session_booked");
    await lastAfterPromise;
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: "user-42",
      event: "mentor_session_booked",
      properties: undefined,
    });
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("passes properties through unmodified", async () => {
    const { captureEvent } = await import("@/lib/analytics/posthog");
    captureEvent("user-7", "tailoring_run", { kind: "tailoring", is_first_run: true });
    await lastAfterPromise;
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: "user-7",
      event: "tailoring_run",
      properties: { kind: "tailoring", is_first_run: true },
    });
  });

  it("configures the client for immediate delivery, not the SDK's own batching defaults", async () => {
    const { captureEvent } = await import("@/lib/analytics/posthog");
    captureEvent("user-1", "signup");
    await lastAfterPromise;
    expect(mockPostHogCtor).toHaveBeenCalledWith(
      "posthog-test-placeholder",
      expect.objectContaining({ flushAt: 1, flushInterval: 0 }),
    );
  });

  it("defaults host to US cloud when POSTHOG_HOST is unset", async () => {
    const { captureEvent } = await import("@/lib/analytics/posthog");
    captureEvent("user-1", "signup");
    await lastAfterPromise;
    expect(mockPostHogCtor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host: "https://us.i.posthog.com" }),
    );
  });

  it("respects POSTHOG_HOST when set (EU cloud)", async () => {
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    const { captureEvent } = await import("@/lib/analytics/posthog");
    captureEvent("user-1", "signup");
    await lastAfterPromise;
    expect(mockPostHogCtor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host: "https://eu.i.posthog.com" }),
    );
  });

  describe("failure mode 1: the PostHog client itself throws or rejects", () => {
    it("capture() throwing synchronously never rejects the deferred after() callback", async () => {
      mockCapture.mockImplementation(() => {
        throw new Error("network is down");
      });
      const { captureEvent } = await import("@/lib/analytics/posthog");
      expect(() => captureEvent("user-1", "signup")).not.toThrow();
      // The real assertion: what after() itself hands back must resolve
      // cleanly. Awaiting a rejected promise with no .catch on it is
      // exactly the "unhandled rejection in a fire-and-forget callback"
      // shape that would otherwise reach the runtime.
      await expect(lastAfterPromise).resolves.toBeUndefined();
    });

    it("flush() rejecting never rejects the deferred after() callback", async () => {
      mockFlush.mockImplementation(async () => {
        throw new Error("timeout");
      });
      const { captureEvent } = await import("@/lib/analytics/posthog");
      expect(() => captureEvent("user-1", "signup")).not.toThrow();
      await expect(lastAfterPromise).resolves.toBeUndefined();
    });
  });

  describe("failure mode 2: after() itself throws (called outside a request scope)", () => {
    beforeEach(() => {
      // What Next.js's own after() actually does outside a real request —
      // confirmed in tests/billing/ad-serving-click-apply.test.ts's header.
      mockAfter = vi.fn(() => {
        throw new Error("`after` was called outside a request scope.");
      });
      vi.doMock("next/server", () => ({ after: mockAfter }));
    });

    it("never surfaces past captureEvent — this is what protects commitTailoringAllowance and fulfillPayment's existing direct-call unit tests", async () => {
      const { captureEvent } = await import("@/lib/analytics/posthog");
      expect(() => captureEvent("user-1", "signup")).not.toThrow();
      // The PostHog client is never even reached in this environment —
      // there's nothing to defer the capture to.
      expect(mockPostHogCtor).not.toHaveBeenCalled();
    });
  });
});
