import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { pushSubscriptionsTable } from "../contract-db";
import type { NotificationClient } from "../contract-db";
import type { UnsubscribeDeps } from "./unsubscribe-route";

/**
 * The delete behind POST /api/push/unsubscribe. This is the one push path that uses the service-role client, and only for this: the person comes from the verified session and the delete is
 * filtered by BOTH that user and the endpoint, so it can never remove another person's row.
 */
export async function removeByEndpointWith(client: NotificationClient, userId: string, endpoint: string): Promise<void> {
  const { error } = await pushSubscriptionsTable(client).delete().eq("user_id", userId).eq("endpoint", endpoint);
  if (error) throw new Error("subscription delete failed");
}

export function realUnsubscribeDeps(): UnsubscribeDeps {
  return {
    session: async () => {
      const client = await createClient();
      const { data, error } = await client.auth.getUser();
      return error || !data.user ? null : { userId: data.user.id };
    },
    removeByEndpoint: (userId, endpoint) => removeByEndpointWith(createServiceRoleClient(), userId, endpoint),
  };
}
