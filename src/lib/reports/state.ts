/**
 * Not in actions.ts: a `"use server"` module may export only async functions.
 * Exporting an object there compiles and renders fine and then 500s on the
 * first submit, which reads as a failed insert rather than a failed module.
 * That cost an hour once already (see src/lib/feedback/state.ts).
 */
export interface ReportActionState {
  status: "idle" | "success" | "duplicate" | "error";
  error: string | null;
}

export const initialReportActionState: ReportActionState = {
  status: "idle",
  error: null,
};
