import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { PENDING_DELETION_PATH } from "@/lib/auth/pending-deletion-path";
import { getDeletionBlockers } from "@/lib/account-deletion/queries";
import { isWellFormedDeletionToken } from "@/lib/account-deletion/token";
import { ConfirmDeletionPanel } from "@/components/account-deletion/confirm-deletion-panel";
import { BlockerReasons } from "@/components/account-deletion/blocker-reasons";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Confirm account deletion — Talentrah", robots: { index: false, follow: false } };

/**
 * Where the emailed link lands (ACCT-1 PR 1). Needs the signed-in session of the person the link was issued to: signed out, the sign-in page brings
 * them back here with the link intact; signed in as somebody else, the confirm reaches the database under THEIR id and matches nothing.
 *
 * Opening the link changes nothing. The deletion is one explicit click on this page (mail scanners and previews open links).
 */
export default async function ConfirmAccountDeletionPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { user, profile } = await requireUser({ allowPendingDeletion: true });
  const { token } = await searchParams;

  if (profile.deletion_requested_at) {
    return (
      <Shell>
        <p className="font-body text-[15px] text-ink">Deletion is already scheduled for this account.</p>
        <Link href={PENDING_DELETION_PATH} className="font-body text-[14px] text-rust underline">
          Restore it, or keep the deletion
        </Link>
      </Shell>
    );
  }

  if (!isWellFormedDeletionToken(token)) {
    return (
      <Shell>
        <p className="font-body text-[15px] text-ink">This link isn&rsquo;t valid.</p>
        <Link href="/settings" className="font-body text-[14px] text-rust underline">
          Ask for a new confirmation email from Settings
        </Link>
      </Shell>
    );
  }

  const blockers = await getDeletionBlockers(user.id);
  if (blockers.blocked) {
    return (
      <Shell>
        <BlockerReasons blockers={blockers} />
      </Shell>
    );
  }

  return (
    <Shell>
      <ConfirmDeletionPanel token={token} creditsBalance={Math.max(profile.credits_balance, 0)} postingsToClose={blockers.postings_to_close} adWalletBalanceNgn={blockers.ad_wallet_balance_ngn} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Delete account</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Confirm deleting your account</h1>
      </div>
      {children}
    </div>
  );
}
