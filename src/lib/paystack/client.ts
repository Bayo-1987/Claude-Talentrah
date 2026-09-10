import "server-only";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/**
 * Same 15s budget as the schema.org fetcher (src/lib/jobs/sources/schema-org.ts),
 * which was the only timed-out external call in this repo until now. Every
 * other `fetch` here had none, so a hung connection blocked until the platform
 * killed the function — on the renewal cron that means the remaining Passes in
 * the batch are never processed at all.
 */
const PAYSTACK_TIMEOUT_MS = 15_000;

/**
 * ── Why two error types and not one ───────────────────────────────────────
 *
 * Every failure in this module used to throw a bare `Error`, so the only
 * caller that acts on failure — `chargeOne` in src/lib/billing/renewals.ts —
 * could not tell these apart:
 *
 *   * Paystack ANSWERED and said no. The card was declined, the authorization
 *     was revoked, the account has insufficient funds. This is a fact about
 *     the customer, and lapsing their Pass on it is correct and intentional.
 *
 *   * Paystack NEVER ANSWERED. Timeout, DNS failure, connection reset, or a
 *     5xx from Paystack's own infrastructure. This says nothing whatsoever
 *     about the customer, and Talentrah cannot attribute it to them.
 *
 * Collapsing the second into the first is how a network blip cancelled a
 * paying subscription. A 5xx counts as indeterminate deliberately: Paystack
 * returning 502 is Paystack failing, not the customer's card failing, and the
 * charge may still have been processed upstream before the error surfaced.
 */
export class PaystackDeclineError extends Error {
  readonly kind = "decline" as const;
  constructor(
    message: string,
    /** Paystack's own HTTP status, when it gave one. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "PaystackDeclineError";
  }
}

export class PaystackUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PaystackUnavailableError";
  }
}

/**
 * True only when Paystack AFFIRMATIVELY declined — it answered, and the answer
 * was no.
 *
 * The test is deliberately this way round rather than `isIndeterminate`.
 * Callers act on failure by deciding whether to punish the customer, and the
 * question that decision hangs on is "do we have positive evidence the card was
 * refused?", not "does this error look like a network problem?". An error this
 * module has never seen before — a bug in a future call path, a wrapper that
 * forgot to classify, a raw `TimeoutError` escaping from somewhere new — is
 * evidence of nothing, and the safe default for evidence of nothing is to leave
 * the customer's subscription alone and retry.
 *
 * Written the other way round it fails open in the expensive direction: any
 * unrecognised throw cancels a paying subscription. That IS the bug this
 * module was changed to fix, and phrasing the predicate as `isDecline` makes
 * reintroducing it require an explicit, visible decision.
 */
export function isDecline(err: unknown): err is PaystackDeclineError {
  return err instanceof PaystackDeclineError;
}

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not set — configure it in .env.local to take payments.");
  }
  return key;
}

/**
 * One place that turns a `fetch` into either a parsed body, a decline, or an
 * unavailability — so no call site can accidentally reintroduce the
 * one-error-for-everything shape.
 */
async function paystackFetch(
  url: string,
  init: RequestInit,
  operation: string,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS) });
  } catch (err) {
    // Aborts, DNS failures, resets — Paystack was never reached, or never
    // replied in time. Never a statement about the card.
    throw new PaystackUnavailableError(
      `Paystack ${operation} did not complete: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // Paystack's own failure is not the customer's failure.
  if (res.status >= 500) {
    throw new PaystackUnavailableError(`Paystack ${operation} returned ${res.status}`);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    // A 2xx with an unparseable body means we genuinely do not know what
    // happened — treat it as unavailability, not as a decline.
    throw new PaystackUnavailableError(`Paystack ${operation} returned an unreadable body`, err);
  }

  if (!res.ok || !data.status) {
    throw new PaystackDeclineError(
      typeof data.message === "string" ? data.message : `Paystack ${operation} failed.`,
      res.status,
    );
  }
  return data;
}

/**
 * Channels actually valid for an NGN transaction on Paystack. Paystack's
 * `mobile_money` channel string is real, but per their own docs it's gated
 * to Ghana (GHS), Kenya (KES), and Côte d'Ivoire (XOF) accounts — passing it
 * on an NGN initialize call is a silent no-op, not an error. For Nigeria,
 * "bank" (Pay with Bank), "bank_transfer", and "ussd" are the actual
 * low-friction, no-card-required rails users reach for — that's what this
 * app buckets into its own `mobile_money` product concept (§6.9) even
 * though none of them are literally Paystack's `mobile_money` channel.
 * Verified against https://paystack.com/docs/payments/payment-channels/.
 */
export const NGN_CHANNELS = ["card", "bank", "bank_transfer", "ussd"] as const;

interface InitializeParams {
  email: string;
  amountNgn: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  plan?: string;
  channels?: readonly string[];
}

export async function initializeTransaction(params: InitializeParams) {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/transaction/initialize`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: params.email,
        amount: Math.round(params.amountNgn * 100), // Paystack expects kobo
        // Explicit, not left to the Paystack account's own default currency
        // setting. Every product this app sells is NGN-priced (build-prompt
        // §6.9); this is defense against that ever silently not being true.
        currency: "NGN",
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
        plan: params.plan,
        channels: params.channels,
      }),
    },
    "initialization",
  );
  return data.data as { authorization_url: string; access_code: string; reference: string };
}

