"use client";

import { useState } from "react";
import { signOutEverywhereAction } from "@/lib/auth/actions";
import { buttonClasses } from "@/lib/button-classes";
import { EyebrowLabel } from "@/components/ui";

/** Said before anything is submitted, and tested: the confirm step must state exactly what the action does. */
export const SIGN_OUT_EVERYWHERE_WARNING =
  "This signs you out of Talentrah on every device and browser, including this one, and you will need to log in again. Use it if you have lost a device or think someone else may have your session.";

/**
 * Settings, security: "Sign out of all devices" (S1-44). The header's Sign out now signs out this device only, so ending every session is
 * its own, explicit action. One click asks; a second, labelled with the consequence, does it.
 */
export function SignOutEverywhere() {
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-labelledby="security-heading" className="flex flex-col gap-3 border-t border-line pt-6">
      <EyebrowLabel size="sm">
        <span id="security-heading">Security</span>
      </EyebrowLabel>
      <p className="font-body text-[14.5px] text-ink-soft">
        &ldquo;Sign out&rdquo; in the menu signs you out on this device only. To end your session everywhere, use this.
      </p>
      {confirming ? (
        <form action={signOutEverywhereAction} className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-4" aria-label="Confirm signing out of all devices">
          <p role="alert" className="font-body text-[14px] text-ink">
            {SIGN_OUT_EVERYWHERE_WARNING}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={buttonClasses("primary", "md")}>
              Sign out everywhere
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClasses("ghost", "md")}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className={buttonClasses("secondary", "md")} aria-expanded={false}>
            Sign out of all devices
          </button>
        </div>
      )}
    </section>
  );
}
