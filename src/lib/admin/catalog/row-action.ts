import type { ModerationState } from "@/lib/admin/moderation/state";

type RowAction = (prev: ModerationState, formData: FormData) => Promise<ModerationState>;

/**
 * One action for a catalog row's two forms (Save changes, and Make live / Take out of recommendations), so the row has ONE result and one banner.
 *
 * Before, each form had its own state and the toggle's was shown ahead of the save's, never cleared: after one toggle, every later Save result was hidden behind the toggle's old message (QA
 * COURSE-MSG-1). The toggle form is the one that carries a `decision` field.
 *
 * A toggle returns no typed values, so on its own it would drop the ones a refused Save handed back (the operator's unsaved edits); it keeps them. A successful Save returns none, on purpose:
 * the fields then fall back to the saved values.
 */
export async function runCourseRowAction(prev: ModerationState, formData: FormData, actions: { save: RowAction; toggle: RowAction }): Promise<ModerationState> {
  if (formData.has("decision")) {
    const result = await actions.toggle(prev, formData);
    return result.values || !prev.values ? result : { ...result, values: prev.values };
  }
  return actions.save(prev, formData);
}
