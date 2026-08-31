"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/require-admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { OperatorActionState } from "./state";

/**
 * Invite a new operator by email.
 *
 * NO PASSWORD IS COLLECTED, SET, OR SEEN — anywhere, by anyone. Supabase's
 * invite creates the account and mails a link; the person follows it and
 * chooses their own password against their own mailbox. A form where one
 * operator types another's initial password would put a real credential in a
 * third party's hands and in whatever they typed it into, and "they'll change
 * it later" is not a control.
 *
 * SUPABASE'S OWN MAILER, not Resend, and that is the established split rather
 * than a preference: Resend carries product email (contact, renewals,
 * fulfilment) while auth email goes through Supabase's templates — see
 * resetPasswordForEmail in src/lib/auth/actions.ts. The redirect is the same
 * /auth/callback that signup confirmation, OAuth and password reset already
 * share, so the invitee lands on /reset-password holding a session and sets a
 * password without ever having had one.
 *
 * THE ADMIN ROW IS WRITTEN BY THE DATABASE, not here. admin_create_operator
 * (0076) re-checks that the actor holds `operators` inside the same statement
 * that inserts, so this is enforced the same way every other operator mutation
 * is rather than being the one that trusts its caller.
 */

const REFUSALS: Record<string, string> = {
  not_authorised: "You need the Operators permission to invite an operator.",
  unknown_role: "Pick a role that still exists.",
  already_admin: "That person is already an operator — change their role from the list instead.",
  email_taken: "An operator already exists with that address.",
};

export async function inviteOperatorAction(
  _prev: OperatorActionState,
  formData: FormData,
): Promise<OperatorActionState> {
  const actor = await requirePermission("operators");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const roleId = String(formData.get("roleId") ?? "");

  if (!email || !email.includes("@")) {
    return { status: "error", message: "Enter a valid email address.", targetId: "invite" };
  }
  if (!roleId) {
    return { status: "error", message: "Pick a role.", targetId: "invite" };
  }

  const supabase = createServiceRoleClient();

  /*
   * The origin is taken from the environment rather than a form field: a
   * redirect target that arrived with the request is a redirect target an
   * attacker can choose, and this one is baked into an email that grants a
   * session.
   */
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (inviteError || !invited?.user) {
    console.error("[admin-invite] invite failed", inviteError);
    /*
     * Supabase's own mailer is rate-limited (observed: 429 "email rate limit
     * exceeded" on the CI project). Said plainly, because the alternative is
     * an operator retrying a form that will keep refusing for reasons the
     * screen does not explain.
     */
    const rateLimited = inviteError?.status === 429;
    return {
      status: "error",
      message: rateLimited
        ? "Too many invitations sent recently — the mail service is rate-limiting us. Try again in a little while."
        : "Could not send that invitation. Check the address and try again.",
      targetId: "invite",
    };
  }

  const { data, error } = await supabase.rpc("admin_create_operator", {
    p_actor: actor.adminId,
    p_user_id: invited.user.id,
    p_email: email,
    p_display_name: displayName,
    p_role_id: roleId,
  });

  if (error) {
    console.error("[admin-invite] admin_create_operator failed", error);
    return { status: "error", message: "Something went wrong on our end.", targetId: "invite" };
  }

  const row = data?.[0];
  if (!row?.ok) {
    /*
     * The auth account now exists but is not an operator. Left in place rather
     * than deleted: the refusals are "already an admin" and "that address is
     * taken", both of which mean an account was already there, and deleting a
     * real person's account because an invite form was used twice would be a
     * far worse outcome than a stray invited-but-not-operator row.
     */
    return {
      status: "error",
      message: REFUSALS[row?.reason ?? ""] ?? "That invitation was refused.",
      targetId: "invite",
    };
  }

  await recordAdminAction({
    identity: actor,
    action: "operator.invited",
    targetTable: "admin_users",
    targetId: invited.user.id,
    // The address is recorded because the trail's whole job is naming who was
    // given access; the invite link and any token are not, and never reach here.
    detail: { email, role_id: roleId },
  });

  revalidatePath("/admin/operators");
  return {
    status: "success",
    message: `Invitation sent to ${email}. They set their own password from the link.`,
    targetId: "invite",
  };
}
