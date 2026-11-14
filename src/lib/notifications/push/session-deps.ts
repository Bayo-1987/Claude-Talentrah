import { isFeatureEnabled } from "@/lib/flags/read";
import { createClient } from "@/lib/supabase/server";
import { notificationErrorFrom, pushSubscriptionsTable, registerPushSubscription } from "../contract-db";
import type { PushSubscriptionClientRow } from "../contract";
import type { PushRouteDeps } from "./routes";

/**
 * The routes' real bindings. Every database call goes through the signed-in person's OWN client (never the service role): the register function identifies the caller by the session, and the table
 * grants let a person read five columns of their own devices and delete them by id, nothing more.
 */
export function realRouteDeps(): PushRouteDeps {
  return {
    // The live environment object, read at call time: the kill switch takes effect without a deploy of this code.
    env: {
      get PWA_KILL() {
        return process.env.PWA_KILL;
      },
    },
    flagOn: isFeatureEnabled,
    session: async () => {
      const client = await createClient();
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return null;
      return {
        register: (args) => registerPushSubscription(client, args),
        listDevices: async () => {
          const { data: rows, error: readError } = await pushSubscriptionsTable(client)
            .select("id, ua_short, created_at, last_seen_at, revoked_at")
            .order("created_at", { ascending: false });
          if (readError) throw notificationErrorFrom(readError, { table: "pushSubscriptions" });
          return (rows ?? []) as PushSubscriptionClientRow[];
        },
        removeDevice: async (id) => {
          const { error: deleteError } = await pushSubscriptionsTable(client).delete().eq("id", id);
          if (deleteError) throw notificationErrorFrom(deleteError, { table: "pushSubscriptions" });
        },
      };
    },
  };
}
