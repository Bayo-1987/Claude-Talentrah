import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isFeatureEnabled } from "@/lib/flags/read";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { inboxEnabled } from "@/lib/notifications/inbox/enabled";
import { NOTIFICATION_PREFERENCE_COLUMNS, type NotificationPreferenceColumn } from "@/components/settings/notification-preferences-model";
import type { PreferenceDeps } from "./notification-preferences-core";

/** The real dependencies of the notification preferences: the session, the master flag through inboxEnabled() and the service role on the person's own `email_preferences` row. */
export function realPreferenceDeps(): PreferenceDeps {
  return {
    async sessionUserId() {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    // The master flag is read exactly as the bell reads it (per request, fails closed); the push sender key has its own read.
    flagOn: (key) => (key === "notifications_master" ? inboxEnabled() : isFeatureEnabled(NOTIFICATION_FLAGS.pushSender)),
    async read(userId) {
      const { data } = await createServiceRoleClient().from("email_preferences").select(NOTIFICATION_PREFERENCE_COLUMNS.join(",")).eq("user_id", userId).maybeSingle();
      return (data as unknown as Record<string, unknown> | null) ?? null;
    },
    async write(userId, column, value) {
      const { data, error } = await createServiceRoleClient().from("email_preferences").update({ [column]: value } as Record<NotificationPreferenceColumn, boolean>).eq("user_id", userId).select("user_id");
      if (error || !data || data.length === 0) {
        console.error("[notification-preferences] could not save a setting:", error?.message ?? "no preference row");
        return false;
      }
      return true;
    },
  };
}
