"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { buildDeletionConfirmEmail } from "./email";
import { PENDING_DELETION_PATH } from "@/lib/auth/pending-deletion-path";
import {
  DELETION_CONFIRM_PHRASE,
  confirmPhraseMatches,
  generateDeletionToken,
  hashDeletionToken,
  isWellFormedDeletionToken,
} from "./token";
import type { DeletionBlockers } from "./types";
import type { DeletionConfirmState, DeletionRequestState } from "./state";

/**
 * ACCT-1 PR 1 — the Server Actions behind "Delete account". The rules are SQL functions (migration 0212); these do the three things SQL cannot:
 * take the person's id from the verified session, put the raw token in an email, and sign them out everywhere.
 *
 * TWO RULES THAT RUN THROUGH ALL OF IT.
 *
 *   The id sent to the database is ALWAYS the session's. Nothing from the form or the link is ever used to say who is acting. A link opened in
 *   another person's session reaches the database as that other person's id, so it matches no row ("invalid"); the owner's link works only for the
 *   owner. The single-use and expiry rules are enforced in the same SQL statement that acts, under a row lock, not here.
 *
 *   The token is never stored or logged. The database gets its sha256; the raw value exists in the emailed link and in the confirm page's hidden
 *   field, nowhere else, and is not returned in any action state.
 *
 * The service-role client is used for the three functions that take a user id as an argument (they are not callable with a person's own token,
 * by grant). Restore uses the person's OWN client, so `auth.uid()` inside the function, not an argument, decides who is restored.
 */

const FROM = "Talentrah <notifications@talentrah.com>";

function asBlockers(value: unknown): DeletionBlockers | undefined {
  return value && typeof value === "object" ? (value as DeletionBlockers) : undefined;
}

export async function requestAccountDeletionAction(
  _prev: DeletionRequestState,
  formData: FormData,
): Promise<DeletionRequestState> {
  if (!confirmPhraseMatches(formData.get("confirmation"))) {
    return { status: "error", error: `Type "${DELETION_CONFIRM_PHRASE}" exactly to continue.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "Your session has ended. Sign in again, then try once more." };

  const { token, hash } = generateDeletionToken();
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("account_deletion_create_request", { p_user_id: user.id, p_token_hash: hash });
  if (error) {
    console.error("[account-deletion] could not store the request:", error.message);
    return { status: "error", error: "We couldn't start that just now. Try again in a moment." };
  }

  const result = (data ?? {}) as { ok?: boolean; reason?: string; blockers?: unknown };
  if (!result.ok) {
    if (result.reason === "blocked") {
      return { status: "blocked", error: null, blockers: asBlockers(result.blockers) };
    }
    if (result.reason === "already_scheduled") {
      return { status: "error", error: "Deletion is already scheduled for this account." };
    }
    if (result.reason === "rate_limited") {
      return { status: "error", error: "Too many confirmation emails in the last hour. Use the latest one, or try again later." };
    }
    console.error("[account-deletion] request refused:", result.reason);
    return { status: "error", error: "We couldn't start that just now. Try again in a moment." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, first_name, credits_balance")
    .eq("id", user.id)
    .maybeSingle();
  const email = profile?.email?.trim();
  if (!email) return { status: "error", error: "There is no email address on this account to send the confirmation to." };

  const resend = getResendClient();
  if (!resend) {
    console.error("[account-deletion] RESEND_API_KEY is not set: confirmation email not sent");
    return { status: "error", error: "We can't send email right now, so we can't confirm this by email. Try again later." };
  }

  const blockers = asBlockers(result.blockers);
  const message = buildDeletionConfirmEmail({
    firstName: profile?.first_name ?? null,
    confirmUrl: absoluteUrl(`/settings/delete-account/confirm?token=${token}`),
    creditsForfeited: Math.max(profile?.credits_balance ?? 0, 0),
    postingsToClose: blockers?.postings_to_close ?? [],
  });

  const { error: sendError } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  if (sendError) {
    console.error("[account-deletion] confirmation email failed:", sendError.message);
    return { status: "error", error: "We couldn't send the confirmation email. Try again in a moment." };
  }

  return { status: "sent", error: null, sentTo: email };
}

export async function confirmAccountDeletionAction(
  _prev: DeletionConfirmState,
  formData: FormData,
): Promise<DeletionConfirmState> {
  const token = formData.get("token");
  if (!isWellFormedDeletionToken(token)) {
    return { status: "error", reason: "invalid", error: "This link isn't valid. Ask for a new confirmation email from Settings." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", reason: "signed_out", error: "Sign in as the account you want to delete, then open the link again." };
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("account_deletion_confirm", {
    p_user_id: user.id,
    p_token_hash: hashDeletionToken(token),
  });
  if (error) {
    console.error("[account-deletion] confirm failed:", error.message);
    return { status: "error", reason: "failed", error: "We couldn't schedule the deletion just now. You are still signed in; try again in a moment." };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    blockers?: unknown;
    hard_delete_after?: string;
    credits_forfeited?: number;
    closed_postings?: Array<{ id: string; title: string; organization: string }>;
  };

  if (!result.ok) {
    switch (result.reason) {
      case "used":
        return { status: "error", reason: "used", error: "This link has already been used. If you still want to delete your account, ask for a new one from Settings." };
      case "expired":
        return { status: "error", reason: "expired", error: "This link has expired. Links work for one hour; ask for a new one from Settings." };
      case "already_scheduled":
        return { status: "error", reason: "already_scheduled", error: "Deletion is already scheduled for this account." };
      case "blocked":
        return { status: "error", reason: "blocked", error: "Something has changed and your account can't be deleted yet.", blockers: asBlockers(result.blockers) };
      default:
        return { status: "error", reason: "invalid", error: "This link isn't valid. Ask for a new confirmation email from Settings." };
    }
  }

  // Scheduled. Only now, and only then, end every session this person has. A failure here does not undo the deletion (it is already scheduled,
  // and the hiding does not depend on the sessions), so it is logged and the person is told what happened.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) console.error("[account-deletion] scheduled, but global sign-out failed:", signOutError.message);

  return {
    status: "done",
    error: null,
    hardDeleteAfter: result.hard_delete_after,
    creditsForfeited: result.credits_forfeited ?? 0,
    closedPostings: result.closed_postings ?? [],
  };
}

/** The person's own choice, on the prompt: put visibility back. Auto-Apply stays off and Pass renewal stays cancelled. */
export async function restoreAccountAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("account_deletion_restore");
  if (error) {
    console.error("[account-deletion] restore failed:", error.message);
    redirect(`${PENDING_DELETION_PATH}?error=failed`);
  }
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!result.ok) {
    const reason = result.reason === "window_closed" ? "window_closed" : "failed";
    redirect(`${PENDING_DELETION_PATH}?error=${reason}`);
  }

  revalidatePath("/", "layout");
  redirect("/jobs");
}

/** The person's other choice: leave the deletion as scheduled and end this session. Changes nothing in the database. */
export async function keepDeletionAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
