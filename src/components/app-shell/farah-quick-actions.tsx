"use client";

import { useState } from "react";
import Link from "next/link";
import { FARAH_QUICK_ACTIONS } from "@/lib/farah/quick-actions";
import { farahAllowanceText, quickActionMode } from "@/lib/credits/price-labels";

/** The id of the allowance line below, which every chip points at (aria-describedby) so the price is still announced now that the chips carry no cost line of their own. */
export const FARAH_ALLOWANCE_NOTE_ID = "farah-allowance-note";
/** Before a chat starts at most this many chips are listed; the rest are behind a "More questions" row. */
export const MAX_CHIPS_BEFORE_MORE = 3;

/**
 * The line under Farah's greeting about the free-message allowance (0123) — and, once it is used up, what each
 * message costs (send-493): "Each message costs N credits.", or with a dated next free message "… Until then, each message costs N credits." `null` (count unknown, or an active Pass) renders nothing: silence is
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
    <p id={FARAH_ALLOWANCE_NOTE_ID} className="text-[12px] text-ink-soft">
      {parts.lead}
      {parts.when && <time dateTime={parts.when.iso}>{parts.when.label}</time>}
      {parts.tail}
    </p>
  );
}

const CHIP_CLASS =
  "flex min-h-11 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:opacity-50";
const TOGGLE_CLASS =
  "flex min-h-11 items-center py-1 text-left font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust";
const LIST_ID = "farah-chip-list";

/** A row that opens or closes the chips: a real button (44 px), with its state in aria-expanded and a small caret that only repeats it. */
function Toggle({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={LIST_ID} onClick={onClick} className={TOGGLE_CLASS}>
      {label}
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className={`ml-2 shrink-0 ${open ? "rotate-180" : ""}`}>
        <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

/**
 * The quick-action chips (a page's own, or Job Interview Prep / Career Advisor / Salary Negotiation).
 *
 * LAYOUT (option E, owner 7 Oct 2026): the chips are STARTERS. Before a chat starts, at most MAX_CHIPS_BEFORE_MORE are listed and the rest sit behind a
 * "More questions" row. Once a chat has started (`collapsed`), they collapse to ONE row (`collapsedLabel`) that opens them, because in a conversation they are
 * the least useful thing in a 224 px column and used to cost 220-300 px of the room the messages need. Choosing a chip from the opened list sends it and closes
 * the list again. The chips carry no cost line of their own: the allowance line above states the price once, and each chip points at it (aria-describedby).
 *
 * A chip used to send a message the moment it was clicked. Once the 3 free messages are used that message is a
 * paid one, and a charge must never follow a click that did not say so — so `quickActionMode` decides: while the
 * message is free (or the count is unknown, a Pass holder) the chip sends, as before; once it would cost
 * credits the chip PREFILLS the input instead and the user presses Send themselves, with the price stated on
 * the line above (FarahAllowanceNote).
 *
 * The panel owns sending and the input; this holds only whether the list is open, so the send/prefill decision lives in one tested function, not in a click handler.
 */
export function FarahQuickActions({
  freeRemaining,
  actions = FARAH_QUICK_ACTIONS,
  allowanceLoading = false,
  pending,
  collapsed = false,
  collapsedLabel = "Quick questions",
  onSend,
  onPrefill,
}: {
  /** The chips to show: today's three by default, or a page's own (page-chips.ts). */
  actions?: ReadonlyArray<{ key: string; label: string; href?: string | null }>;
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
  /** A chat has started: show one row that opens the chips instead of the chips. */
  collapsed?: boolean;
  /** The label of that row ("Ask about this page" on a page's own chips). */
  collapsedLabel?: string;
  onSend: (actionKey: string) => void;
  onPrefill: (actionKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // When a chat starts the list starts closed (adjusting state while rendering, not in an effect: no frame with a stale open list).
  const [wasCollapsed, setWasCollapsed] = useState(collapsed);
  if (wasCollapsed !== collapsed) {
    setWasCollapsed(collapsed);
    setOpen(false);
  }

  const mode = quickActionMode(freeRemaining);
  const noteShown = farahAllowanceText({ freeRemaining }) !== null;
  const visible = collapsed ? (open ? actions : []) : open ? actions : actions.slice(0, MAX_CHIPS_BEFORE_MORE);
  const hasMore = !collapsed && actions.length > MAX_CHIPS_BEFORE_MORE;
  const choose = (key: string) => {
    if (mode === "send") onSend(key);
    else onPrefill(key);
    if (collapsed) setOpen(false);
  };

  return (
    <div className="flex flex-col border-t border-dashed border-line pt-4">
      {collapsed && <Toggle label={collapsedLabel} open={open} onClick={() => setOpen(!open)} />}
      {visible.length > 0 && (
        <div id={LIST_ID} className="flex flex-col">
          {visible.map((action) =>
            action.href ? (
              <Link key={action.key} href={action.href} className="flex min-h-11 items-center py-1 font-body text-[13.5px] font-semibold text-ink underline underline-offset-2 hover:text-rust">
                {action.label}
              </Link>
            ) : (
              <button
                key={action.key}
                type="button"
                disabled={pending || allowanceLoading}
                aria-describedby={noteShown ? FARAH_ALLOWANCE_NOTE_ID : undefined}
                onClick={() => choose(action.key)}
                className={CHIP_CLASS}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
      {hasMore && <Toggle label={open ? "Fewer questions" : "More questions"} open={open} onClick={() => setOpen(!open)} />}
    </div>
  );
}
