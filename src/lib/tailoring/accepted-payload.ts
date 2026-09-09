import type { ProposedAddition } from "./types";

/**
 * What `/api/tailoring/accept-additions` actually receives: only the
 * checked items, each carrying whatever text the reviewer currently has in
 * its field — Farah's original wording when they haven't touched it, their
 * own edit when they have (send-119 made the review list's text editable;
 * see tailor-form.tsx's own comment on why that crosses no new trust
 * boundary the accept route doesn't already accept).
 *
 * Pulled out of tailor-form.tsx into its own pure function so this exact
 * decision is unit-testable without simulating a textarea keystroke — this
 * repo's vitest environment is plain Node, with no DOM and no
 * testing-library dependency, so nothing here can drive a real `onChange`.
 */
export function buildAcceptedAdditions(
  proposedAdditions: readonly ProposedAddition[],
  checkedIds: ReadonlySet<string>,
  editedTexts: Readonly<Record<string, string>>,
): ProposedAddition[] {
  return proposedAdditions
    .filter((a) => checkedIds.has(a.id))
    .map((a) => ({ ...a, text: editedTexts[a.id] ?? a.text }));
}
