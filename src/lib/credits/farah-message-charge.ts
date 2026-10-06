import { CREDIT_COSTS } from "@/lib/credits/costs";

/**
 * What the next Farah message costs one account. THE ONE FUNCTION: the gate that charges (src/lib/farah/chat-gate.ts, checkFarahChatAllowance) and every chip label (price-labels.ts, farahChipCostLabel) call
 * it, so a label can never promise a price the gate does not take. Pure and client-safe: no database, no React.
 *
 * The order is the gate's own, confirmed by the founder (0123): a free message first, then an active Pass, then credits. (A free message is used even by a Pass holder: the free count is a rolling window,
 * so nothing permanent is wasted.)
 *
 *   unknown       - something the answer depends on is not known yet (the free count has not loaded): a chip is disabled and promises nothing
 *   free          - a free message; `freeAfter` are left after it
 *   pass          - covered by an active Pass: no credits
 *   credits       - costs `credits`; the balance (when known) covers it, or the balance is not known
 *   insufficient  - costs `required` credits and the known balance `available` is below that: the gate refuses it
 */
export type FarahMessageCharge =
  | { kind: "unknown" }
  | { kind: "free"; freeAfter: number }
  | { kind: "pass" }
  | { kind: "credits"; credits: number }
  | { kind: "insufficient"; required: number; available: number };

export function farahMessageCharge(input: {
  /** Free messages left BEFORE this one. undefined = not known yet. */
  freeLeft: number | undefined;
  /** An active Pass covers this message right now. Only consulted when no free message is left. undefined = not known. */
  passCovered: boolean | undefined;
  /** The credit balance. undefined = not known (the price is still stated; a refusal cannot be predicted). */
  balance: number | undefined;
}): FarahMessageCharge {
  const { freeLeft, passCovered, balance } = input;
  if (freeLeft === undefined) return { kind: "unknown" };
  if (freeLeft > 0) return { kind: "free", freeAfter: freeLeft - 1 };
  if (passCovered === undefined) return { kind: "unknown" };
  if (passCovered) return { kind: "pass" };
  const cost = CREDIT_COSTS.farahChatMessage;
  if (balance !== undefined && balance < cost) return { kind: "insufficient", required: cost, available: balance };
  return { kind: "credits", credits: cost };
}

/** The price of one paid message, for text that reports a charge after the fact ("1 credit used"). From the same function as the gate. */
export function paidMessageCredits(): number {
  const c = farahMessageCharge({ freeLeft: 0, passCovered: false, balance: undefined });
  return c.kind === "credits" ? c.credits : 0;
}

/**
 * The same decision from what the panel holds: the free count as /api/farah/history reports it (a number; null for an account an active Pass covers; undefined until the panel has loaded it) and the
 * balance the masthead shows (undefined until known).
 */
export function panelChipCharge(freeRemaining: number | null | undefined, balance: number | undefined): FarahMessageCharge {
  if (freeRemaining === undefined) return { kind: "unknown" };
  if (freeRemaining === null) return farahMessageCharge({ freeLeft: 0, passCovered: true, balance });
  return farahMessageCharge({ freeLeft: freeRemaining, passCovered: false, balance });
}
