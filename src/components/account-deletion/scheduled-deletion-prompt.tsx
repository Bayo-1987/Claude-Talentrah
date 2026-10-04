import { keepDeletionAction, restoreAccountAction } from "@/lib/account-deletion/actions";
import { RESTORE_LIMITS, creditsPhrase } from "@/lib/account-deletion/copy";
import { formatDate } from "@/lib/format/datetime";
import { Button } from "@/components/ui";

/**
 * What a person sees on signing in while their account is scheduled for deletion (ACCT-1 PR 1). It asks; it never restores silently, because
 * someone may sign in only to look, or to download their data. Restoring is one click; keeping the deletion signs them out and changes nothing.
 */
export function ScheduledDeletionPrompt({
  hardDeleteAfter,
  creditsForfeited,
  error,
}: {
  hardDeleteAfter: string | null;
  creditsForfeited: number;
  error: string | null;
}) {
  const windowClosed = error === "window_closed";
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <h1 className="text-[30px] leading-[1.2]">
        Your account is scheduled for deletion{hardDeleteAfter ? ` on ${formatDate(hardDeleteAfter)}` : ""}.
      </h1>

      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 font-body text-[13.5px] text-rust">
          {windowClosed
            ? "The restore window has closed: this account can no longer be restored."
            : "We couldn't restore your account just now. Try again in a moment."}
        </p>
      )}

      {!windowClosed && (
        <>
          <p className="font-body text-[16px] text-ink">Restore it, or keep the deletion?</p>
          <div className="flex flex-col gap-2 font-body text-[14px] text-ink-soft">
            <p>
              Restoring puts your profile back where employers and the Talent Directory can see it, and your account back as it was. {RESTORE_LIMITS}
            </p>
            {creditsForfeited > 0 && <p>You have {creditsPhrase(creditsForfeited)}, which are forfeited if the deletion goes ahead.</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <form action={restoreAccountAction}>
              <Button type="submit" variant="primary">
                Restore my account
              </Button>
            </form>
            <form action={keepDeletionAction}>
              <Button type="submit" variant="secondary">
                Keep the deletion
              </Button>
            </form>
          </div>
        </>
      )}
      {windowClosed && (
        <form action={keepDeletionAction}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      )}
    </div>
  );
}
