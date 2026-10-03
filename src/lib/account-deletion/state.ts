import type { DeletionBlockers } from "./types";

/**
 * Not in actions.ts: a `"use server"` module may export only async functions. An object export there compiles, renders, and then 500s on the
 * first submit (see src/lib/profile/settings-state.ts).
 */

export interface DeletionRequestState {
  status: "idle" | "sent" | "blocked" | "error";
  error: string | null;
  /** Where the confirmation link was sent. The person's own address, shown back to them. */
  sentTo?: string;
  blockers?: DeletionBlockers;
}

export const initialRequestState: DeletionRequestState = { status: "idle", error: null };

export type DeletionConfirmReason =
  | "invalid"
  | "used"
  | "superseded"
  | "expired"
  | "already_scheduled"
  | "blocked"
  | "signed_out"
  | "card"
  | "renewal_off"
  | "failed";

export interface DeletionConfirmState {
  status: "idle" | "done" | "error";
  error: string | null;
  reason?: DeletionConfirmReason;
  blockers?: DeletionBlockers;
  hardDeleteAfter?: string;
  creditsForfeited?: number;
  closedPostings?: Array<{ id: string; title: string; organization: string }>;
  adWalletBalanceNgn?: number;
}

export const initialConfirmState: DeletionConfirmState = { status: "idle", error: null };
