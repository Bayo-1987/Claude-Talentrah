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

/**
 * The demo account's Farah first-visit hint flag (profiles.farah_hint_dismissed_at). The hint is rendered by the SERVER only while this is null (src/components/app-shell/app-shell.tsx), and the dismissal is a fire-and-forget Server
 * Action, so a spec that needs the hint on screen must put the flag back itself and must wait for any dismissal it causes. The shared demo account is used by every spec in a shard, one after another (workers: 1).
 *
 * Checked, not fired and forgotten: a rejected Supabase update resolves with an `error` (CLAUDE.md), and an update that matches no row also "succeeds", so the row count is checked too.
 */
export async function setDemoFarahHintDismissedAt(value: string | null, admin: ReturnType<typeof createGuardedAdmin> = createGuardedAdmin()): Promise<void> {
  const { data, error } = await admin.from("profiles").update({ farah_hint_dismissed_at: value }).eq("email", "demo@talentrah.dev").select("id");
  if (error) throw new Error(`could not set the demo user's Farah hint flag: ${error.message}`);
  if (!data || data.length !== 1) throw new Error(`the demo user's Farah hint flag update touched ${data?.length ?? 0} rows, expected exactly 1`);
}

/** Back to "never seen it", so the hint renders. */
export function resetDemoFarahHint(admin?: ReturnType<typeof createGuardedAdmin>): Promise<void> {
  return setDemoFarahHintDismissedAt(null, admin);
}

export async function demoFarahHintDismissedAt(): Promise<string | null> {
  const admin = createGuardedAdmin();
  const { data, error } = await admin.from("profiles").select("farah_hint_dismissed_at").eq("email", "demo@talentrah.dev").single();
  if (error || !data) throw new Error(`could not read the demo user's Farah hint flag: ${error?.message}`);
  return data.farah_hint_dismissed_at;
}
