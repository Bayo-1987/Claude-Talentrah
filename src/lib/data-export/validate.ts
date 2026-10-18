import { REASON_CODES, REQUESTER_CHECKS, TICKET_PATTERN, type ReasonCode, type RequesterCheck } from "./constants";

/**
 * The fields of the admin form, checked BEFORE anything is written or read. A value that fails here is a malformed request, not a start: no audit row is written for it (the ticket field in
 * particular could hold anything, and a log that is kept for three years must not). The target is NOT checked here: a target that is not a uuid is a refusal with its own audited code.
 */
export type StartFields = { ticket: string; reason: ReasonCode; requesterCheck: RequesterCheck };
export type CancelFields = { ticket: string };

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function parseStartFields(body: Record<string, unknown>): { ok: true; fields: StartFields } | { ok: false; field: "ticket" | "reason" | "requesterCheck" } {
  const ticket = asString(body.ticket);
  if (!TICKET_PATTERN.test(ticket)) return { ok: false, field: "ticket" };
  const reason = asString(body.reason);
  if (!(REASON_CODES as readonly string[]).includes(reason)) return { ok: false, field: "reason" };
  const requesterCheck = asString(body.requesterCheck);
  if (!(REQUESTER_CHECKS as readonly string[]).includes(requesterCheck)) return { ok: false, field: "requesterCheck" };
  return { ok: true, fields: { ticket, reason: reason as ReasonCode, requesterCheck: requesterCheck as RequesterCheck } };
}

export function parseCancelFields(body: Record<string, unknown>): { ok: true; fields: CancelFields } | { ok: false; field: "ticket" } {
  const ticket = asString(body.ticket);
  return TICKET_PATTERN.test(ticket) ? { ok: true, fields: { ticket } } : { ok: false, field: "ticket" };
}
