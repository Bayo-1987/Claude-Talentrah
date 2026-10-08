import type { AdminScholarshipState } from "./admin-state";

/**
 * Which "generation" the admin form's rich-text editor is on. The editor is uncontrolled (TipTap reads its initial content once), so React's automatic form reset after a
 * submit clears every native field but cannot clear it; the form remounts it, by key, each time a save SUCCEEDS. A failed save (a field error, a general error) and a
 * state that did not change leave the generation alone, so the operator's text stays while they fix the field.
 */
export function nextEditorGeneration(previous: AdminScholarshipState, next: AdminScholarshipState, generation: number): number {
  return next !== previous && next.status === "success" ? generation + 1 : generation;
}
