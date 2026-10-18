import { buttonClasses } from "@/lib/button-classes";

/**
 * The install strip's markup, with no behaviour, so it can be rendered and checked on the server (tests/pwa/install-strip-view.test.tsx).
 *
 * Quiet and one line: no emoji, no icon file, no countdown, no badge, no rounded corners. Both buttons are real <button>s with a hit target of
 * at least 40 by 40. It sits in normal flow under the masthead (the cookie banner is in flow too, and nothing here is fixed, so it cannot cover
 * the Farah tab), and is hidden when printing.
 *
 * Copy says only what is true: Android offers an Install button; iOS has no install prompt, so it says how to add the app from Safari.
 */
export function InstallStripView({
  kind,
  onInstall,
  onDismiss,
}: {
  kind: "prompt" | "ios";
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside
      data-testid="install-strip"
      aria-label="Install Talentrah"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-paper-alt px-6 py-1 min-[760px]:px-10 print:hidden"
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
