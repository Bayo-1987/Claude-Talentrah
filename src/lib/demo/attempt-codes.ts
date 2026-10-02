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
 * A VALUE THAT DOES NOT FIT IS NEVER REPAIRED. Stripping or truncating it would write a valid-looking code that means
 * something else ("ünï" becoming "n"), which is worse than no data. An unknown reason is written as "other", a
 * malformed error class as "Other", and the raw value goes to the SERVER LOG once (never to the database) so the code
 * can be added here properly.
 *
 * Pure apart from that one log line (no imports), so the dry-run generator and the tests can read it without pulling
 * in server-only code.
 */

/** `reason` when the outcome is `refused`: which limit said no. */
export const REFUSAL_REASONS = ["daily_cap", "visitor_cookie", "visitor_or_ip", "unidentifiable", "claim_error"] as const;

/** `reason` when the outcome is `invalid`: why a paste was turned away before any limit was spent. */
export const INVALID_REASONS = ["link_only", "too_short", "malformed_body"] as const;

/** What the writer records for a reason it does not know (it fits the schema; the raw value is in the server log). */
export const OTHER_REASON = "other" as const;

export const ATTEMPT_REASONS = [...REFUSAL_REASONS, ...INVALID_REASONS, OTHER_REASON] as const;
export type AttemptReason = (typeof ATTEMPT_REASONS)[number];

/** `error_class` when the failure is a provider error (src/lib/llm/errors.ts). Other errors use their class name. */
export const PROVIDER_ERROR_KINDS = ["rate_limit", "auth", "unknown"] as const;

/** What the writer records for an error class that does not fit the shape. */
export const OTHER_ERROR_CLASS = "Other" as const;

/** Exactly the database's patterns (kept in step by tests/demo/attempt-table.test.ts, which runs against the real one). */
export const REASON_SHAPE = /^[a-z_]{1,32}$/;
export const ERROR_CLASS_SHAPE = /^[A-Za-z0-9_.]{1,64}$/;

/** Raw values already logged by this process: each unknown value is logged once, and the set is bounded. */
const loggedUnknowns = new Set<string>();
const MAX_LOGGED_UNKNOWNS = 100;
/** A log line must not be able to grow without bound: the VALUE is cut for the log; the table never gets it at all. */
const MAX_LOGGED_VALUE_CHARS = 200;

function logUnknownOnce(field: "reason" | "error_class", raw: string, writtenAs: string): void {
  const key = `${field}\u0000${raw}`;
  if (loggedUnknowns.has(key) || loggedUnknowns.size >= MAX_LOGGED_UNKNOWNS) return;
  loggedUnknowns.add(key);
  console.warn(
    `[anon-demo] unknown ${field} ${JSON.stringify(raw.length > MAX_LOGGED_VALUE_CHARS ? raw.slice(0, MAX_LOGGED_VALUE_CHARS) + "…" : raw)} ` +
      `written to the attempt log as "${writtenAs}"; add it to src/lib/demo/attempt-codes.ts if it is a real code`,
  );
}

/** Test hook: forget what was logged, so a test can see the log-once behaviour from a clean start. */
export function _resetUnknownLogForTests(): void {
  loggedUnknowns.clear();
}

/**
 * What a reason becomes on its way into the table: a listed code passes through unchanged, null stays null, and
 * anything else is "other". A value the constraint would refuse is a LOST row (the insert fails and the writer
 * swallows it), so the writer picks the catch-all instead of trusting every caller to know the shape.
 */
export function safeReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if ((ATTEMPT_REASONS as readonly string[]).includes(value)) return value;
  logUnknownOnce("reason", value, OTHER_REASON);
  return OTHER_REASON;
}

/**
 * What an error class becomes: a value that fits the shape passes through unchanged, null stays null, and anything
 * else is "Other". It is NOT repaired (no stripping, no truncating): see the note at the top of this file.
 */
export function safeErrorClass(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (ERROR_CLASS_SHAPE.test(value)) return value;
  logUnknownOnce("error_class", value, OTHER_ERROR_CLASS);
  return OTHER_ERROR_CLASS;
}
