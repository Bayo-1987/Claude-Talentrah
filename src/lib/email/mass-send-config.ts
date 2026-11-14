/**
 * Settings of the admin mass-email path. Nothing here reads a secret.
 *
 * The provider's own limits are the ceiling of every number below: 100 emails per request, and a team-wide rate of ten requests a second. The first release is far slower than the
 * second on purpose (one request every 2000 ms, never two in flight) because a mass send is not urgent and the same API key also carries the deletion confirmations, the export
 * notices and the receipts, which must never queue behind a newsletter.
 */

/** The provider's maximum number of emails in one batch request. The configured size can never exceed it. */
export const PROVIDER_MAX_PER_REQUEST = 100;

/** The least time between the START of one request and the start of the next. The configured gap can never be shorter. */
export const MIN_REQUEST_GAP_MS = 2000;

/** How many times one batch is re-sent after a rate-limit answer before the run stops. The retry carries the SAME idempotency key, so it can never send twice. */
export const MAX_RATE_LIMIT_RETRIES = 3;

/** When the provider reports this many requests left in its window or fewer, the next gap is stretched (see `slowDownGapMs`). */
export const LOW_RATE_REMAINING = 3;

/**
 * What the provider's free plan allows, used only to turn the "used so far" quota headers into a "left" figure. They are DEFAULTS of this code, not read from the provider; a
 * different plan sets `MASS_EMAIL_PROVIDER_DAILY_LIMIT` / `MASS_EMAIL_PROVIDER_MONTHLY_LIMIT`. The owner's own cap (50 a day) and ceiling (2,000 a month) sit below both.
 */
export const DEFAULT_PROVIDER_DAILY_LIMIT = 100;
export const DEFAULT_PROVIDER_MONTHLY_LIMIT = 3000;

export type MassSendConfig = {
  /** Emails per request, 1 to 100. */
  perRequest: number;
  /** Milliseconds between the start of two requests, 2000 or more. */
  gapMs: number;
};

export class MassSendConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MassSendConfigError";
  }
}

export const DEFAULT_MASS_SEND_CONFIG: MassSendConfig = { perRequest: PROVIDER_MAX_PER_REQUEST, gapMs: MIN_REQUEST_GAP_MS };

/**
 * The pace settings, checked. A value past the provider's limit is REFUSED, not trimmed: a config that silently became something else is a config nobody can reason about.
 */
export function resolveMassSendConfig(overrides: Partial<MassSendConfig> = {}): MassSendConfig {
  const perRequest = overrides.perRequest ?? DEFAULT_MASS_SEND_CONFIG.perRequest;
  const gapMs = overrides.gapMs ?? DEFAULT_MASS_SEND_CONFIG.gapMs;
  if (!Number.isInteger(perRequest) || perRequest < 1) throw new MassSendConfigError("emails per request must be a whole number of at least 1");
  if (perRequest > PROVIDER_MAX_PER_REQUEST) throw new MassSendConfigError(`emails per request cannot exceed the provider's maximum of ${PROVIDER_MAX_PER_REQUEST}`);
  if (!Number.isFinite(gapMs) || gapMs < MIN_REQUEST_GAP_MS) throw new MassSendConfigError(`the gap between requests cannot be shorter than ${MIN_REQUEST_GAP_MS} ms`);
  return { perRequest, gapMs };
}

export type MassSendIdentity = { from: string; replyTo: string | null };

/**
 * The address mass mail is sent from, read from configuration. There is no fallback: sign-in mail goes out as hello@talentrah.com through the provider's SMTP, the transactional
 * senders have their own fixed addresses, and a mass send must never borrow either. With `MASS_EMAIL_FROM` unset this returns null and the sender refuses to start.
 */
export function massSendIdentity(env: Record<string, string | undefined> = process.env): MassSendIdentity | null {
  const from = (env.MASS_EMAIL_FROM ?? "").trim();
  if (!from) return null;
  const replyTo = (env.MASS_EMAIL_REPLY_TO ?? "").trim();
  return { from, replyTo: replyTo || null };
}
