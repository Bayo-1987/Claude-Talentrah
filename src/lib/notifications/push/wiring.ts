import { isFeatureEnabled } from "@/lib/flags/read";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { claimNotification, markNotificationSent, notificationErrorFrom, pushSubscriptionsTable, releaseNotification } from "../contract-db";
import type { PushSender, PushTarget } from "../contract";
import { deliverPush, type DeliverDeps, type DeliverRequest, type DeliverSummary } from "./deliver";
import { consolePushLog, createPushSender } from "./sender";
import { createWebPushTransport } from "./web-push-transport";
import { readVapidConfig } from "./vapid";

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The real sender. The key pair is checked the first time something is actually about to be sent, not when this module loads: with the flags off, a page load or a deploy must read no secret and
 * change nothing. A pair that is missing or does not match sends nothing and releases the claim as a failure before sending.
 */
export function createRealPushSender(env: Record<string, string | undefined> = process.env): PushSender {
  let inner: PushSender | null = null;
  return {
    async send(target, payload) {
      if (!inner) {
        try {
          inner = createPushSender({ transport: createWebPushTransport(readVapidConfig(env)), sleep: realSleep, log: consolePushLog });
        } catch {
          consolePushLog({ event: "push_config_invalid" });
          return { outcome: "pre_send_failure" };
        }
      }
      return inner.send(target, payload);
    },
  };
}

/** The sender's database side, all through the service role and the accessors. */
export function createDeliverDeps(env: Record<string, string | undefined> = process.env): DeliverDeps {
  const service = createServiceRoleClient();
  return {
    env,
    flagOn: isFeatureEnabled,
    isDeleting: async (userId) => {
      const { data, error } = await service.from("profiles").select("deletion_requested_at").eq("id", userId).maybeSingle();
      if (error) throw new Error("push: the person could not be read");
      // No profile row is no one to send to.
      return !data || data.deletion_requested_at !== null;
    },
    loadTargets: async (userId) => {
      const { data, error } = await pushSubscriptionsTable(service).select("id, endpoint, p256dh, auth").eq("user_id", userId).is("revoked_at", null);
      if (error) throw notificationErrorFrom(error, { table: "pushSubscriptions" });
      return (data ?? []).map((row): PushTarget => ({ deviceId: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
    },
    claim: (args) => claimNotification(service, args),
    release: (args) => releaseNotification(service, args),
    markSent: (args) => markNotificationSent(service, args),
    revokeDevice: async (deviceId, reason) => {
      const { error } = await pushSubscriptionsTable(service).update({ revoked_at: new Date().toISOString(), revoke_reason: reason }).eq("id", deviceId).is("revoked_at", null);
      if (error) throw notificationErrorFrom(error, { table: "pushSubscriptions" });
    },
    sender: createRealPushSender(env),
    log: consolePushLog,
  };
}

/** One call for the code that raises a notification: sends the alert to every active device of one person, subject to the kill switch, the flags and the claim. */
export function deliverPushForUser(request: DeliverRequest): Promise<DeliverSummary> {
  return deliverPush(createDeliverDeps(), request);
}
