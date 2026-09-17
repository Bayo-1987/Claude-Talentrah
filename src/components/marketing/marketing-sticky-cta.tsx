"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buttonClasses } from "@/lib/button-classes";

/**
 * A persistent "Get started for free" bar, fixed to the bottom of the
 * viewport, below 760px only — the marketing pages' equivalent of
 * FarahMobileTab (src/components/app-shell/farah-mobile-tab.tsx), whose
 * fixed/safe-area/spacer/z-index mechanics this deliberately copies. NOT a
 * reuse of FarahMobileTab itself: different audience, different copy,
 * different destination (/signup, not the Farah panel).
 *
 * ── WHY THIS COMPONENT DOES ITS OWN AUTH CHECK ────────────────────────────
 *
 * The natural instinct is "the page already knows if the visitor is signed
 * in, so just read that" — which is how AppShell (src/components/app-shell/
 * app-shell.tsx) gates its own signed-in chrome. That doesn't apply here.
 * The marketing homepage (src/app/page.tsx) is DELIBERATELY static: its own
 * header comment documents that reading the auth cookie in any Server
 * Component there opts the WHOLE ROUTE into dynamic, uncached rendering,
 * which is a real regression that shipped and was measured before being
 * fixed. Nothing server-side on this page knows the answer, and
 * MarketingMasthead (marketing-masthead.tsx) doesn't either — it's a
 * `"use client"` component with no auth awareness at all, unconditionally
 * rendering "Log in"/"Get started for free" for every visitor.
 *
 * So there is no existing signal to piggyback on. The precedent this
 * mirrors instead is GoogleOneTap (src/components/auth/google-one-tap.tsx),
 * which solves the identical problem on this identical page: a client-side
 * `supabase.auth.getSession()` check, done in the browser after mount, so
 * the page itself never touches auth server-side and stays static.
 *
 * Starts hidden (`visible === null`) rather than defaulting to shown, so a
 * signed-in visitor never sees even a brief flash of a "create a free
 * account" bar before the check resolves.
 */
const STICKY_CTA_HEIGHT = 56;
const STICKY_CTA_BORDER = 2.5;

export function MarketingStickyCta() {
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setVisible(!session);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="marketing-sticky-cta-spacer"
        style={{
          height: `calc(${STICKY_CTA_HEIGHT + STICKY_CTA_BORDER}px + env(safe-area-inset-bottom))`,
        }}
        className="min-[760px]:hidden print:hidden"
      />
      <div
        data-testid="marketing-sticky-cta"
        className="fixed inset-x-0 bottom-0 z-[18] border-t-[2.5px] border-ink bg-paper min-[760px]:hidden print:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Link
          href="/signup"
          style={{ height: STICKY_CTA_HEIGHT }}
          className={buttonClasses("primary", "md", "w-full no-underline")}
        >
          Get started for free
        </Link>
      </div>
    </>
  );
}
