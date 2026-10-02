/**
 * Start a test from an empty Farah conversation (send-504).
 *
 * Farah's thread is persisted, and since send-504 a thread whose last message is under 24 hours old is RESTORED on load instead of being
 * held behind "Continue". The shared demo account is used by many specs, and several of them send Farah messages; a later spec that logs
 * in as the demo user therefore now meets a restored thread where it used to meet the greeting. Specs whose assertions are about the
 * greeting (the user's name in it) or about an exact message count must clear the thread first, which is what a fresh user would have.
 *
 * Checked, not fired and forgotten: a rejected Supabase delete resolves with an `error` (CLAUDE.md).
 */
import { createGuardedAdmin } from "./guarded-admin";

export async function clearDemoFarahThread(): Promise<void> {
  // A fixture that deletes: the guarded factory refuses production (by URL or by key) before a client or a query exists (send-507).
  const admin = createGuardedAdmin();
  const { data: profile, error: profileError } = await admin.from("profiles").select("id").eq("email", "demo@talentrah.dev").single();
  if (profileError || !profile) throw new Error(`could not find the demo profile: ${profileError?.message}`);
  const { error } = await admin.from("farah_messages").delete().eq("user_id", profile.id);
  if (error) throw new Error(`could not clear the demo user's Farah thread: ${error.message}`);
}
