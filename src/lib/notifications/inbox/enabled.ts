import "server-only";
import { cache } from "react";
import { isFeatureEnabled } from "@/lib/flags/read";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";

/**
 * Is the notifications inbox switched on (notifications_master)? The existing server flag reader, wrapped in React cache() so that ONE render reads the flag table ONCE however many places ask (the shell and
 * anything under it share the answer), exactly the device getActivePass uses. It is per request, not per process: a flag thrown off takes effect on the next page load. Fails closed: the reader already answers
 * false for a missing row or a read error, and a throw is treated the same way, so a broken flag read can never break the layout or turn the bell on.
 */
export const inboxEnabled = cache(async function inboxEnabled(): Promise<boolean> {
  try {
    return await isFeatureEnabled(NOTIFICATION_FLAGS.master);
  } catch {
    return false;
  }
});
