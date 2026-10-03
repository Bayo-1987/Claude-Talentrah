import { deactivateAuthorization } from "@/lib/paystack/client";

/**
 * Cancels the stored card authorisations of an account that is about to be scheduled for deletion, at the payment provider.
 *
 * WHY THIS EXISTS. Pass and Talent Directory renewals are not provider-side subscriptions: our own daily cron charges a stored Paystack authorisation
 * code. The database confirm clears those codes and stops the renewals, but a database transaction cannot contain a provider call, so the card itself
 * is made un-chargeable here, BEFORE the confirm. If the provider cannot be reached, or refuses, the deletion is not scheduled at all (the owner's
 * rule): a scheduled deletion with a still-chargeable card is the one outcome that costs the person money after they asked to leave.
 *
 * WHAT FAILURE MEANS. Stops at the FIRST failure and reports it. Authorisations already deactivated stay deactivated (there is no un-deactivate), which
 * is harmless: the next renewal of that Pass would decline once, and the person can resubscribe. The same code appearing on a Pass and on a Talent
 * Directory subscription is one card and is cancelled once.
 *
 * "ALREADY CANCELLED" IS SUCCESS, MATCHED ON DOCUMENTED FIELDS ONLY. Paystack documents, for this endpoint, an HTTP 404 (the resource does not
 * exist) and an error envelope of `status: false`, a `type` (api_error | validation_error | processor_error) and a Paystack-defined `code`. It publishes
 * no code value for "already deactivated", so the rule is the documented status PLUS the documented envelope: a 404 that is a real Paystack error
 * answer means there is nothing left to charge. A bare 404 (a wrong URL, a gateway page) has no envelope and blocks; so does every other refusal; the
 * message text is NEVER read, because free text changes without notice and a wrong match here would schedule a deletion over a live card. (The stored
 * code is also cleared in our database at confirm, and only our own secret key can charge it, so the provider cancel is defence in depth, which is
 * why a documented not-found may safely pass and anything uncertain may not.)
 *
 * Authorisation codes are never logged; the log names the source and row id only.
 */
export interface StoredAuthorization {
  source: string;
  id: string;
  authorization_code: string;
}

export type CancelOutcome = { ok: true; cancelled: number } | { ok: false; cancelled: number; failedSource: string; failedId: string };

const DOCUMENTED_ERROR_TYPES = ["api_error", "validation_error", "processor_error"];

/** True only for Paystack's documented not-found: HTTP 404 with a real error envelope (a documented `type` and a non-blank `code`). */
export function isDocumentedNotFound(err: unknown): boolean {
  const e = err as { kind?: unknown; status?: unknown; type?: unknown; code?: unknown } | null;
  return (
    !!e &&
    e.kind === "decline" &&
    e.status === 404 &&
    typeof e.type === "string" &&
    DOCUMENTED_ERROR_TYPES.includes(e.type) &&
    typeof e.code === "string" &&
    e.code.trim().length > 0
  );
}

export async function cancelStoredAuthorizations(authorizations: StoredAuthorization[]): Promise<CancelOutcome> {
  const seen = new Set<string>();
  let cancelled = 0;
  for (const a of authorizations) {
    const code = a.authorization_code?.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    try {
      await deactivateAuthorization(code);
      cancelled += 1;
    } catch (err) {
      if (isDocumentedNotFound(err)) {
        cancelled += 1;
        continue;
      }
      console.error(`[account-deletion] could not cancel a stored card (${a.source} ${a.id}):`, err instanceof Error ? err.message : String(err));
      return { ok: false, cancelled, failedSource: a.source, failedId: a.id };
    }
  }
  return { ok: true, cancelled };
}
