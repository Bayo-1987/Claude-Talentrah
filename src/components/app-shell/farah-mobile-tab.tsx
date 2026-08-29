"use client";

import { FarahMark } from "@/components/ui/farah-mark";
import { scrollToFarahPanel } from "@/lib/farah/scroll-to-panel";

/**
 * "Ask Farah", fixed to the bottom of the viewport, below 760px only.
 *
 * ── WHY A BAR AND NOT A FLOATING BUTTON ───────────────────────────────────
 *
 * A circular FAB is the reflex here and it is the wrong shape for this
 * product. The design system has no border-radius except on avatars,
 * notification dots and toggles, and a floating rust circle over the feed
 * would be the single most SaaS-looking element in the app — on the surface
 * whose whole argument is that it does not look like that. A full-width
 * square-cornered bar with a rule along its top is the masthead's own
 * language, repeated at the other end of the screen.
 *
 * ── THE FIXED-POSITION DETAILS, NONE OF WHICH ARE OPTIONAL ────────────────
 *
 * Nothing else in this codebase is fixed-positioned, so there is no house
 * pattern to copy and every hazard has to be handled here:
 *
 * SAFE AREA. On a notched phone the bottom of the viewport is behind the home
 * indicator. `env(safe-area-inset-bottom)` is added to the padding rather than
 * the height, so the bar's touch target keeps its full height and only its
 * background extends into the inset. It resolves to 0 everywhere else, so
 * there is no branch.
 *
 * Z-INDEX 18, chosen against the three layers that already exist rather than
 * picked for being large. The masthead band is z-20 and its dropdowns render
 * inside it; the job cards' Farah and Report menus are z-[15]; the feed
 * header is z-10. 18 puts the bar above the feed and above a card menu, but
 * below the masthead, so a masthead dropdown that grows long on a short
 * viewport still wins. Both card menus open UPWARD
 * (`bottom-[calc(100%+8px)]`), away from this bar, so nothing they show is
 * hidden behind it.
 *
 * CONTENT RESERVE. A fixed bar covers whatever is beneath it, so this
 * component also renders a flow spacer of matching height — see the note on it
 * below for why the reserve lives here rather than as padding in the layout.
 */

/**
 * Bar height in px. NOT exported, deliberately — see the spacer below.
 *
 * It used to be, so that (app)/layout.tsx could size its own bottom reserve
 * from it. That silently did not work, and the way it failed is worth knowing:
 * importing a plain VALUE from a `"use client"` module into a Server Component
 * does not give you the value. Next replaces client-module exports with client
 * reference proxies, so the layout received a function stub, the template
 * literal stringified it into the CSS variable as
 * `--farah-tab-h: function() { throw new Error(...) }px`, the `calc()` was
 * therefore invalid, and `padding-bottom` fell back to 0 with no error
 * anywhere. Measured as 0px on a phone, which is how it was caught.
 */
const FARAH_TAB_HEIGHT = 56;

/**
 * The rule along the top, which is part of the bar's height and was left out
 * of the reserve the first time.
 *
 * Measured consequence, not a rounding worry: with the spacer at 56 and the
 * bar at 58.5, the Farah panel's bottom edge sat 2px BEHIND the bar at the end
 * of the page — `tab.top - panel.bottom` came back as -2. Two pixels of the
 * thing the bar exists to reveal, hidden by the bar.
 *
 * Must stay equal to the `border-t-[2.5px]` on the bar below. They are two
 * literals because Tailwind scans source text and cannot read this constant;
 * if you change one, change the other.
 */
const FARAH_TAB_BORDER = 2.5;

export function FarahMobileTab() {
  return (
    <>
      {/*
        THE RESERVE, as a real element in normal flow rather than padding on
        an ancestor.

        A fixed bar covers whatever is beneath it, so the page has to end that
        much earlier. Owning the spacer here rather than reserving space in
        the layout means the number never crosses the server/client boundary —
        which is precisely what broke the first version — and means the bar and
        its reserve can never disagree about how tall the bar is.

        It sits after the shell's two columns, so it reserves against whatever
        is genuinely last. Below 760 that is the Farah PANEL, not the last job
        card: the columns stack, so the panel is the element the bar would
        otherwise cover, and it is the one thing the bar exists to send people
        to.

        `display: none` above 760 via the same breakpoint as the bar, so no
        desktop page carries dead space for a control it does not render.
      */}
      <div
        aria-hidden="true"
        data-testid="farah-tab-spacer"
        style={{
          height: `calc(${FARAH_TAB_HEIGHT + FARAH_TAB_BORDER}px + env(safe-area-inset-bottom))`,
        }}
        className="min-[760px]:hidden print:hidden"
      />
      <div
        data-testid="farah-mobile-tab"
        className="fixed inset-x-0 bottom-0 z-[18] border-t-[2.5px] border-ink bg-paper min-[760px]:hidden print:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={scrollToFarahPanel}
          style={{ height: FARAH_TAB_HEIGHT }}
          className="flex w-full items-center justify-center gap-2.5 font-body text-[14.5px] font-semibold text-ink hover:text-rust"
        >
          {/*
          The mark, at the size the bar can carry. FarahMark is already
          aria-hidden, and the label beside it is the accessible name — no
          aria-label here, which would override the visible text with a
          duplicate of itself.
        */}
          <FarahMark size={22} />
          Ask Farah
        </button>
      </div>
    </>
  );
}
