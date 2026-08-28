/**
 * State for the notes editor's save.
 *
 * Not in tracker-actions.ts: a `"use server"` module may export only async
 * functions. An object export there compiles, renders, and then 500s on the
 * first submit — which reads as a failed save rather than a failed module.
 * Same reason src/lib/profile/settings-state.ts and src/lib/feedback/state.ts
 * exist.
 */
export interface NotesActionState {
  status: "idle" | "success" | "error";
  error: string | null;
  /**
   * The note as the server stored it, echoed back on success.
   *
   * The form needs this because it collapses to the read view immediately and
   * the page's own data has not been re-fetched yet — revalidatePath refreshes
   * the server component, but the client state switches first. Reading back
   * what was written also means the read view shows the trimmed value the
   * database holds, not the raw textarea contents.
   */
  notes: string | null;
  /** ISO timestamp the row now carries, for the "Edited …" line. */
  updatedAt: string | null;
}

export const initialNotesActionState: NotesActionState = {
  status: "idle",
  error: null,
  notes: null,
  updatedAt: null,
};
