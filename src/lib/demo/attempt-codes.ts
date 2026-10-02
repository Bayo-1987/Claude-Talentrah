/**
 * The only values the homepage-demo attempt log may hold in its two short-string columns, and the shapes the DATABASE
 * enforces for them (migration 0208's check constraints):
 *
 *   reason       CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,32}$')
 *   error_class  CHECK (error_class IS NULL OR error_class ~ '^[A-Za-z0-9_.]{1,64}$')
 *
 * "No personal data" is therefore a property of the schema: a sentence has spaces and is long, so a visitor's pasted
 * job description cannot be stored in either column, even by a future writer that tried. These lists are what the
 * route writes today; tests/demo/attempt-codes.test.ts fails if any listed code does not fit the shape, and
 * tests/demo/attempt-table.test.ts proves the real database accepts every one of them and refuses the rest.
 *
 * Pure (no imports) so the dry-run generator and the tests can read it without pulling in server-only code.
 */

/** `reason` when the outcome is `refused`: which limit said no. */
export const REFUSAL_REASONS = ["daily_cap", "visitor_cookie", "visitor_or_ip", "unidentifiable", "claim_error"] as const;

/** `reason` when the outcome is `invalid`: why a paste was turned away before any limit was spent. */
export const INVALID_REASONS = ["link_only", "too_short", "malformed_body"] as const;

export const ATTEMPT_REASONS = [...REFUSAL_REASONS, ...INVALID_REASONS] as const;
export type AttemptReason = (typeof ATTEMPT_REASONS)[number];

/** `error_class` when the failure is a provider error (src/lib/llm/errors.ts). Other errors use their class name. */
export const PROVIDER_ERROR_KINDS = ["rate_limit", "auth", "unknown"] as const;

/** Exactly the database's patterns (kept in step by tests/demo/attempt-table.test.ts, which runs against the real one). */
export const REASON_SHAPE = /^[a-z_]{1,32}$/;
export const ERROR_CLASS_SHAPE = /^[A-Za-z0-9_.]{1,64}$/;

/**
 * What a reason becomes on its way into the table. A listed code passes through; null stays null; anything else
 * becomes "other". A value the constraint would refuse is a LOST row (the insert fails and the writer swallows it), so
 * the writer sanitises instead of trusting every caller to know the shape.
 */
export function safeReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (ATTEMPT_REASONS as readonly string[]).includes(value) ? value : "other";
}

/**
 * What an error class becomes: characters a class name never has are stripped, the length is capped at 64, and
 * nothing left means "unknown". null stays null. The result always fits ERROR_CLASS_SHAPE.
 */
export function safeErrorClass(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.replace(/[^A-Za-z0-9_.]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unknown";
}
