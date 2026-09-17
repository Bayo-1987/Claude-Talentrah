"use server";

import { createClient } from "@/lib/supabase/server";
import { captureEvent } from "@/lib/analytics/posthog";

export type MicroFeedbackContext = "tailoring_result" | "auto_apply_confirm";
export type MicroFeedbackReaction = "positive" | "needs_work";

/**
 * The one Server Action wrapper `MicroFeedbackPrompt` needs — `captureEvent`
 * itself is server-only and needs `after()`'s request context, so a client
 * component can't call it directly.
 *
 * Deliberately silent on "not signed in" rather than throwing: both call
 * sites (`/tailor`, `/auto-apply`) already require a session to reach the
 * result being reacted to, so this should never actually fire signed-out —
 * but a quick pulse-check reaction is exactly the kind of thing that must
 * never surface an error to the user if that assumption is ever wrong,
 * mirroring `captureEvent`'s own "never let this throw past the caller"
 * contract for the other 8 events.
 */
export async function captureMicroFeedbackReactionAction(
  context: MicroFeedbackContext,
  reaction: MicroFeedbackReaction,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  captureEvent(user.id, "micro_feedback_reaction", { context, reaction });
}
