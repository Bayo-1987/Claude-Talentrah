import Link from "next/link";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { farahAllowanceText, farahChipCostLabel, quickActionMode } from "@/lib/credits/price-labels";
import { panelChipCharge } from "@/lib/credits/farah-message-charge";

/**
 * The line under Farah's greeting about the free-message allowance (0123) — and, once it is used up, what a
 * further message costs (send-493). `null` (count unknown, or an active Pass) renders nothing: silence is
 * correct there; it is only a hard 0 that must not read as broken, and must say the price.
 *
 * Plain body text, no pill/badge/meter, per the Editorial system's rule against gamification.
 *
 * Once the free messages are used up it names when the next one comes back (`nextFreeMessageAt`, an ISO time from the history route or the chat `done` event),
 * in the viewer's own time zone, as a <time> element so a screen reader gets the instant and the sentence reads straight through. No date when the foundation
 * sends null, or the time has passed: see farahAllowanceText. Rendered on the client only (the count arrives after mount), so the zone never differs from the server's.
 */
export function FarahAllowanceNote({
  freeRemaining,
  nextFreeMessageAt,
  now,
  timeZone,
}: {
  freeRemaining: number | null | undefined;
  nextFreeMessageAt?: string | null;
  /** For tests. */
  now?: Date;
  timeZone?: string;
}) {
  const parts = farahAllowanceText({ freeRemaining, nextFreeMessageAt, now, timeZone });
  if (!parts) return null;
  return (
    <p className="text-[12px] text-ink-soft">
      {parts.lead}
      {parts.when && <time dateTime={parts.when.iso}>{parts.when.label}</time>}
      {parts.tail}
    </p>
  );
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
  balance,
  actions = FARAH_QUICK_ACTIONS,
  allowanceLoading = false,
  pending,
  onSend,
  onPrefill,
}: {
  /** The chips to show: today's three by default, or a page's own (page-chips.ts). */
  actions?: ReadonlyArray<{ key: string; label: string; href?: string | null }>;
  /** The credit balance the shell shows, when known; only used for the cost label. */
  balance?: number;
  /** `undefined` = not known yet (see quickActionMode); `null` = known, unrationed (a Pass holder). */
  freeRemaining: number | null | undefined;
  /**
   * The count is still being fetched. The chips are disabled for that moment rather than guessed at: a chip
   * clicked before the count arrived used to SEND, and the message could be a paid one. Disabled (not
   * prefill) so the moment is invisible to anyone using the chips normally and a test's click simply waits
   * for it to end. If the fetch fails the panel stops reporting "loading" and the chips fall back to prefill.
   */
  allowanceLoading?: boolean;
  pending: boolean;
  onSend: (actionKey: string) => void;
  onPrefill: (actionKey: string) => void;
}) {
  const mode = quickActionMode(freeRemaining);
  // The cost label every chip shows BEFORE the click comes from the one function the gate also uses (farah-message-charge.ts); nothing else supplies chip cost text.
  const cost = farahChipCostLabel(panelChipCharge(freeRemaining, balance));
  return (
    <div className="flex flex-col border-t border-dashed border-line pt-4">
      {actions.map((action) =>
        action.href ? (
          <Link
            key={action.key}
            href={action.href}
            className="flex min-h-11 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
          >
            {action.label}
          </Link>
        ) : (
          <div key={action.key} className="flex min-h-11 items-center justify-between gap-3">
            <button
              type="button"
              disabled={pending || allowanceLoading}
              aria-describedby={cost ? `farah-chip-cost-${action.key}` : undefined}
              onClick={() => (mode === "send" ? onSend(action.key) : onPrefill(action.key))}
              className="flex min-h-11 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:opacity-50"
            >
              {action.label}
            </button>
            {cost && (
              <span id={`farah-chip-cost-${action.key}`} className="flex-shrink-0 font-body text-[12px] text-ink-soft">
                {cost}
              </span>
            )}
          </div>
        ),
      )}
    </div>
  );
}
