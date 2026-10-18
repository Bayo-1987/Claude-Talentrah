import type { Ref } from "react";
import { buttonClasses } from "@/lib/button-classes";

/**
 * The install strip's markup, with no behaviour, so it can be rendered and checked on the server (tests/pwa/install-strip-view.test.tsx).
 *
 * Quiet: no emoji, no icon file, no countdown, no badge, no rounded corners. Both buttons are real <button>s with a hit target of at least 40 by 40.
 * Hidden when printing.
 *
 * FIXED TO THE BOTTOM EDGE, NOT IN FLOW. It appears after hydration, so an in-flow strip under the masthead pushed the whole page down when it mounted
 * (measured: the content column's top moved from 70 to 147 px on a phone and to 123 px on a desktop). A fixed bar moves nothing. Below 760px it stands
 * ABOVE the Farah tab (the tab is 56px plus a 2.5px border plus the safe area, see farah-mobile-tab.tsx), from 760px up it sits on the bottom edge. It covers the
 * last strip of the page until dismissed, the usual cost of an install bar; z-17 keeps it under the tab (18) and the masthead (20).
 *
 * Copy says only what is true: Android offers an Install button; iOS has no install prompt, so it says how to add the app from Safari.
 */
export function InstallStripView({
  kind,
  onInstall,
  onDismiss,
  barRef,
}: {
  kind: "prompt" | "ios";
  /** The bar's element, so the strip can measure it and reserve the same height at the end of the page. */
  barRef?: Ref<HTMLElement>;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside
      ref={barRef}
      data-testid="install-strip"
      aria-label="Install Talentrah"
      className="fixed inset-x-0 bottom-[calc(58.5px+env(safe-area-inset-bottom))] z-[17] flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line bg-paper-alt px-6 py-1 min-[760px]:bottom-0 min-[760px]:px-10 print:hidden"
    >
      <p className="text-[13.5px] leading-[1.5] text-ink-soft">
        {kind === "ios" ? "To install: tap Share, then Add to Home Screen." : "Add Talentrah to your home screen."}
      </p>
      <div className="flex items-center gap-2">
        {kind === "prompt" && (
          <button type="button" onClick={onInstall} className={`${buttonClasses("primary", "sm")} min-h-[44px] min-w-[44px]`}>
            Install
          </button>
        )}
        <button type="button" onClick={onDismiss} className={`${buttonClasses("ghost", "sm")} min-h-[44px] min-w-[44px] px-3`}>
          Not now
        </button>
      </div>
    </aside>
  );
}
