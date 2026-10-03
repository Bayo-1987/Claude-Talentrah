"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendDeletionLifecycleEmail } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { buildDeletionConfirmEmail, buildDeletionRestoredEmail, buildDeletionScheduledEmail } from "./email";
import { cancelStoredAuthorizations, type StoredAuthorization } from "./provider-cancel";
import { clearDeletionPendingFlag, setDeletionPendingFlag } from "./session-flag";
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

  const blockers = asBlockers(result.blockers);
  const message = buildDeletionConfirmEmail({
    firstName: profile?.first_name ?? null,
    confirmUrl: absoluteUrl(`/settings/delete-account/confirm?token=${token}`),
    creditsForfeited: Math.max(profile?.credits_balance ?? 0, 0),
    postingsToClose: blockers?.postings_to_close ?? [],
    adWalletBalanceNgn: blockers?.ad_wallet_balance_ngn ?? 0,
  });

  // The confirm link goes through the lifecycle sender: a normal send to an account that is scheduled for deletion is dropped by the mail guard, and
  // this is the deletion's own mail.
  let sendError: { message: string } | null = null;
  try {
    const res = await sendDeletionLifecycleEmail("deletion_confirm", { from: FROM, to: email, subject: message.subject, text: message.text, html: message.html });
    sendError = res.error;
  } catch (err) {
    sendError = { message: err instanceof Error ? err.message : String(err) };
  }
  if (sendError) {
    console.error("[account-deletion] confirmation email failed:", sendError.message);
    if (/RESEND_API_KEY/.test(sendError.message)) {
      return { status: "error", error: "We can't send email right now, so we can't confirm this by email. Try again later." };
    }
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
  const hash = hashDeletionToken(token);

  // 1. PRECHECK. Every refusal the confirm can give, with nothing changed, so a bad, used, replaced or expired link never costs the person a card
  //    cancellation. It also lists the stored card authorisations to cancel. The id is the session's.
  const { data: pre, error: preError } = await admin.rpc("account_deletion_confirm_precheck", { p_user_id: user.id, p_token_hash: hash });
  if (preError) {
    console.error("[account-deletion] precheck failed:", preError.message);
    return { status: "error", reason: "failed", error: "We couldn't schedule the deletion just now. You are still signed in; try again in a moment." };
  }
  const precheck = (pre ?? {}) as { ok?: boolean; reason?: string; blockers?: unknown; authorizations?: StoredAuthorization[] };
  if (!precheck.ok) return refusal(precheck.reason, precheck.blockers);

  // What the emails say about them is read now, while the session is still theirs.
  const { data: profile } = await supabase.from("profiles").select("email, first_name, credits_balance").eq("id", user.id).maybeSingle();

  // 2. THE CARD COMES FIRST. If a stored card cannot be cancelled at the payment provider, nothing is scheduled.
  const cards = await cancelStoredAuthorizations(precheck.authorizations ?? []);
  if (!cards.ok) {
    return {
      status: "error",
      reason: "card",
      error:
        "We couldn't cancel your saved card with our payment provider, so nothing has been scheduled and your account is unchanged. You are still signed in; try again in a moment, and contact us if it keeps happening." +
        (cards.cancelled > 0 ? " Some of your saved cards were already cancelled, so a Pass you had will not renew; you can resubscribe at any time." : ""),
    };
  }

  // 3. CONFIRM, in one database transaction: the link is single-use, one hour, this person only, enforced under a row lock.
  // The card was cancelled BEFORE this transaction, so if the transaction now fails, the person is left with a cancelled card and no deletion, and our
  // renewal cron would fail to charge it and lapse their Pass with no explanation. When at least one card was cancelled and the deletion is NOT
  // scheduled, renewal is switched off in its own small write and the person is told so plainly.
  const unscheduled = async (fallback: DeletionConfirmState): Promise<DeletionConfirmState> => {
    if (cards.cancelled === 0) return fallback;
    const { data: stopped, error: stopError } = await admin.rpc("account_deletion_stop_renewals", { p_user_id: user.id });
    const stoppedOk = !stopError && !!(stopped as { ok?: boolean } | null)?.ok;
    if (!stoppedOk) console.error("[account-deletion] card cancelled, deletion not scheduled, and renewal could NOT be switched off:", stopError?.message ?? "no ok");
    return {
      status: "error",
      reason: "renewal_off",
      error: stoppedOk
        ? "We couldn't schedule the deletion just now, so your account is NOT scheduled for deletion and you are still signed in. Your saved card had already been cancelled with our payment provider, so renewal is now off for your Pass; you can resubscribe at any time. Please try again in a moment."
        : "We couldn't schedule the deletion just now, so your account is NOT scheduled for deletion and you are still signed in. Your saved card had already been cancelled with our payment provider, and we couldn't switch renewal off either, so your Pass may fail to renew. Please contact us and try the deletion again.",
    };
  };

  const { data, error } = await admin.rpc("account_deletion_confirm", { p_user_id: user.id, p_token_hash: hash });
  if (error) {
    console.error("[account-deletion] confirm failed:", error.message);
    return unscheduled({ status: "error", reason: "failed", error: "We couldn't schedule the deletion just now. You are still signed in; try again in a moment." });
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    blockers?: unknown;
    hard_delete_after?: string;
    credits_forfeited?: number;
    closed_postings?: Array<{ id: string; title: string; organization: string }>;
    ad_wallet_balance_ngn?: number;
  };
  if (!result.ok) {
    // "used" and "already_scheduled" mean another click scheduled it, and that confirm already switched renewal off: nothing to undo.
    if (result.reason === "used" || result.reason === "already_scheduled") return refusal(result.reason, result.blockers);
    return unscheduled(refusal(result.reason, result.blockers));
  }

  // The session-side flag the proxy gate reads (no database query per request), written beside the database flag the confirm just set. A failed
  // write is recorded FAIL_OPEN and does not undo the deletion: the database flag already decided, and everyone else's reads are hidden by it.
  await setDeletionPendingFlag(user.id);

  // 4. Scheduled. Only now, and only then, end every session this person has. A failure here does not undo the deletion (it is already scheduled,
  //    and the proxy gate catches every later request from another device), so it is logged and the person is told what happened.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) console.error("[account-deletion] scheduled, but global sign-out failed:", signOutError.message);

  const closedPostings = result.closed_postings ?? [];
  const adWalletBalanceNgn = result.ad_wallet_balance_ngn ?? 0;
  const creditsForfeited = result.credits_forfeited ?? 0;

  // 5. The proof that it worked. A failure here changes nothing about the deletion.
  const to = profile?.email?.trim();
  if (to) {
    try {
      const m = buildDeletionScheduledEmail({
        firstName: profile?.first_name ?? null,
        hardDeleteAfter: result.hard_delete_after,
        creditsForfeited,
        closedPostings,
        adWalletBalanceNgn,
      });
      const res = await sendDeletionLifecycleEmail("deletion_scheduled", { from: FROM, to, subject: m.subject, text: m.text, html: m.html });
      if (res.error) console.error("[account-deletion] 'scheduled' email failed:", res.error.message);
    } catch (err) {
      console.error("[account-deletion] 'scheduled' email failed:", err instanceof Error ? err.message : String(err));
    }
  }

  return { status: "done", error: null, hardDeleteAfter: result.hard_delete_after, creditsForfeited, closedPostings, adWalletBalanceNgn };
}

