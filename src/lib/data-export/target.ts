import "server-only";
import { UUID_PATTERN, type RefusalCode } from "./constants";
import type { Admin } from "./audit";
import type { Client } from "./store";

/**
 * Who an export may be about. The target arrives from one validated form field and nothing else; these are the rules that turn it into a person or a refusal code.
 *
 *   not_a_uuid                      the field is not a uuid. Refused BEFORE any read, and the input is never copied anywhere (an admin could have pasted an email address).
 *   own_account                     the target is the acting admin's own account. Nobody exports themselves; a compromised admin session cannot mass-export its own owner either.
 *   no_such_person                  no profile row (never existed, or already hard-deleted). Refused and audited; nothing is generated.
 *   admin_target_needs_other_admin  the target is itself an admin account and its registered address is the acting admin's own address: the same mailbox, so a different admin must do it.
 *                                   (An admin who is not the acting admin CAN be the target, handled by the acting admin: that is the rule "another admin only by a different admin".)
 *
 * A person inside their 30 days before a scheduled deletion IS allowed: asking to leave does not end the right to a copy.
 */
export interface TargetPerson {
  id: string;
  email: string;
  firstName: string | null;
  pendingDeletion: boolean;
}

export async function checkTarget(service: Client, admin: Admin, targetRaw: string): Promise<{ ok: true; person: TargetPerson } | { ok: false; code: RefusalCode }> {
  if (!UUID_PATTERN.test(targetRaw)) return { ok: false, code: "not_a_uuid" };
  const id = targetRaw.toLowerCase();
  if (id === admin.adminId.toLowerCase()) return { ok: false, code: "own_account" };

  const { data: profile, error } = await service.from("profiles").select("id, email, first_name, deletion_requested_at").eq("id", id).maybeSingle();
  if (error) throw new Error("target check: the profile could not be read");
  if (!profile || !profile.email) return { ok: false, code: "no_such_person" };

  const { data: adminRow, error: adminError } = await service.from("admin_users").select("id").eq("id", id).maybeSingle();
  if (adminError) throw new Error("target check: admin_users could not be read");
  if (adminRow && profile.email.trim().toLowerCase() === admin.email.trim().toLowerCase()) return { ok: false, code: "admin_target_needs_other_admin" };

  return { ok: true, person: { id, email: profile.email.trim(), firstName: profile.first_name, pendingDeletion: profile.deletion_requested_at !== null } };
}
