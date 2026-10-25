import type { Ref } from "react";
import { FarahMark } from "@/components/ui/farah-mark";

/**
 * The Farah launcher's markup: the round button that stands where the bottom bar used to, below 760px only. No behaviour here, so it can be rendered and checked on the server
 * (tests/farah/launcher-view.test.tsx); the state (the first-visit pill, the soft keyboard, the sheet) is in farah-sheet-host.tsx.
 *
 * ── THE SHAPE, AND WHY IT BREAKS A WRITTEN RULE ─────────────────────────────
 *
 * The design system allows no border-radius except on avatars, notification dots and toggles, and the bar this replaces argued at length that a floating circle was the wrong shape. The
 * Reviewer approved the exception (launcher plan, decision Q6, 25 Oct 2026): a bar covers a full row of every phone screen, a 56px circle covers one thumb's width. It is the ONLY round
 * thing besides those three, it is below 760px only, and it is recorded in CLAUDE.md.
 *
 * ── WHAT IT SAYS ABOUT FARAH ────────────────────────────────────────────────
 *
 * The name beside Farah is "AI assistant" (decision Q5/Q6): disclosure, not a replacement for her name. The round form carries a small square "AI" tag; the first-visit pill spells it out
 * ("Ask Farah · AI assistant"). The accessible name of the round form is "Ask Farah, AI assistant", which contains every word it shows; the pill's name is its own text.
 *
 * ── POSITION ────────────────────────────────────────────────────────────────
 *
 * Fixed, bottom right, 16px in, above the home indicator (`env(safe-area-inset-bottom)`) and above the install strip when that is showing (the strip publishes its height as
 * `--farah-strip-h`). z-18: over the feed, under the masthead (20) and the sheet (40). It reserves the right-hand 72px column (56 + 16) of the pages' action rows, see `data-farah-avoid`.
 */
export interface FarahLauncherViewProps {
  /** The first-visit pill ("Ask Farah · AI assistant") instead of the round button. */
  expanded: boolean;
  /** The soft keyboard is open: invisible and takes no taps, so it cannot sit on what is being typed. */
  concealed: boolean;
  /** The sheet is open: the launcher is inert behind it. */
  open: boolean;
  hasUnreadNotification?: boolean;
  onClick?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function FarahLauncherView({ expanded, concealed, open, hasUnreadNotification = false, onClick, buttonRef }: FarahLauncherViewProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="farah-launcher"
      data-launcher={expanded ? "pill" : "round"}
      aria-label={expanded ? undefined : "Ask Farah, AI assistant"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="farah-sheet"
      inert={open}
      onClick={onClick}
      style={{ bottom: "calc(16px + env(safe-area-inset-bottom) + var(--farah-strip-h, 0px))" }}
      className={[
        "fixed right-4 z-[18] inline-flex h-14 items-center justify-center rounded-full border-[2.5px] border-ink bg-paper text-ink",
        "transition-[width,padding] duration-200 hover:border-rust hover:text-rust motion-reduce:transition-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust",
        "min-[760px]:hidden print:hidden",
        expanded ? "gap-2.5 px-5 font-body text-[14px] font-semibold" : "relative w-14",
        concealed ? "pointer-events-none invisible" : "",
      ].join(" ")}
    >
      <FarahMark size={expanded ? 24 : 28} hasUnread={hasUnreadNotification} />
      {expanded ? (
        <span>Ask Farah · AI assistant</span>
      ) : (
        <span aria-hidden="true" className="absolute -bottom-1 -left-1 bg-ink px-1 font-body text-[10px] leading-4 font-bold tracking-[0.06em] text-paper">
          AI
        </span>
      )}
    </button>
  );
}
