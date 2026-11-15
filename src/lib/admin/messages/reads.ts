import type { AdminMessageRow } from "@/lib/notifications/contract";

/**
 * What the page and the service READ (counts and the message rows); every write goes through a database function. Counts only, never a recipient: nothing here returns an address, a name or a person's id.
 */
export interface ChannelCounts {
  inapp: number;
  push: number;
  email: number;
  /** Email recipients with no outcome yet: still queued. */
  queuedEmail: number;
}

export interface EmailLimits {
  cap24h: number;
  ceilingMonth: number;
  /** Mass-email claims in the last 24 hours that were not released (what the cap counts). */
  sentLast24h: number;
  /** Mass-email claims since the start of the current UTC month (what the ceiling counts). */
  sentThisMonth: number;
}

export interface MessagingReads {
  listMessages(limit: number): Promise<AdminMessageRow[]>;
  getMessage(id: string): Promise<AdminMessageRow | null>;
  channelCounts(messageId: string): Promise<ChannelCounts>;
  emailLimits(now: Date): Promise<EmailLimits>;
}

/* ------------------------------------------------------------------ */
/* The real reads, over a service-role client, through the contract's table accessors.                      */
/* ------------------------------------------------------------------ */
import {
  adminMessageRecipientsTable,
  adminMessagesTable,
  deliveriesTable,
  notificationSettingsTable,
  type NotificationClient,
} from "@/lib/notifications/contract-db";

function fail(what: string, error: { message?: string } | null): never {
  // the database's own text is not echoed: it can carry a value
  void error;
  throw new Error(`admin messaging: could not read ${what}`);
}

export function readsFromClient(client: NotificationClient): MessagingReads {
  async function count(build: () => PromiseLike<{ count: number | null; error: { message?: string } | null }>, what: string): Promise<number> {
    const { count: n, error } = await build();
    if (error) fail(what, error);
    return n ?? 0;
  }

  return {
    async listMessages(limit) {
      const { data, error } = await adminMessagesTable(client).select("*").order("created_at", { ascending: false }).limit(limit);
      if (error) fail("the messages", error);
      return (data ?? []) as AdminMessageRow[];
    },

    async getMessage(id) {
      const { data, error } = await adminMessagesTable(client).select("*").eq("id", id).maybeSingle();
      if (error) fail("a message", error);
      return (data ?? null) as AdminMessageRow | null;
    },

    async channelCounts(messageId) {
      const head = { count: "exact" as const, head: true };
      const [inapp, push, email, queuedEmail] = await Promise.all([
        count(() => adminMessageRecipientsTable(client).select("id", head).eq("message_id", messageId).eq("to_inapp", true), "the in-app count"),
        count(() => adminMessageRecipientsTable(client).select("id", head).eq("message_id", messageId).eq("to_push", true), "the push count"),
        count(() => adminMessageRecipientsTable(client).select("id", head).eq("message_id", messageId).eq("to_email", true), "the email count"),
        count(() => adminMessageRecipientsTable(client).select("id", head).eq("message_id", messageId).eq("to_email", true).is("email_outcome", null), "the queued count"),
      ]);
      return { inapp, push, email, queuedEmail };
    },

    async emailLimits(now) {
      const head = { count: "exact" as const, head: true };
      const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const { data, error } = await notificationSettingsTable(client).select("key, int_value");
      if (error) fail("the limits", error);
      const setting = (key: string) => (data ?? []).find((row) => row.key === key)?.int_value ?? 0;
      // the same predicates the claim function counts: mass-email claims that were not released
      const open = () => deliveriesTable(client).select("id", head).eq("kind", "admin_message").eq("channel", "email").is("released_at", null);
      const [sentLast24h, sentThisMonth] = await Promise.all([
        count(() => open().gt("claimed_at", dayAgo), "the 24-hour count"),
        count(() => open().gte("claimed_at", monthStart), "the month count"),
      ]);
      return { cap24h: setting("mass_email_cap_24h"), ceilingMonth: setting("mass_email_ceiling_month"), sentLast24h, sentThisMonth };
    },
  };
}
