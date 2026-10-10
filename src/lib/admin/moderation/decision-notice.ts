/**
 * The one confirmation that outlives a review row (QA DECISION-SILENT-1).
 *
 * A decision that removes its row (verify, approve) used to take its own "Verified “X”" with it: the message lived inside the row's form, and the form was gone the moment the page refreshed. This is a
 * tiny client-side store the shared DecisionForm writes to and the notice in the admin layout reads, so the confirmation is shown outside the rows. Browser memory only: nothing is stored or sent.
 */
export interface DecisionNotice {
  message: string;
  /** A new object per announcement, so the same words twice still re-announce. */
  at: number;
}

let current: DecisionNotice | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function announceDecision(message: string): void {
  current = { message, at: ++counter };
  emit();
}

export function dismissDecisionNotice(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getDecisionNotice(): DecisionNotice | null {
  return current;
}

export function subscribeDecisionNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
