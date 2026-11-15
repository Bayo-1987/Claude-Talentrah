import "server-only";
import { isFeatureEnabled } from "@/lib/flags/read";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readsFromClient } from "./reads";
import { messagingRpcsFromClient } from "./rpcs";
import { createMessagingService, type MessagingService } from "./service";

/** The real service: the service-role client through the contract's accessors, the uncached fail-closed flag reader. The page and its Server Actions call this, after `requirePermission`. */
export function getMessagingService(): MessagingService {
  const client = createServiceRoleClient();
  return createMessagingService({ rpcs: messagingRpcsFromClient(client), reads: readsFromClient(client), flags: (key) => isFeatureEnabled(key) });
}

export { MessagingError } from "./errors";
export type { AdminActor } from "./actor";
export type { ComposeInput, MessagingService, Switches } from "./service";
