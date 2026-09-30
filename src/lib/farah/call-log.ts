import "server-only";
import { randomUUID } from "node:crypto";

/**
 * One structured success line per Farah call, written to the runtime logs (send-485).
 *
 * WHY. "Did that reply really come from the model, which provider, and did it fail over?" had to be
 * inferred from ledger rows and request-level logs, because nothing said so directly. This says so.
 *
 * EXACTLY these keys, in a single JSON object on one line — the test (tests/farah/call-log.test.ts)
 * pins the set, so adding a field is a deliberate, reviewed act:
 *
 *   event       "farah_call" — a fixed marker to filter on
 *   provider    the provider that actually SERVED the reply (the fallback's name after a failover)
 *   model       the concrete model id
 *   latency_ms  whole milliseconds from the call starting until the reply was complete
 *   failover    true when the primary was rate-limited and the fallback served the reply
 *   request_id  a fresh random UUID per call
 *
 * NEVER a message, a reply, a system prompt, a user id or an email. There is deliberately no field that
 * could carry free text, and this function takes no argument that could smuggle one in.
 *
 * A success line only: it is written after the reply completes, so a call that throws writes nothing here
 * (failures already log through their own error paths).
 */
export interface FarahCallLogInput {
  provider: string;
  model: string;
  latencyMs: number;
  failover: boolean;
}

export function buildFarahCallLogLine(input: FarahCallLogInput, requestId: string = randomUUID()) {
  return {
    event: "farah_call" as const,
    provider: input.provider,
    model: input.model,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    failover: input.failover,
    request_id: requestId,
  };
}

export function logFarahCall(input: FarahCallLogInput): void {
  console.info(JSON.stringify(buildFarahCallLogLine(input)));
}
