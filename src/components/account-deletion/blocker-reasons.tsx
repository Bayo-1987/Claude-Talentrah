import Link from "next/link";
import { formatDate } from "@/lib/format/datetime";
import type { DeletionBlockers } from "@/lib/account-deletion/types";

/**
 * Why a person cannot delete their account yet, in their words, one reason per thing in the way. Never a bare disabled button: the owner's rule is
 * "show why". Used by the Settings section and by the confirm page when something changed between the email and the click.
 */
export function BlockerReasons({ blockers }: { blockers: DeletionBlockers }) {
  const reasons: React.ReactNode[] = [];

  for (const s of blockers.mentorship_sessions) {
    reasons.push(
      <li key={`s-${s.id}`}>
        You have a paid mentoring session as a {s.role} on {formatDate(s.scheduled_start)}. Complete it, or cancel it so it is refunded, first.
      </li>,
    );
  }
  if (blockers.mentor_payouts.length > 0) {
    reasons.push(
      <li key="payouts">
        A payout to you for a mentoring session has not been paid yet. Your account can be deleted once it has been.
      </li>,
    );
  }
  for (const o of blockers.organisations_with_other_members) {
    reasons.push(
      <li key={`o-${o.id}`}>
        {o.name}: other people belong to this organisation and you own it, so ownership has to be handed over before your account can be deleted.{" "}
        <Link href="/contact" className="text-rust underline">
          Contact us
        </Link>{" "}
        and we will do it with you.
      </li>,
    );
  }

  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-[1.5px] border-rust bg-rust-soft px-4 py-3">
      <p className="font-body text-[14px] font-semibold text-ink">You can&rsquo;t delete your account yet.</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 font-body text-[13.5px] text-ink-soft">{reasons}</ul>
    </div>
  );
}
