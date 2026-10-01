import Link from "next/link";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { farahAllowanceLine, quickActionMode } from "@/lib/credits/price-labels";

/**
 * The line under Farah's greeting about the free-message allowance (0123) — and, once it is used up, what a
 * further message costs (send-493). `null` (count unknown, or an active Pass) renders nothing: silence is
 * correct there; it is only a hard 0 that must not read as broken, and must say the price.
 *
 * Plain body text, no pill/badge/meter, per the Editorial system's rule against gamification.
 */
export function FarahAllowanceNote({ freeRemaining }: { freeRemaining: number | null }) {
  if (freeRemaining === null) return null;
  return <p className="text-[12px] text-ink-soft">{farahAllowanceLine(freeRemaining)}</p>;
}

/**
 * The three quick-action chips (Job Interview Prep / Career Advisor / Salary Negotiation).
 *
 * A chip used to send a message the moment it was clicked. Once the 3 free messages are used that message is a
 * paid one, and a charge must never follow a click that did not say so — so `quickActionMode` decides: while the
 * message is free (or the count is unknown, a Pass holder) the chip sends, as before; once it would cost
 * credits the chip PREFILLS the input instead and the user presses Send themselves, with the price stated on
 * the line above (FarahAllowanceNote).
 *
 * Presentational on purpose (no state, no fetch): the panel owns sending and the input, so this is renderable
 * in a unit test and the send/prefill decision lives in one tested function, not in a click handler.
 */
export function FarahQuickActions({
  freeRemaining,
  pending,
  onSend,
  onPrefill,
}: {
  freeRemaining: number | null;
  pending: boolean;
  onSend: (actionKey: string) => void;
  onPrefill: (actionKey: string) => void;
}) {
  const mode = quickActionMode(freeRemaining);
  return (
    <div className="flex flex-col border-t border-dashed border-line pt-4">
      {FARAH_QUICK_ACTIONS.map((action) =>
        action.href ? (
          <Link
            key={action.key}
            href={action.href}
            className="flex min-h-11 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
          >
            {action.label}
          </Link>
        ) : (
          <button
            key={action.key}
            type="button"
            disabled={pending}
            onClick={() => (mode === "send" ? onSend(action.key) : onPrefill(action.key))}
            className="flex min-h-11 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action.label}
          </button>
        ),
      )}
    </div>
  );
}
