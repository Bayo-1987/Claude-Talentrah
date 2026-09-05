import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";

export type FarahEntryPoint = Database["public"]["Tables"]["farah_session_events"]["Row"]["entry_point"];

/**
 * Records which entry point started a Farah session, and whether that
 * session ever received a second user message.
 *
 * WHAT THIS DECIDES: whether per-task Farah threads are ever worth building.
 * If most sessions are one question and done, they aren't. See migration
 * 0097's own header for why "session" means one FarahPanel mount rather than
 * a stored concept, and why entry_point is duplicated onto both event rows.
 *
 * CALLED ON EVERY user message from chat/route.ts, not just the first —
 * this function is what decides whether a given call is the session's start
 * or its second-plus message, by checking whether a 'started' row already
 * exists for `sessionId`. Same shape and same reasoning as
 * logResumeBuilderStartEvent: written via the service-role client so it
 * can't be forged by the user it describes (RLS grants `authenticated`
 * SELECT-only, no INSERT policy at all), and deliberately best-effort — a
 * dropped analytics row must never turn into a failed Farah reply that
 * already cost real credits or pass allowance.
 */
export async function logFarahSessionMessage(params: {
  userId: string;
  sessionId: string;
  entryPoint: FarahEntryPoint;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();

    const { data: started } = await supabase
      .from("farah_session_events")
      .select("entry_point")
      .eq("session_id", params.sessionId)
      .eq("event_type", "started")
      .maybeSingle();

    if (!started) {
      const { error } = await supabase.from("farah_session_events").insert({
        user_id: params.userId,
        session_id: params.sessionId,
        entry_point: params.entryPoint,
        event_type: "started",
      });
      if (error) {
        console.error(`[farah-session-events] failed to log started: ${error.message}`);
      }
      return;
    }

    // Logged at most once per session, looked up first so a third or fourth
    // message in the same session doesn't insert duplicate rows — the
    // question this answers is "did this session ever reach a second
    // message", not "how many messages did it have".
    const { data: alreadyReachedSecond } = await supabase
      .from("farah_session_events")
      .select("id")
      .eq("session_id", params.sessionId)
      .eq("event_type", "reached_second_message")
      .maybeSingle();
    if (alreadyReachedSecond) return;

    const { error } = await supabase.from("farah_session_events").insert({
      user_id: params.userId,
      session_id: params.sessionId,
      // The ORIGINAL entry point from the 'started' row, not whatever this
      // call happened to pass — a session's second message carries no quick
      // action of its own, so trusting a fresh value here would misattribute
      // every second-plus message to "free_text" regardless of how the
      // session actually began.
      entry_point: started.entry_point,
      event_type: "reached_second_message",
    });
    if (error) {
      console.error(`[farah-session-events] failed to log reached_second_message: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[farah-session-events] failed to log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * READING THE FUNNEL (no dashboard — deliberately, same convention as
 * gate-events.ts, country-events.ts and resume-builder/start-events.ts). Run
 * in the Supabase SQL editor.
 *
 *   select
 *     entry_point,
 *     count(*) filter (where event_type = 'started') as started,
 *     count(*) filter (where event_type = 'reached_second_message') as reached_second_message,
 *     round(100.0 * count(*) filter (where event_type = 'reached_second_message')
 *           / nullif(count(*) filter (where event_type = 'started'), 0), 1) as pct_reached_second
 *   from farah_session_events
 *   group by entry_point
 *   order by started desc;
 */
