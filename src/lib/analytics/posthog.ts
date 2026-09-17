import "server-only";
import { after } from "next/server";
import { PostHog } from "posthog-node";

/**
 * The 9 server-side product events this app actually captures, mapped 1:1
 * to real Server Action / API route call sites — not a speculative list.
 * Kept as a union (not a bare `string`) so a typo in an event name is a
 * type error, not a silent miss in the PostHog dashboard.
 */
export type PostHogEventName =
  | "signup"
  | "referral_signup"
  | "resume_uploaded"
  | "tailoring_run"
  | "application_submitted"
  | "auto_apply_toggled"
  | "credit_purchase_completed"
  | "mentor_session_booked"
  | "micro_feedback_reaction";

let client: PostHog | null | undefined;

/**
 * Lazy singleton, cached across calls within one server process.
 *
 * `undefined` (not yet checked) vs `null` (checked, unconfigured) are
 * deliberately distinct so a missing `POSTHOG_API_KEY` is only ever read
 * from `process.env` once per process, not on every capture call.
 */
function getClient(): PostHog | null {
  if (client !== undefined) return client;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    client = null;
    return client;
  }

  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    /*
     * flushAt: 1 / flushInterval: 0 — NOT the SDK's own defaults (which
     * batch up to 20 events or 10s before sending). Vercel Functions are
     * ephemeral: the process can freeze or be torn down the moment the
     * response finishes, well before a batching interval would fire, which
     * would silently drop every event this integration exists to capture.
     * Every capture call here already runs inside `after()` and is followed
     * by an explicit `flush()` (below) — the two together are what actually
     * guarantee delivery in a serverless runtime, not just posthog-node's
     * own defaults, which are tuned for a long-lived server process this
     * app doesn't have.
     */
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * Fire-and-forget product event capture. Deliberately synchronous (returns
 * `void`, never awaited by callers) — every one of the 9 real call sites
 * already has everything it needs by the time it calls this, and a
 * PostHog outage must never add latency to, or fail, the action that
 * triggered the event.
 *
 * Mirrors `applyInAppAction`'s existing `after()` + try/catch pattern for ad
 * events (`src/lib/applications/actions.ts`) — deferred until after the
 * response is sent, and any failure inside is swallowed, never thrown.
 *
 * The `after()` call itself is ALSO wrapped in try/catch, not just its
 * callback — checked empirically, not assumed: `after()` throws
 * synchronously ("called outside a request scope") the instant it's
 * invoked outside a real Next.js request, exactly as documented in this
 * codebase's own `tests/billing/ad-serving-click-apply.test.ts` header for
 * `applyInAppAction`. `commitTailoringAllowance` (`tailoring/gate.ts`) and
 * `fulfillPayment` (`billing/fulfill.ts`) both have existing unit tests
 * that call them directly, outside any request — without this outer guard,
 * adding a single `captureEvent` call to either would break every one of
 * those tests. Missing `POSTHOG_API_KEY` (local dev, CI) is handled
 * separately, inside the deferred callback — `getClient()` returns `null`
 * and capture is skipped without ever touching the network.
 */
export function captureEvent(
  userId: string,
  event: PostHogEventName,
  properties?: Record<string, unknown>,
): void {
  try {
    after(async () => {
      try {
        const posthog = getClient();
        if (!posthog) return;
        posthog.capture({ distinctId: userId, event, properties });
        // See flushAt/flushInterval above — this is the other half of the
        // same guarantee, not redundant with it.
        await posthog.flush();
      } catch (err) {
        console.error(`[posthog] capture failed for "${event}":`, err);
      }
    });
  } catch {
    // Called outside a request scope (e.g. a plain unit test invoking a
    // Server Action's underlying function directly) — nothing to defer to,
    // and nothing this integration should ever be able to break.
  }
}
