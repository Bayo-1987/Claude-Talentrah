import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/lib/supabase/types";

/**
 * The actor for a change made OUTSIDE the running app.
 *
 * ── WHY A SENTINEL AND NOT A REAL ADMIN'S ID ──────────────────────────────
 *
 * Some changes genuinely happen outside `/admin/*`: a migration applied by a
 * coding session at the founder's explicit direction, a role edited through the
 * Supabase connector because the person who wanted it was not the person at the
 * keyboard. `recordAdminAction` cannot describe those honestly — it needs an
 * admin identity, and the only identities available belong to people who did
 * not perform the action. Stamping one of them would put a name in the trail
 * that is simply false, and a wrong name is worse than a null: it reads as
 * attribution and cannot be told apart from the real thing.
 *
 * So the trail records what actually happened — a change made by tooling, on
 * instruction — and says so in a way that can never be mistaken for a person.
 *
 * ── THE ADDRESS ───────────────────────────────────────────────────────────
 *
 * `.internal` is reserved by ICANN for private use and can never be registered,
 * so this string cannot become a deliverable mailbox and therefore cannot
 * collide with a real operator's address — the collision is impossible by
 * construction rather than unlikely by convention. The local part says what it
 * is on sight, in a column a person reads while asking "who did this".
 */
export const SYSTEM_TOOLING_ACTOR = "system-tooling@talentrah.internal";

/**
 * Writes what an operator did, and as whom.
 *
 * This is the thing the three existing moderation routes could not do. Each of
 * them records `reviewed_by = null` with a comment explaining that a shared
 * secret proves "an operator" and never "which operator", and that recording a
 * caller-supplied id would be worse than a null because a wrong name looks
 * like attribution. With a real session there is a right name, and M2 wires
 * those columns to it.
 *
 * M1 writes only login and logout. That is deliberately not a placeholder:
 * "which admin was signed in, from where, and when" is the record that makes
 * every later attributed action believable.
 *
 * NEVER THROWS. An audit write that fails must not roll back the action it was
 * describing — an admin locked out because the log is unavailable is a worse
 * outcome than a gap in the log, and the gap is visible. Failures go to the
 * server log.
 */
export async function recordAdminAction(input: {
  /*
   * `adminId` is widened to allow null, matching the column, which has always
   * been nullable — the FK is ON DELETE SET NULL so the trail outlives the
   * account. Only `recordSystemAction` passes null, and it passes an email that
   * says why. No existing caller changes.
   */
  identity: { adminId: string | null; email: string; sessionId?: string | null };
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: { [key: string]: Json } | null;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("admin_audit_log").insert({
      admin_user_id: input.identity.adminId,
      // Snapshotted, not joined for. The FK is ON DELETE SET NULL so the trail
      // survives the account; without the email it would survive as an
      // anonymous row, which is not a trail.
      admin_email: input.identity.email,
      admin_session_id: input.identity.sessionId ?? null,
      action: input.action,
      target_table: input.targetTable ?? null,
      target_id: input.targetId ?? null,
      detail: input.detail ?? null,
    });
    if (error) console.error("[admin-audit] write failed", input.action, error);
  } catch (err) {
    console.error("[admin-audit] write threw", input.action, err);
  }
}

/**
 * A failed sign-in by an address that belongs to a real admin. Logged
 * separately because it is the only one of the two that is worth an alert
 * later.
 *
 * Failures by addresses that are NOT admins are deliberately not recorded at
 * all. Storing every string a stranger types into an admin login form builds a
 * small pile of other people's email addresses in exchange for no signal.
 */
export async function recordFailedAdminLogin(adminId: string, email: string): Promise<void> {
  await recordAdminAction({
    identity: { adminId, email, sessionId: null },
    action: "admin.login_failed",
  });
}

/**
 * Record a change made outside the app, by explicit founder direction.
 *
 * ── WHEN THIS IS THE RIGHT FUNCTION, AND WHEN IT IS ABUSE ─────────────────
 *
 * RIGHT: a migration applied through the Supabase connector, a role created by
 * direct SQL because the founder asked for it and no operator performed it —
 * anything where there is genuinely no admin session, and inventing one would
 * be a lie.
 *
 * ABUSE: anything a real admin session did through `/admin/*`. Those keep
 * using `recordAdminAction` with that admin's own identity. Reaching for this
 * one because an identity was awkward to thread through a call stack would
 * turn every attributed action into a maybe — the trail's entire value is that
 * a name in it means that person, and one lazy call site is enough to end
 * that. If you are tempted, the identity is the thing to fix.
 *
 * `admin_user_id` and `admin_session_id` are null because there is no account
 * and no session — the same nulls the moderation routes used to write, except
 * here the email says why rather than leaving an anonymous row.
 *
 * NEVER THROWS, for the same reason as `recordAdminAction`.
 */
export async function recordSystemAction(input: {
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: { [key: string]: Json } | null;
}): Promise<void> {
  await recordAdminAction({
    identity: { adminId: null, email: SYSTEM_TOOLING_ACTOR, sessionId: null },
    action: input.action,
    targetTable: input.targetTable,
    targetId: input.targetId,
    detail: input.detail,
  });
}
