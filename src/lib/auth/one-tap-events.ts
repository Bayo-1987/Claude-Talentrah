"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type OneTapMomentType = "display" | "skipped" | "dismissed";

/**
 * Records the outcome of one Google One Tap moment notification — displayed,
 * skipped, or dismissed, and Google's own reason string for the latter two
 * (`unknown_reason`, `suppressed_by_user`, `opt_out_or_no_session`, etc.).
 *
 * A Server Action, not a plain `server-only` function like
 * credit_gate_events'/country_default_events' own loggers — those are
 * called from other server-side code, but GoogleOneTap
 * (src/components/auth/google-one-tap.tsx) is a Client Component, so this
 * needs the same client-to-server bridge one-tap-actions.ts's
 * `getOneTapNonceAction` already uses.
 *
 * Why this exists: GoogleOneTap fires for a signed-out visitor, before any
 * credential exchange, and must degrade completely silently per that
 * component's own contract — nothing here may ever surface to the visitor
 * or affect the sign-in flow. Before this, the ONLY way to learn why One
 * Tap didn't show for a real user was to reproduce their exact
 * browser/Google-account state live and read `prompt()`'s moment
 * notification by hand — not repeatable from this app's own logs, and
 * doesn't scale past one investigation.
 *
 * No user_id: this fires before there is a signed-in user to attach it to —
 * see the migration's own header for why that's a structural fact here,
 * not a corner cut. Written via the service-role client, same as
 * credit_gate_events/country_default_events, and deliberately best-effort:
 * a dropped analytics row must never affect the sign-in flow itself.
 */
/**
 * READING THE FUNNEL (no dashboard, same convention as country-events.ts
 * and gate-events.ts). Run in the Supabase SQL editor.
 *
 * Why isn't One Tap showing, and for whom — grouped by reason and by which
 * page mounted it, over the last 30 days:
 *
 *   select page, moment_type, reason, count(*) as events
 *   from one_tap_moments
 *   where created_at >= now() - interval '30 days'
 *   group by page, moment_type, reason
 *   order by events desc;
 *
 * Which browsers actually get shown a prompt vs. which ones get skipped —
 * a real "why isn't this working for me" report can be checked against
 * this without a live repro:
 *
 *   select moment_type, user_agent, count(*) as events
 *   from one_tap_moments
 *   where created_at >= now() - interval '30 days'
 *   group by moment_type, user_agent
 *   order by events desc
 *   limit 50;
 */
export async function oneTapMomentAction(params: {
  momentType: OneTapMomentType;
  reason?: string | null;
  page: string;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("one_tap_moments").insert({
      moment_type: params.momentType,
      reason: params.reason ?? null,
      page: params.page,
      user_agent: params.userAgent ?? null,
    });
    if (error) {
      console.error(`[one-tap-events] failed to log ${params.momentType}/${params.reason ?? "n/a"}: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[one-tap-events] failed to log ${params.momentType}/${params.reason ?? "n/a"}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