/** One honest message per reason the database can refuse a confirm for, whichever step it came from. */
function refusal(reason: string | undefined, blockers: unknown): DeletionConfirmState {
  switch (reason) {
    case "used":
      return { status: "error", reason: "used", error: "This link has already been used. If you still want to delete your account, ask for a new one from Settings." };
    case "superseded":
      return { status: "error", reason: "superseded", error: "A newer confirmation email has been sent since this one. Use the latest link, or ask for a new one from Settings." };
    case "expired":
      return { status: "error", reason: "expired", error: "This link has expired. Links work for one hour; ask for a new one from Settings." };
    case "already_scheduled":
      return { status: "error", reason: "already_scheduled", error: "Deletion is already scheduled for this account." };
    case "blocked":
      return { status: "error", reason: "blocked", error: "Something has changed and your account can't be deleted yet.", blockers: asBlockers(blockers) };
    default:
      return { status: "error", reason: "invalid", error: "This link isn't valid. Ask for a new confirmation email from Settings." };
  }
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

  // Clear the session-side flag the proxy gate reads, beside the database flag the restore just cleared. A failed clear is recorded FAIL_OPEN; the prompt
  // page heals a stale flag, so the person is never bounced in a loop.
  await clearDeletionPendingFlag(user.id);

  // The proof that it was undone, and what restoring does not bring back. Best effort: the restore itself already happened.
  try {
    const { data: profile } = await supabase.from("profiles").select("email, first_name, credits_balance").eq("id", user.id).maybeSingle();
    const to = profile?.email?.trim();
    if (to) {
      const m = buildDeletionRestoredEmail({ firstName: profile?.first_name ?? null });
      const res = await sendDeletionLifecycleEmail("deletion_restored", { from: FROM, to, subject: m.subject, text: m.text, html: m.html });
      if (res.error) console.error("[account-deletion] 'restored' email failed:", res.error.message);
    }
  } catch (err) {
    console.error("[account-deletion] 'restored' email failed:", err instanceof Error ? err.message : String(err));
  }

  revalidatePath("/", "layout");
  redirect("/jobs");
}

/** The person's other choice: leave the deletion as scheduled and end this session. Changes nothing in the database. */
export async function keepDeletionAction(): Promise<void> {
  const supabase = await createClient();
  // "Keep the deletion" ends THIS device's session only: nothing else about the account changes, and the other devices are caught by the proxy gate anyway.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
