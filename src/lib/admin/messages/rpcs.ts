import {
  adminMessageAudit,
  approveAdminMessage,
  cancelAdminMessage,
  createAdminMessage,
  prepareAdminMessage,
  recordAdminMessageTest,
  resolveStaleClaim,
  resumeAdminMessageSend,
  setNotificationSetting,
  staleNotificationClaims,
  startAdminMessageSend,
  submitAdminMessage,
  type NotificationClient,
} from "@/lib/notifications/contract-db";
import type { ServiceRpcs } from "@/lib/notifications/contract";

/**
 * The database functions the admin messaging service calls, and nothing else: a narrow slice of the contract so a test (or a reader) can see at a glance what the service is able to do. Every one of them takes the acting admin as
 * an argument; the service fills it from the verified admin session and from nowhere else.
 */
export type MessagingRpcs = Pick<
  ServiceRpcs,
  | "createAdminMessage"
  | "prepareAdminMessage"
  | "submitAdminMessage"
  | "approveAdminMessage"
  | "cancelAdminMessage"
  | "startAdminMessageSend"
  | "recordAdminMessageTest"
  | "adminMessageAudit"
  | "staleNotificationClaims"
  | "resolveStaleClaim"
  | "setNotificationSetting"
  | "resumeAdminMessageSend"
>;

/** The real slice, over a service-role client, through the contract's accessors (the one place the database names live). */
export function messagingRpcsFromClient(client: NotificationClient): MessagingRpcs {
  return {
    createAdminMessage: (args) => createAdminMessage(client, args),
    prepareAdminMessage: (args) => prepareAdminMessage(client, args),
    submitAdminMessage: (args) => submitAdminMessage(client, args),
    approveAdminMessage: (args) => approveAdminMessage(client, args),
    cancelAdminMessage: (args) => cancelAdminMessage(client, args),
    startAdminMessageSend: (args) => startAdminMessageSend(client, args),
    recordAdminMessageTest: (args) => recordAdminMessageTest(client, args),
    adminMessageAudit: (args) => adminMessageAudit(client, args),
    staleNotificationClaims: (args) => staleNotificationClaims(client, args),
    resolveStaleClaim: (args) => resolveStaleClaim(client, args),
    setNotificationSetting: (args) => setNotificationSetting(client, args),
    resumeAdminMessageSend: (args) => resumeAdminMessageSend(client, args),
  };
}
