import "server-only";
import { massSendIdentity, resolveMassSendConfig } from "@/lib/email/mass-send-config";
import { createResendMassProvider } from "@/lib/email/mass-send-provider";
import { systemClock } from "@/lib/email/mass-send";
import { isFeatureEnabled } from "@/lib/flags/read";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  adminEmailEligibleRecipients,
  claimNotification,
  finishAdminMessageSend,
  markNotificationSent,
  pauseAdminMessageSend,
  recordAdminMessageProgress,
} from "@/lib/notifications/contract-db";
import { runEmailSend, type EmailRunOptions, type EmailRunResult } from "./run-email";
import { emailSendStoreFromClient, recipientDirectoryFromClient } from "./supabase-ports";

/**
 * Runs the email channel of one admin message with the real database, the real provider and the system clock. The caller (the admin Send action, after the start function has
 * moved the message to `sending`) has already checked who is allowed to send; this checks nothing about a person, only the flags, the limits and every recipient.
 */
export async function sendAdminMessageEmail(messageId: string, options?: EmailRunOptions): Promise<EmailRunResult> {
  const client = createServiceRoleClient();
  return runEmailSend(
    {
      rpcs: {
        adminEmailEligibleRecipients: (args) => adminEmailEligibleRecipients(client, args),
        claimNotification: (args) => claimNotification(client, args),
        markNotificationSent: (args) => markNotificationSent(client, args),
        recordAdminMessageProgress: (args) => recordAdminMessageProgress(client, args),
        finishAdminMessageSend: (args) => finishAdminMessageSend(client, args),
        pauseAdminMessageSend: (args) => pauseAdminMessageSend(client, args),
      },
      store: emailSendStoreFromClient(client),
      directory: recipientDirectoryFromClient(client),
      provider: createResendMassProvider(),
      flags: (key) => isFeatureEnabled(key),
      clock: systemClock,
      log: (line) => console.info(line),
      identity: massSendIdentity(),
      config: resolveMassSendConfig(),
    },
    messageId,
    options,
  );
}

export { runEmailSend } from "./run-email";
export type { EmailRunResult, EmailRunStatus } from "./run-email";
