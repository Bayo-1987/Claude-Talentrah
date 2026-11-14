import { adminMessageRecipientsTable, type NotificationClient } from "@/lib/notifications/contract-db";
import { countOutcomes, type OutcomeCounts } from "@/components/admin/messages/outcome-counts";

/**
 * Outcome counts for one message. It selects the outcome and channel columns ONLY: no user id, no address, no name leaves the database, so there is nothing to leak into the page.
 * The audience ceiling is 5000, so the whole message fits in one read.
 */
export async function readOutcomeCounts(client: NotificationClient, messageId: string): Promise<OutcomeCounts> {
  const { data, error } = await adminMessageRecipientsTable(client)
    .select("push_outcome, email_outcome, to_push, to_email")
    .eq("message_id", messageId)
    .limit(5000);
  if (error) throw new Error("admin messaging: could not read the outcome counts");
  return countOutcomes((data ?? []) as Parameters<typeof countOutcomes>[0]);
}