export interface PaystackAuthorization {
  authorization_code: string;
  channel: string;
  reusable: boolean;
}

export interface VerifyResult {
  status: string;
  reference: string;
  amount: number;
  /** ISO 4217, e.g. "NGN" — what Paystack actually confirmed the charge was in. Ground truth, same reasoning as `channel` below: check it against what the transaction row expects rather than assuming it matches. */
  currency: string;
  /** The channel Paystack actually confirmed the charge went through on — e.g. "card", "bank_transfer", "ussd", "bank", "qr". This is ground truth; never infer the rail from what checkout offered. */
  channel: string;
  authorization?: PaystackAuthorization | null;
  metadata?: Record<string, unknown>;
}

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${getSecretKey()}` } },
    "verification",
  );
  return data.data as VerifyResult;
}

export interface ChargeAuthorizationResult {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel: string;
  gateway_response: string;
}

/**
 * Recharges a Pass on its billing date using the reusable authorization
 * code captured from the original card transaction — no re-entered card
 * details, no user interaction. Only ever called by the renewal job
 * (src/lib/billing/renewals.ts) against a stored, card-verified,
 * reusable authorization_code.
 */
export async function chargeAuthorization(params: {
  email: string;
  amountNgn: number;
  authorizationCode: string;
  reference: string;
}): Promise<ChargeAuthorizationResult> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/transaction/charge_authorization`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: params.email,
        amount: Math.round(params.amountNgn * 100),
        authorization_code: params.authorizationCode,
        reference: params.reference,
      }),
    },
    "charge_authorization",
  );
  return data.data as ChargeAuthorizationResult;
}

export interface RefundResult {
  status: string;
  amount: number;
  currency: string;
}

/**
 * send-137's own use: Mentorship's no-show/cancellation policy (a mentor who
 * never confirms by the deadline) refunds the mentee automatically.
 *
 * REQUESTS the refund and returns Paystack's own acknowledgement — it does
 * NOT wait for the refund to finish processing. A Paystack refund is
 * asynchronous on their side (the transaction moves to "processing", then
 * later actually settles), the same way `initializeTransaction` starts a
 * charge without waiting for it to be paid. Reconciling the eventual outcome
 * via Paystack's `refund.processed`/`refund.failed` webhook events is a real
 * gap, stated rather than hidden — this mirrors `fulfillPayment`'s own
 * documented webhook/callback race being "open and out of scope" for two of
 * its three product types. What this DOES guarantee: the request is made,
 * logged, and the session's own status records that a refund was attempted
 * — a human can always reconcile a specific reference against Paystack's
 * dashboard if the webhook path is never built.
 *
 * No `amount` argument: always a full refund. Mentorship v1 has no partial-
 * session concept (a session that never got confirmed was never partially
 * delivered), so there is nothing a partial refund would even mean here.
 */
export async function refundTransaction(reference: string): Promise<RefundResult> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction: reference }),
    },
    "refund",
  );
  return data.data as RefundResult;
}

