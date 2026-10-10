"use client";

import { useActionState } from "react";
import { requestAccountDeletionAction } from "@/lib/account-deletion/actions";
import { initialRequestState } from "@/lib/account-deletion/state";
import { creditsPhrase } from "@/lib/account-deletion/copy";
import { DELETION_CONFIRM_PHRASE, DELETION_LINK_TTL_MINUTES, RESTORE_WINDOW_DAYS } from "@/lib/account-deletion/token";
import type { DeletionBlockers } from "@/lib/account-deletion/types";
import { Button, EyebrowLabel, TextField } from "@/components/ui";
import { inputValue } from "@/lib/forms/keep-input";
import { BlockerReasons } from "./blocker-reasons";
import { ClosingPostingsList } from "./closing-postings-list";
import { AdWalletNotice } from "./ad-wallet-notice";

/**
 * Settings → Delete account (ACCT-1 PR 1).
 *
 * Asks for the typed phrase, then emails a single-use confirm link: not a password prompt, because people who signed in with Google have no
 * password. Everything the person needs to decide is on this screen before they ask: what happens at once, the 30 days, the credits that are
 * forfeited (with the number), and, if they are the only member of an organisation, the postings that will be closed, by title. If something in
 * their account stands in the way, the reasons are shown instead of the form.
 */
export function DeleteAccountSection({ creditsBalance, blockers }: { creditsBalance: number; blockers: DeletionBlockers }) {
  const [state, formAction, pending] = useActionState(requestAccountDeletionAction, initialRequestState);
  const shownBlockers = state.status === "blocked" && state.blockers ? state.blockers : blockers;

  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6" aria-labelledby="delete-account-heading">
      <EyebrowLabel size="sm" id="delete-account-heading">
        Delete account
      </EyebrowLabel>

      {shownBlockers.blocked ? (
        <BlockerReasons blockers={shownBlockers} />
      ) : state.status === "sent" ? (
        <p className="border-[1.5px] border-green px-3.5 py-2.5 font-body text-[13.5px] text-green">
          We&rsquo;ve emailed a confirmation link to {state.sentTo}. It works once and expires in {DELETION_LINK_TTL_MINUTES === 60 ? "1 hour" : `${DELETION_LINK_TTL_MINUTES} minutes`}. Nothing
          changes until you open it.
        </p>
      ) : (
        <>
          <p className="font-body text-[14px] text-ink-soft">
            Deleting your account hides your profile from employers and the Talent Directory straight away, stops Auto-Apply and Pass renewal, signs you out
            everywhere, and stops our emails. Your personal data is deleted after {RESTORE_WINDOW_DAYS} days. Sign in again before then and you can restore the account.
          </p>
          {creditsBalance > 0 && (
            <p className="font-body text-[14px] text-ink">
              You have {creditsPhrase(creditsBalance)}. Unused credits are forfeited when your account is deleted.
            </p>
          )}
          <ClosingPostingsList postings={shownBlockers.postings_to_close} />
          <AdWalletNotice balanceNgn={shownBlockers.ad_wallet_balance_ngn} />

          <form action={formAction} className="flex max-w-[420px] flex-col gap-4">
            {state.error && (
              <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">{state.error}</p>
            )}
            <TextField
              label={`Type "${DELETION_CONFIRM_PHRASE}" to confirm`}
              name="confirmation"
              autoComplete="off"
              defaultValue={inputValue(state.values, "confirmation")}
              required
            />
            <Button type="submit" variant="secondary" disabled={pending} className="self-start">
              {pending ? "Sending…" : "Email me a confirmation link"}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
