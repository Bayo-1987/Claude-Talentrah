import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The daily usage counter (migration 0223) as three functions. The counter is one table and one function, `add_llm_usage(bucket, nano)`, granted to the service role only:
 * it adds in a single statement and returns the new running total for today (the DATABASE's UTC date). Reading is adding zero. Nothing here keeps state, and nothing here
 * swallows an error: a failure to reach the counter must surface so the route can fail closed (a counter that cannot be read is not "zero spent").
 */
/** What the database or its API answers when the counter's function or table is not there: the migration (0223) has not been applied to this project. */
const MISSING_OBJECT_CODES = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);

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
