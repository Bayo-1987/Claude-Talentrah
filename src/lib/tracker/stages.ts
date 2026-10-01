/**
 * The Job Tracker's stages, in the order a job moves through them — one list (send-484).
 *
 * This used to live twice, privately: `StageFilterBar` kept its own array (with an "All" filter in front)
 * and `TrackerCard` its own label record, and the signed-out /tracker landing page needs the same list a
 * third time. Extracted with no change to anything a signed-in user sees; tests/tracker/stages.test.tsx
 * holds the rendered output of both components to what it was before, and pins this list to the database's
 * `application_stage` enum.
 *
 * NOT here: "All". That is a filter the filter bar adds in front, not a stage an application can be in.
 *
 * `StageSelect` (the per-card dropdown) still carries its own copy; a drift test pins it equal to this.
 */
import type { Enums } from "@/lib/supabase/types";

export interface TrackerStage {
  key: Enums<"application_stage">;
  label: string;
}

export const TRACKER_STAGES: readonly TrackerStage[] = [
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
];

/**
 * The label for a stage key, or the key itself for one this build does not know — a history row written
 * by a newer enum must still render something rather than "undefined".
 */
export function trackerStageLabel(stage: string): string {
  return TRACKER_STAGES.find((s) => s.key === stage)?.label ?? stage;
}
