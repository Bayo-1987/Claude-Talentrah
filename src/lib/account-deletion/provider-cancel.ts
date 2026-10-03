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
 * "ALREADY CANCELLED" IS SUCCESS. A refusal whose message says the authorisation is already deactivated, inactive or not found means the card cannot be
 * charged, which is what this is for. Any other refusal (a bad key, a malformed code) says nothing about the card and blocks the deletion.
 *
 * Authorisation codes are never logged; the log names the source and row id only.
 */
export interface StoredAuthorization {
  source: string;
  id: string;
  authorization_code: string;
}

export type CancelOutcome = { ok: true; cancelled: number } | { ok: false; cancelled: number; failedSource: string; failedId: string };

const ALREADY_NOT_CHARGEABLE = /already.*(deactivat|inactive)|not found|no longer (active|valid)/i;

function isAlreadyNotChargeable(err: unknown): boolean {
  const e = err as { kind?: unknown; message?: unknown } | null;
  return !!e && e.kind === "decline" && typeof e.message === "string" && ALREADY_NOT_CHARGEABLE.test(e.message);
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
      if (isAlreadyNotChargeable(err)) {
        cancelled += 1;
        continue;
      }
      console.error(`[account-deletion] could not cancel a stored card (${a.source} ${a.id}):`, err instanceof Error ? err.message : String(err));
      return { ok: false, cancelled, failedSource: a.source, failedId: a.id };
    }
  }
  return { ok: true, cancelled };
}
