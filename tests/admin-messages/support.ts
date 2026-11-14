import type { ComposeInput, MessagingFlags } from "@/lib/admin/messages/service";
import type { MessagingReads } from "@/lib/admin/messages/reads";
import type { MessagingRpcs } from "@/lib/admin/messages/rpcs";
import type { AdminActor } from "@/lib/admin/messages/actor";
import { NOTIFICATION_FLAGS, NOTIFICATION_LIMITS, type NotificationFlagKey, type NotificationPermission } from "@/lib/notifications/contract";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * Shared set-up for the admin-messages unit tests: the contract's fake backend (which models the database's rules), a flag reader the tests drive, a spy over the service's database slice, and the reads port over the fake's rows.
 * Nothing here names a database table or function: the boundary test scans this folder.
 */
export const CREATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const APPROVER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SUPER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const NO_ONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

export function actor(adminId: string, permissions: readonly string[]): AdminActor {
  return { adminId, permissions: permissions as AdminActor["permissions"] };
}
export const creator = () => actor(CREATOR, ["user_messaging"]);
export const approver = () => actor(APPROVER, ["user_messaging"]);
export const superAdmin = () => actor(SUPER, ["user_messaging", "operators"]);
export const outsider = () => actor(NO_ONE, ["scholarships"]);

export type FlagState = Partial<Record<keyof typeof NOTIFICATION_FLAGS, boolean>>;

export function makeWorld(flags: FlagState = { master: true, adminMessaging: true, adminPromotions: false, adminEmail: true }) {
  const backend = new FakeNotificationBackend();
  backend.addAdmin(CREATOR, "creator.operator@example.test", ["user_messaging"] as NotificationPermission[]);
  backend.addAdmin(APPROVER, "approver.operator@example.test", ["user_messaging"] as NotificationPermission[]);
  backend.addAdmin(SUPER, "super.operator@example.test", ["user_messaging", "operators"] as NotificationPermission[]);
  const flagState = new Map<string, boolean>();
  const setFlags = (next: FlagState) => {
    for (const [name, key] of Object.entries(NOTIFICATION_FLAGS) as Array<[keyof typeof NOTIFICATION_FLAGS, NotificationFlagKey]>) {
      const value = next[name] ?? false;
      flagState.set(key, value);
      backend.setFlag(key, value);
    }
  };
  setFlags(flags);
  const flagReader: MessagingFlags = async (key) => flagState.get(key) === true;

  const calls: string[] = [];
  const rpcs: MessagingRpcs = {
    createAdminMessage: (a) => (calls.push("createAdminMessage"), backend.createAdminMessage(a)),
    prepareAdminMessage: (a) => (calls.push("prepareAdminMessage"), backend.prepareAdminMessage(a)),
    submitAdminMessage: (a) => (calls.push("submitAdminMessage"), backend.submitAdminMessage(a)),
    approveAdminMessage: (a) => (calls.push("approveAdminMessage"), backend.approveAdminMessage(a)),
    cancelAdminMessage: (a) => (calls.push("cancelAdminMessage"), backend.cancelAdminMessage(a)),
    startAdminMessageSend: (a) => (calls.push("startAdminMessageSend"), backend.startAdminMessageSend(a)),
    recordAdminMessageTest: (a) => (calls.push("recordAdminMessageTest"), backend.recordAdminMessageTest(a)),
    adminMessageAudit: (a) => (calls.push("adminMessageAudit"), backend.adminMessageAudit(a)),
    staleNotificationClaims: (a) => (calls.push("staleNotificationClaims"), backend.staleNotificationClaims(a)),
    resolveStaleClaim: (a) => (calls.push("resolveStaleClaim"), backend.resolveStaleClaim(a)),
    setNotificationSetting: (a) => (calls.push("setNotificationSetting"), backend.setNotificationSetting(a)),
    resumeAdminMessageSend: (a) => (calls.push("resumeAdminMessageSend"), backend.resumeAdminMessageSend(a)),
  };

  const reads: MessagingReads = {
    async listMessages(limit) {
      return [...backend.messages].sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, limit);
    },
    async getMessage(id) {
      return backend.messages.find((m) => m.id === id) ?? null;
    },
    async channelCounts(messageId) {
      const rows = backend.recipients.filter((r) => r.message_id === messageId);
      return {
        inapp: rows.filter((r) => r.to_inapp).length,
        push: rows.filter((r) => r.to_push).length,
        email: rows.filter((r) => r.to_email).length,
        queuedEmail: rows.filter((r) => r.to_email && r.email_outcome === null).length,
      };
    },
    async emailLimits(now) {
      const open = backend.deliveries.filter((d) => d.kind === "admin_message" && d.channel === "email" && d.released_at === null);
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      return {
        cap24h: backend.settings.find((s) => s.key === "mass_email_cap_24h")?.int_value ?? 0,
        ceilingMonth: backend.settings.find((s) => s.key === "mass_email_ceiling_month")?.int_value ?? 0,
        sentLast24h: open.filter((d) => Date.parse(d.claimed_at) > now.getTime() - 24 * 3_600_000).length,
        sentThisMonth: open.filter((d) => Date.parse(d.claimed_at) >= monthStart).length,
      };
    },
  };

  return { backend, rpcs, reads, flagReader, setFlags, calls, defaults: NOTIFICATION_LIMITS };
}

export const COMPOSE: ComposeInput = {
  kind: "service_announcement",
  title: "A change to how you sign in",
  body: "We are moving to a new sign-in page next week.",
  linkPath: "/jobs",
  channels: ["inapp", "email"],
  segmentKey: "everyone",
  segmentParams: {},
  consentLine: null,
};
