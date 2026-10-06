import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ALERT_ATTEMPT_LEASE_SECONDS, ALERT_MAX_ATTEMPTS_PER_DAY, MISSING_OBJECT_CODES, type SpendAlertLevel } from "./spend-ceiling";

/**
 * The daily usage counter (migration 0223) as three functions. The counter is one table and one function, `add_llm_usage(bucket, nano)`, granted to the service role only:
 * it adds in a single statement and returns the new running total for today (the DATABASE's UTC date). Reading is adding zero. Nothing here keeps state, and nothing here
 * swallows an error: a failure to reach the counter must surface so the route can fail closed (a counter that cannot be read is not "zero spent").
 */
/** A failure reaching the counter. Carries the database error code (never its message, which can echo request detail) so the route can log it content-free. */
export class SpendTallyError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "SpendTallyError";
    this.code = code;
  }
  /** True when the code says the counter's function or table does not exist, which is how an unapplied migration shows. */
  get missingMigration(): boolean {
    return this.code !== null && MISSING_OBJECT_CODES.has(this.code);
  }
}

const SPEND_BUCKET = "farah_chat";
const HALFWAY_BUCKET = "farah_chat_half_warned";

async function add(bucket: string, nano: number): Promise<number> {
  if (!Number.isInteger(nano) || nano < 0) throw new Error("spend tally: the amount must be a whole, non-negative number of nano-dollars");
  // The generated Database types do not list this function until they are regenerated after 0223.
  const { data, error } = await (createServiceRoleClient().rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)(
    "add_llm_usage",
    { p_bucket: bucket, p_nano: nano },
  );
  if (error) throw new SpendTallyError(`spend tally: add_llm_usage failed (${error.code ?? "no code"})`, error.code ?? null);
  const total = typeof data === "number" ? data : typeof data === "string" && data.trim() !== "" ? Number(data) : Number.NaN;
  if (!Number.isFinite(total)) throw new SpendTallyError("spend tally: add_llm_usage did not return a number", null);
  return total;
}

/** Today's estimated spend so far, in nano-dollars (adds zero; the first read of a day creates that day's row at 0). */
export function readSpendNano(): Promise<number> {
  return add(SPEND_BUCKET, 0);
}

/** Adds an amount to today's estimated spend and returns the new total. */
export function addSpendNano(nano: number): Promise<number> {
  return add(SPEND_BUCKET, nano);
}

/** True for exactly one caller per day: the one whose add of 1 to the halfway marker returns 1. */
export async function markHalfwayWarned(): Promise<boolean> {
  return (await add(HALFWAY_BUCKET, 1)) === 1;
}

type RpcCall = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

/** The operator-alert attempt functions (migration 0235). Each answers a plain boolean; anything else is an error, never permission to send. */
async function alertRpc(fn: "claim_llm_alert_attempt" | "mark_llm_alert_sent", args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await (createServiceRoleClient().rpc as unknown as RpcCall)(fn, args);
  if (error) throw new SpendTallyError(`spend tally: ${fn} failed (${error.code ?? "no code"})`, error.code ?? null);
  if (typeof data !== "boolean") throw new SpendTallyError(`spend tally: ${fn} did not return a boolean`, null);
  return data;
}

/**
 * True when THIS caller may try to send the alert now (the counter decides, in one statement: not already sent today, fewer than ALERT_MAX_ATTEMPTS_PER_DAY attempts taken, and the last attempt's lease of
 * ALERT_ATTEMPT_LEASE_SECONDS has run out). It takes an attempt; it does not close the alert.
 */
export function claimAlertAttempt(level: SpendAlertLevel): Promise<boolean> {
  return alertRpc("claim_llm_alert_attempt", { p_alert: level, p_max_attempts: ALERT_MAX_ATTEMPTS_PER_DAY, p_lease_seconds: ALERT_ATTEMPT_LEASE_SECONDS });
}

/** Records that today's alert went out; true for the call that recorded it. Call it only after a send that succeeded. */
export function markAlertSent(level: SpendAlertLevel): Promise<boolean> {
  return alertRpc("mark_llm_alert_sent", { p_alert: level });
}
