import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Idempotency-Key of one email batch, derived from the batch's RECIPIENT SET, never from its position and never from an address (build spec Fix 1; email-logging addendum rule 3):
 *
 *   sha256(messageId + ":" + sortedRecipientIds.join(","))
 *
 * Message id plus batch index is wrong: a resumed send can regroup recipients, so the same index would hold different people and the provider would treat the second batch as a repeat of the first. A key from the exact set cannot
 * collide that way: the same set gives the same key in any order, a different set (or the same set under a different message) gives a different one. A person listed twice is one person. Hex, 64 characters, far under the provider's
 * 256-character limit.
 *
 * Ids only: a value that is not a UUID is refused, so an address can never be hashed into a key by accident.
 */
export function batchIdempotencyKey(messageId: string, recipientIds: readonly string[]): string {
  if (!UUID.test(messageId)) throw new Error("the message id must be a UUID");
  for (const id of recipientIds) {
    if (!UUID.test(id)) throw new Error("recipient ids must be UUIDs (an id, never an address)");
  }
  const sorted = [...new Set(recipientIds.map((id) => id.toLowerCase()))].sort();
  return createHash("sha256").update(`${messageId.toLowerCase()}:${sorted.join(",")}`).digest("hex");
}
