import "server-only";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not set — configure it in .env.local to take payments.");
  }
  return key;
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
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: Math.round(params.amountNgn * 100), // Paystack expects kobo
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      plan: params.plan,
      channels: params.channels,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message ?? "Paystack initialization failed.");
  }
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
  /** The channel Paystack actually confirmed the charge went through on — e.g. "card", "bank_transfer", "ussd", "bank", "qr". This is ground truth; never infer the rail from what checkout offered. */
  channel: string;
  authorization?: PaystackAuthorization | null;
  metadata?: Record<string, unknown>;
}

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${getSecretKey()}` },
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message ?? "Paystack verification failed.");
  }
  return data.data as VerifyResult;
}

export interface ChargeAuthorizationResult {
  status: string;
  reference: string;
  amount: number;
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
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/charge_authorization`, {
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
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message ?? "Paystack charge_authorization failed.");
  }
  return data.data as ChargeAuthorizationResult;
}
