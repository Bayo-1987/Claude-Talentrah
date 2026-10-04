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
 * Each call logs one structured line with five fields and nothing else (see logCall): never the authorisation code, the key, the email or the provider's
 * message text.
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

type Classification = "deactivated" | "already-deactivated" | "blocked";

/**
 * ONE structured line per deactivate call, so the first real Paystack responses can be read from the logs (the endpoint has not been exercised live;
 * the classification rests on the documented envelope). EXACTLY five fields: the HTTP status, the response's own `status`, its `type` and `code`, and
 * what we made of it. Never the authorisation code, the key, the email or the provider's message text: the message can quote any of them, and it is
 * deliberately not read for the classification either. A refusal that blocks the deletion logs at ERROR so it stands out; the rest at INFO.
 */
function logCall(classification: Classification, fields: { http_status: number | null; status: boolean | null; type: string | null; code: string | null }) {
  const line = JSON.stringify({ http_status: fields.http_status, status: fields.status, type: fields.type, code: fields.code, classification });
  if (classification === "blocked") console.error(`[account-deletion] PAYSTACK_DEACTIVATE ${line}`);
  else console.info(`[account-deletion] PAYSTACK_DEACTIVATE ${line}`);
  if (classification === "already-deactivated") {
    // On a person's FIRST deletion this is suspicious: it can mean the deactivate path is wrong (a wrong path also answers 404). Its own tag, so the
    // first real occurrence is easy to find.
    console.warn(`[account-deletion] PAYSTACK_ALREADY_DEACTIVATED ${line} suspicious on a first deletion: it can mean the deactivate path is wrong`);
  }
}

function fieldsOf(err: unknown) {
  const e = (err ?? {}) as { status?: unknown; httpStatus?: unknown; type?: unknown; code?: unknown; bodyStatus?: unknown; kind?: unknown };
  const httpStatus = typeof e.status === "number" ? e.status : typeof e.httpStatus === "number" ? e.httpStatus : null;
  return {
    http_status: httpStatus,
    status: typeof e.bodyStatus === "boolean" ? e.bodyStatus : null,
    type: typeof e.type === "string" ? e.type : null,
    code: typeof e.code === "string" ? e.code : null,
  };
}

export async function cancelStoredAuthorizations(authorizations: StoredAuthorization[]): Promise<CancelOutcome> {
  const seen = new Set<string>();
  let cancelled = 0;
  for (const a of authorizations) {
    const code = a.authorization_code?.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    try {
      const res = (await deactivateAuthorization(code)) as { httpStatus?: number; status?: boolean } | undefined;
      logCall("deactivated", { http_status: res?.httpStatus ?? null, status: typeof res?.status === "boolean" ? res.status : null, type: null, code: null });
      cancelled += 1;
    } catch (err) {
      if (isDocumentedNotFound(err)) {
        logCall("already-deactivated", fieldsOf(err));
        cancelled += 1;
        continue;
      }
      logCall("blocked", fieldsOf(err));
      return { ok: false, cancelled, failedSource: a.source, failedId: a.id };
    }
  }
  return { ok: true, cancelled };
}
