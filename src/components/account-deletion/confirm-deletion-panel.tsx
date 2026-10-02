"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmAccountDeletionAction } from "@/lib/account-deletion/actions";
import { initialConfirmState } from "@/lib/account-deletion/state";
import { creditsPhrase } from "@/lib/account-deletion/copy";
import { RESTORE_WINDOW_DAYS } from "@/lib/account-deletion/token";
import { formatDate } from "@/lib/format/datetime";
import { Button } from "@/components/ui";
import { BlockerReasons } from "./blocker-reasons";
import { ClosingPostingsList } from "./closing-postings-list";

/**
 * The page the emailed link opens (ACCT-1 PR 1). Opening the link does nothing by itself: mail scanners and link previews open links, so the
 * deletion happens on one explicit click here, in the signed-in session the link needs. The token rides in a hidden field; the person's id is never
 * sent, the action takes it from the session.
 */
export function ConfirmDeletionPanel({
  token,
  creditsBalance,
  postingsToClose,
}: {
  token: string;
  creditsBalance: number;
  postingsToClose: Array<{ id: string; title: string; organization: string }>;
}) {
  const [state, formAction, pending] = useActionState(confirmAccountDeletionAction, initialConfirmState);

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-4">
        <p className="border-[1.5px] border-green px-3.5 py-2.5 font-body text-[14px] text-green">
          Your account is scheduled for deletion on {formatDate(state.hardDeleteAfter)}. You&rsquo;ve been signed out everywhere.
        </p>
        {state.closedPostings && state.closedPostings.length > 0 && (
          <div className="font-body text-[13.5px] text-ink-soft">
            Closed: {state.closedPostings.map((p) => p.title).join(", ")}.
          </div>
        )}
        <p className="font-body text-[14px] text-ink-soft">
          If you change your mind, sign in before then and choose to restore it.
        </p>
        <Link href="/" className="font-body text-[14px] text-rust underline">
          Back to the home page
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex max-w-[520px] flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 font-body text-[13.5px] text-rust">{state.error}</p>
      )}
      {state.blockers && <BlockerReasons blockers={state.blockers} />}

      <div className="flex flex-col gap-2 font-body text-[14px] text-ink-soft">
        <p>When you confirm:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>you are signed out everywhere;</li>
          <li>your profile disappears from employers and the Talent Directory;</li>
          <li>Auto-Apply stops, any Pass stops renewing, and we stop emailing you;</li>
          <li>your personal data is deleted after {RESTORE_WINDOW_DAYS} days, unless you sign in and restore it first.</li>
        </ul>
      </div>
      {creditsBalance > 0 && (
        <p className="font-body text-[14px] text-ink">You have {creditsPhrase(creditsBalance)}. Unused credits are forfeited when your account is deleted.</p>
      )}
      <ClosingPostingsList postings={postingsToClose} />

      <p className="font-body text-[13px] text-ink-soft">
        You will be signed out everywhere as soon as you confirm.
      </p>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Deleting…" : "Delete my account"}
      </Button>
    </form>
  );
}
