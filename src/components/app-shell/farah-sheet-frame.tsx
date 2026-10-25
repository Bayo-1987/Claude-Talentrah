import type { ReactNode, Ref } from "react";

/**
 * The frame that turns the ALREADY-MOUNTED Farah panel into a bottom sheet below 760px, and leaves the docked column alone from 760px up.
 *
 * ── THE PANEL IS RE-PRESENTED, NEVER REBUILT ────────────────────────────────
 *
 * app-shell.tsx explains why the panel must stay mounted: it holds the conversation, the history fetch, the free-message count and the job-seed listener, and a conditional render would
 * throw all of that away on every rotation. So `children` is rendered in BOTH states. Closed, the sheet is `invisible` below 760px (visibility: hidden removes it from the tab order and from
 * assistive technology, with no `aria-hidden`, which would also hide the docked panel from a desktop screen reader). Open, it is a modal dialog: about 85% of the screen at most, square
 * corners (decision Q7), the same paper-alt field, its own scroll that does not chain to the page.
 *
 * EVERY PHONE-ONLY RULE IS A `max-[760px]:` RULE, so none of them can reach 760px; the desktop hairline, tint and print rule stay on this same element exactly as they were
 * (tests/farah/sheet-frame.test.tsx pins both halves).
 *
 * The state, the focus handling and the page-behind lock are in farah-sheet-host.tsx; this file is markup only.
 */
export interface FarahSheetFrameProps {
  open: boolean;
  onClose?: () => void;
  frameRef?: Ref<HTMLDivElement>;
  scrimRef?: Ref<HTMLDivElement>;
  /** Called with the scrim tap; the host decides whether it was really on the scrim. */
  onScrimTap?: (event: { target: EventTarget | null }) => void;
  children: ReactNode;
}

export function FarahSheetFrame({ open, onClose, frameRef, scrimRef, onScrimTap, children }: FarahSheetFrameProps) {
  return (
    <>
      {open && (
        <div
          ref={scrimRef}
          data-testid="farah-sheet-scrim"
          aria-hidden="true"
          onClick={onScrimTap}
          className="fixed inset-0 z-[39] bg-ink/40 min-[760px]:hidden print:hidden"
        />
      )}
      <div
        ref={frameRef}
        id="farah-sheet"
        data-testid="farah-sheet"
        data-sheet={open ? "open" : "closed"}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Farah, AI assistant" : undefined}
        tabIndex={open ? -1 : undefined}
        className={[
          "bg-paper-alt min-[760px]:border-l min-[760px]:border-l-line print:hidden",
          "max-[760px]:fixed max-[760px]:inset-x-0 max-[760px]:bottom-0 max-[760px]:z-[40] max-[760px]:flex max-[760px]:max-h-[85dvh] max-[760px]:flex-col",
          "max-[760px]:overflow-y-auto max-[760px]:overscroll-contain max-[760px]:pb-[env(safe-area-inset-bottom)] max-[760px]:motion-safe:transition-transform max-[760px]:motion-safe:duration-200",
          "data-[sheet=closed]:max-[760px]:invisible data-[sheet=closed]:max-[760px]:translate-y-full",
          "focus:outline-none",
        ].join(" ")}
      >
        <div className="flex items-center justify-end px-2 pt-1 min-[760px]:hidden">
          <button
            type="button"
            aria-label="Close Farah"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center font-body text-[13px] font-semibold text-ink-soft hover:text-rust focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust min-[760px]:hidden"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
