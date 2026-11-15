import { adminMessageRecipientsTable, adminMessagesTable, type NotificationClient } from "@/lib/notifications/contract-db";
import type { AdminRecipientOutcome } from "@/lib/notifications/contract";
import type { EmailSendStore, MessageForSend, RecipientDirectory, RecipientRecord } from "./ports";

/**
 * The real stores behind the email runner's ports, over a service-role client. The database's own error text is not echoed anywhere: it can carry a value.
 */

function fail(what: string): never {
  throw new Error(`admin email send: could not ${what}`);
}

export function emailSendStoreFromClient(client: NotificationClient): EmailSendStore {
  return {
    async getMessage(messageId) {
      const { data, error } = await adminMessagesTable(client)
        .select("id, kind, title, body, link_path, channels, consent_line, status")
        .eq("id", messageId)
        .maybeSingle();
      if (error) fail("read the message");
      return (data ?? null) as MessageForSend | null;
    },

    async queuedEmailRecipientIds(messageId) {
      const { data, error } = await adminMessageRecipientsTable(client)
        .select("user_id")
        .eq("message_id", messageId)
        .eq("to_email", true)
        .is("email_outcome", null)
        .order("user_id", { ascending: true });
      if (error) fail("read the queued recipients");
      return ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
    },

    async setEmailOutcome(messageId, userIds, outcome: AdminRecipientOutcome) {
      if (userIds.length === 0) return;
      const { error } = await adminMessageRecipientsTable(client)
        .update({ email_outcome: outcome })
        .eq("message_id", messageId)
        .in("user_id", [...userIds]);
      if (error) fail("record the email outcomes");
    },
  };
}

/** Looks recipients up at the moment a batch is built: the address, the person's own unsubscribe token, and whether they have switched this stream off. */
export function recipientDirectoryFromClient(client: NotificationClient): RecipientDirectory {
  return {
    async lookup(userIds, stream) {
      const out = new Map<string, RecipientRecord>();
      if (userIds.length === 0) return out;
      const ids = [...userIds];
      const { data: profiles, error: profilesError } = await client
        .from("profiles")
        .select("id, email, first_name, deletion_requested_at")
        .in("id", ids);
      if (profilesError) fail("read the recipients");
      const { data: prefs, error: prefsError } = await client
        .from("email_preferences")
        .select("user_id, unsubscribe_token, email_announcements, email_promotions")
        .in("user_id", ids);
      if (prefsError) fail("read the recipients' preferences");

      const prefsById = new Map((prefs ?? []).map((p) => [p.user_id, p]));
      for (const p of profiles ?? []) {
        const pref = prefsById.get(p.id);
        const column = stream === "promotions" ? pref?.email_promotions : pref?.email_announcements;
        out.set(p.id, {
          present: true,
          deleting: p.deletion_requested_at !== null,
          email: p.email && p.email.trim() ? p.email : null,
          unsubscribeToken: pref?.unsubscribe_token ?? null,
          firstName: p.first_name ?? null,
          optedOut: column === false || column === undefined,
        });
      }
      return out;
    },
  };
}
