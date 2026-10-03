import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordPendingDeletionFailOpen } from "@/lib/auth/pending-deletion-failopen";
import { DELETION_PENDING_KEY } from "@/lib/auth/pending-deletion-flag";

/**
 * The flag the proxy gate reads: `app_metadata.deletion_pending` on the auth user. The gate gets the user from the `auth.getUser()` call the proxy
 * already makes on every request (a live call to the auth server, so the value is current), which is why it costs no database query.
 * `profiles.deletion_requested_at` stays the source of truth; this is written with it at confirm and cleared with it at restore.
 *
 * `app_metadata`, not `user_metadata`: only the service role can write it, so a person cannot clear their own flag from the browser.
 *
 * A failed write never fails the deletion or the restore (the database flag already decided); it is recorded as FAIL_OPEN so a run of them is visible.
 */
async function write(userId: string, value: true | null, failure: "flag_not_set" | "flag_not_cleared"): Promise<boolean> {
  try {
    const { error } = await createServiceRoleClient().auth.admin.updateUserById(userId, { app_metadata: { [DELETION_PENDING_KEY]: value } });
    if (error) {
      recordPendingDeletionFailOpen(failure, `user=${userId} error=${JSON.stringify(error.message)}`);
      return false;
    }
    return true;
  } catch (err) {
    recordPendingDeletionFailOpen(failure, `user=${userId} error=${JSON.stringify(err instanceof Error ? err.message : String(err))}`);
    return false;
  }
}

export const setDeletionPendingFlag = (userId: string) => write(userId, true, "flag_not_set");
export const clearDeletionPendingFlag = (userId: string) => write(userId, null, "flag_not_cleared");
