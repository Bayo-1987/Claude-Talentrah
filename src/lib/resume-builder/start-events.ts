import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";

export type ResumeBuilderStartState = Database["public"]["Tables"]["resume_builder_start_events"]["Row"]["start_state"];
type EventType = Database["public"]["Tables"]["resume_builder_start_events"]["Row"]["event_type"];

/**
 * Records which start state a user picked when creating a resume via the
 * Resume Builder — "Import my CV" / "Start from an example" / "Start blank"
 * (createResumeAction, src/lib/resume-builder/actions.ts).
 *
 * Same shape and same reasoning as logCreditGateEvent
 * (src/lib/credits/gate-events.ts) and logCountryDefaultEvent
 * (src/lib/jobs/country-events.ts): written via the service-role client so it
 * can't be forged by the user it describes (RLS grants `authenticated`
 * SELECT-only on this table, no INSERT policy at all), and deliberately
 * best-effort — a dropped analytics row must never turn into a failed resume
 * creation, save, or export.
 *
 * WHAT "COMPLETION" MEANS HERE, since the brief leaves it to judgement: a
 * resume "completes" the first time it is either saved (saveResumeAction) or
 * exported (the Download PDF button), whichever happens first — logged at
 * most ONCE per resume, not once per save, so the table answers "did this
 * resume ever get used" rather than "how many times was Save clicked".
 * logResumeBuilderCompletion() checks for an existing 'completed' row before
 * inserting a new one.
 */
export async function logResumeBuilderStartEvent(params: {
  userId: string;
  resumeId: string | null;
  startState: ResumeBuilderStartState;
  eventType: EventType;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("resume_builder_start_events").insert({
      user_id: params.userId,
      resume_id: params.resumeId,
      start_state: params.startState,
      event_type: params.eventType,
    });
    if (error) {
      console.error(
        `[resume-builder-start-events] failed to log ${params.startState}/${params.eventType}: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[resume-builder-start-events] failed to log ${params.startState}/${params.eventType}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Logs the "completed" milestone for a resume, at most once — looked up by
 * finding that resume's own "selected" event so the 'completed' row carries
 * the SAME start_state, letting the funnel query below skip a join entirely.
 *
 * A resume created before this feature shipped (no "selected" row exists)
 * logs nothing — there is no start state to attribute the completion to, and
 * a row with a fabricated one would misreport the funnel rather than just
 * omitting a data point for it.
 */
export async function logResumeBuilderCompletion(params: {
  userId: string;
  resumeId: string;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();

    const { data: alreadyCompleted } = await supabase
      .from("resume_builder_start_events")
      .select("id")
      .eq("resume_id", params.resumeId)
      .eq("event_type", "completed")
      .maybeSingle();
    if (alreadyCompleted) return;

    const { data: selected } = await supabase
      .from("resume_builder_start_events")
      .select("start_state")
      .eq("resume_id", params.resumeId)
      .eq("event_type", "selected")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!selected) return;

    const { error } = await supabase.from("resume_builder_start_events").insert({
      user_id: params.userId,
      resume_id: params.resumeId,
      start_state: selected.start_state,
      event_type: "completed",
    });
    if (error) {
      console.error(`[resume-builder-start-events] failed to log completion: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[resume-builder-start-events] failed to log completion: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * READING THE FUNNEL (no dashboard — deliberately, same convention as
 * gate-events.ts and country-events.ts). Run in the Supabase SQL editor.
 *
 * Which start state people pick, and what share of each ever completes —
 * both event types carry start_state, so this is one group-by, no join:
 *
 *   select
 *     start_state,
 *     count(*) filter (where event_type = 'selected')  as selected,
 *     count(*) filter (where event_type = 'completed') as completed,
 *     round(100.0 * count(*) filter (where event_type = 'completed')
 *           / nullif(count(*) filter (where event_type = 'selected'), 0), 1) as completion_pct
 *   from resume_builder_start_events
 *   group by start_state
 *   order by selected desc;
 */
