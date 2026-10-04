import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NO_BLOCKERS, type DeletionBlockers } from "./types";

/**
 * What stands in the way of deleting this person's account, for the Settings section and the confirm page. A display read only: the authority is the
 * same function run again inside the request and the confirm transaction, so a failure here (logged) shows the form and lets the database say no.
 *
 * Service-role, because the function takes the user id as an argument and is not callable with a person's own token. The id comes from the verified
 * session at every call site.
 */
export async function getDeletionBlockers(userId: string): Promise<DeletionBlockers> {
  const { data, error } = await createServiceRoleClient().rpc("account_deletion_blockers", { p_user_id: userId });
  if (error || !data || typeof data !== "object") {
    console.error("[account-deletion] could not read blockers:", error?.message ?? "empty result");
    return NO_BLOCKERS;
  }
  // Every field defaulted, so an older shape of the function (or a partial answer) can never reach a screen as `undefined`.
  return { ...NO_BLOCKERS, ...(data as unknown as Partial<DeletionBlockers>) };
}
