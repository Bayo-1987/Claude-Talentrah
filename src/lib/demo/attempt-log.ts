import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LLMProviderError } from "@/lib/llm/errors";
import type { ClaimReason } from "@/lib/demo/anonymous-limit";
import { safeErrorClass, safeReason, type AttemptReason } from "@/lib/demo/attempt-codes";

/**
 * One row per attempt at the homepage demo (migration 0208), so "barely used" and "silently failing" stop
 * looking the same. Before this, three runs had ever been recorded and a refusal left no trace at all.
 *
 * NO PII, BY CONSTRUCTION AND BY SCHEMA: the row has an outcome, a reason or error class (short codes), and a
 * boolean. The two code columns carry check constraints in the database (0208; see attempt-codes.ts), so a visitor's
 * text could not be stored in them even by a writer that tried; this writer also sanitises before inserting, because a
 * refused insert would be a lost row. No address (not even the hash), no visitor id, no pasted text, no error message — messages from
 * the model call can echo the prompt, which holds the visitor's paste.
 *
 * FAIL-SAFE: this runs on a request path that must answer the visitor whether or not the log works, and the
 * table may not even be applied yet when this code first deploys. It never rejects.
 */
export type DemoOutcome = "success" | "refused" | "error" | "invalid";

export interface DemoAttempt {
  outcome: DemoOutcome;
  /** refused: which limit; invalid: why the paste was turned away. */
  reason?: string | null;
  /** error: the class of failure (provider kind or constructor name), never its message. */
  errorClass?: string | null;
  /** Whether a per-IP rule was in play for this request (it is OFF unless ANON_DEMO_IP_SALT is set). */
  ipRuleActive: boolean;
}

export async function recordDemoAttempt(attempt: DemoAttempt): Promise<void> {
  try {
    const { error } = await createServiceRoleClient().from("anonymous_demo_attempts").insert({
      outcome: attempt.outcome,
      reason: safeReason(attempt.reason),
      error_class: safeErrorClass(attempt.errorClass),
      ip_rule_active: attempt.ipRuleActive,
    });
    if (error) console.error("[anon-demo] could not record attempt:", error.message);
  } catch (err) {
    console.error("[anon-demo] could not record attempt:", err instanceof Error ? err.name : "unknown");
  }
}

/**
 * Which limit said no. `already_used` is a unique-index hit on EITHER the visitor cookie or the IP hash and the
 * SQL does not say which; with the IP rule off (no salt) it can only have been the cookie, and with it on the
 * honest answer is "one of the two" rather than a guess.
 */
export function classifyRefusal(reason: ClaimReason | string, ipRuleActive: boolean): AttemptReason {
  switch (reason) {
    case "already_used":
      return ipRuleActive ? "visitor_or_ip" : "visitor_cookie";
    case "daily_cap":
      return "daily_cap";
    case "no_identifier":
      return "unidentifiable";
    default:
      return "claim_error";
  }
}

/** The class of a failure, never its text. */
export function classifyError(err: unknown): string {
  if (err instanceof LLMProviderError) return err.kind;
  // The name goes through the same sanitiser the writer uses, so what this returns always fits the column.
  if (err instanceof Error) return safeErrorClass(err.constructor?.name || err.name || "Error") ?? "Error";
  return "unknown";
}
