import type { AdminMessageRow, AdminRecipientOutcome, ServiceRpcs } from "@/lib/notifications/contract";
import type { MassStream } from "@/lib/email/mass-send";

/**
 * What the email runner needs from the world, as ports. The runner is written against these so a test can hand it the in-memory database, a fake provider and a fake clock;
 * production hands it the real ones (supabase-ports.ts, the provider in src/lib/email/mass-send-provider.ts, the system clock).
 */

/** The database functions the runner calls, and nothing else. */
export type EmailRunRpcs = Pick<
  ServiceRpcs,
  | "adminEmailEligibleRecipients"
  | "claimNotification"
  | "markNotificationSent"
  | "recordAdminMessageProgress"
  | "finishAdminMessageSend"
  | "pauseAdminMessageSend"
>;

export type MessageForSend = Pick<AdminMessageRow, "id" | "kind" | "title" | "body" | "link_path" | "channels" | "consent_line" | "status">;

export interface EmailSendStore {
  getMessage(messageId: string): Promise<MessageForSend | null>;
  /** The recipients whose email outcome is still empty (and who were prepared for the email channel), in a stable order. Ids only. */
  queuedEmailRecipientIds(messageId: string): Promise<string[]>;
  /** Writes one closed-list outcome for the given recipients of this message. */
  setEmailOutcome(messageId: string, userIds: readonly string[], outcome: AdminRecipientOutcome): Promise<void>;
}

/**
 * What the sender knows about a recipient at the moment it sends. Addresses and tokens live here and nowhere else: they are read when a batch is built, held for the length
 * of that call, and never written to a log or a result.
 */
export type RecipientRecord = {
  /** False when the account no longer has a profile row (deleted). */
  present: boolean;
  /** True when deletion has been requested. */
  deleting: boolean;
  email: string | null;
  unsubscribeToken: string | null;
  firstName: string | null;
  /** True when the person has switched off the stream this message belongs to. */
  optedOut: boolean;
};

export interface RecipientDirectory {
  lookup(userIds: readonly string[], stream: MassStream): Promise<Map<string, RecipientRecord>>;
}

export type FlagReader = (key: string) => Promise<boolean>;

export type { MassStream };