/* ────────────────────────────────────────────────────────────────────────
 * Transfers — mentor payouts (Mentorship v2, part 1, 0149).
 *
 * The FIRST outbound-money surface in this codebase — everything above pays
 * Talentrah; this pays a mentor. Same provider (Paystack), a genuinely
 * different API family: recipients have to be created once and reused, and
 * an initiated transfer can come back "success", an affirmed "failed"/
 * "reversed", or genuinely unresolved ("pending"/"otp" — some Paystack
 * account tiers require an OTP approval step this codebase has no way to
 * complete non-interactively). That third bucket is real and is why
 * src/lib/mentorship/payouts.ts treats "Paystack accepted the request but
 * hasn't resolved it" as its own outcome, never collapsed into success or
 * failure — exactly the same discipline chargeAuthorization's caller
 * already applies to a Pass renewal that timed out.
 * ──────────────────────────────────────────────────────────────────────── */

export interface PaystackBank {
  name: string;
  code: string;
  currency: string;
}

/** Nigerian bank list for the payout-details form's dropdown — nothing here a mentor should have to type from memory. */
export async function listNigerianBanks(): Promise<PaystackBank[]> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/bank?country=nigeria&currency=NGN`,
    { headers: { Authorization: `Bearer ${getSecretKey()}` } },
    "bank list",
  );
  return (data.data as Array<{ name: string; code: string; currency: string }>).map((b) => ({
    name: b.name,
    code: b.code,
    currency: b.currency,
  }));
}

export interface ResolvedAccount {
  account_number: string;
  account_name: string;
}

/**
 * The account-resolution step this task's own brief requires before ANY
 * account name is persisted: "the account name resolved via Paystack's
 * account-resolution/verification endpoint before saving — never trust a
 * free-typed account name." A decline here (invalid account/bank
 * combination) is Paystack affirmatively saying the pair doesn't resolve —
 * callers should show that to the mentor and save nothing.
 */
export async function resolveAccountNumber(params: {
  accountNumber: string;
  bankCode: string;
}): Promise<ResolvedAccount> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${encodeURIComponent(params.accountNumber)}&bank_code=${encodeURIComponent(params.bankCode)}`,
    { headers: { Authorization: `Bearer ${getSecretKey()}` } },
    "account resolution",
  );
  return data.data as ResolvedAccount;
}

export interface TransferRecipient {
  recipient_code: string;
  details: { account_number: string; account_name: string | null; bank_code: string };
}

/**
 * Created ONCE per mentor and cached on mentor_profiles.payout_recipient_code
 * (src/lib/mentorship/payout-details.ts) — Paystack recipients are reusable,
 * and re-creating one on every payout would be both wasteful and a second
 * place for the account details to silently drift from what was resolved.
 */
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<TransferRecipient> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/transferrecipient`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "nuban",
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: "NGN",
      }),
    },
    "recipient creation",
  );
  return data.data as TransferRecipient;
}

export interface TransferResult {
  transfer_code: string;
  reference: string;
  amount: number;
  currency: string;
  /**
   * Paystack's own transfer status. "success" is the only one that means
   * paid. "otp"/"pending" mean Paystack accepted the request but has not
   * resolved it — genuinely indeterminate, not a failure. "failed"/
   * "reversed" are affirmed non-success. Callers must branch on this string,
   * not just on whether the HTTP call itself threw.
   */
  status: string;
}

/**
 * Requests a transfer OUT of Talentrah's Paystack balance to a mentor.
 * `source: "balance"` is Paystack's own required value for a balance-funded
 * transfer (the only kind this app ever does — there is no other funding
 * source configured). Never call this with a reference that has been used
 * before: Paystack refuses a duplicate reference outright, which is exactly
 * the backstop src/lib/mentorship/payouts.ts leans on the same way
 * credit_ad_wallet already leans on its own reference-uniqueness (0050).
 */
export async function initiateTransfer(params: {
  amountNgn: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<TransferResult> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/transfer`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(params.amountNgn * 100),
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
        currency: "NGN",
      }),
    },
    "transfer",
  );
  return data.data as TransferResult;
}

/**
 * Learns the real outcome of a transfer reference whose result a previous
 * run never confirmed — the transfer equivalent of verifyTransaction, and
 * the mechanism that lets a timed-out initiateTransfer be resolved before
 * ever being retried with a fresh reference (mirrors chargeOne's own
 * pending_renewal_reference recovery in src/lib/billing/renewals.ts).
 */
export async function verifyTransfer(reference: string): Promise<TransferResult> {
  const data = await paystackFetch(
    `${PAYSTACK_BASE_URL}/transfer/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${getSecretKey()}` } },
    "transfer verification",
  );
  return data.data as TransferResult;
}
