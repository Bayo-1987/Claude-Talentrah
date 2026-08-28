/**
 * State for the notes editor's save.
 *
 * Not in tracker-actions.ts: a `"use server"` module may export only async
 * functions. An object export there compiles, renders, and then 500s on the
 * first submit — which reads as a failed save rather than a failed module.
 * Same reason src/lib/profile/settings-state.ts and src/lib/feedback/state.ts
 * exist.
 */
/*
 * A NOTE ON THE ERROR STATUS AND WHERE IT CAN ACTUALLY BE SEEN.
 *
 * Two things return `status: "error"`, and only one of them can be shown:
 *
 *   a database error   the row is still there, the card is still on screen,
 *                      and the rust banner renders over the open editor.
 *   zero rows matched  the entry was deleted or was never this user's. The
 *                      action revalidates, the card drops out of the list, and
 *                      NotesForm unmounts with it — a component cannot report
 *                      the disappearance of the thing it lives inside. The
 *                      card vanishing is the feedback there; the string below
 *                      is unreachable in that path. Kept because the status
 *                      itself is correct and cheap, not because it is seen.
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
