"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/lib/button-classes";
import { COOKIE_CONSENT_STORAGE_KEY } from "./cookie-consent-script";

/**
 * send-406 — a real, dismissible cookie/consent banner. Forward-looking
 * infrastructure, not a fix for an active leak: current tracking (PostHog,
 * src/lib/analytics/posthog.ts) is server-side only, so there is technically
 * nothing to gate yet. This exists so a real non-essential cookie/tracking
 * addition later has an actual place to plug into.
 *
 * ── COPY MATCHES data-cookie-notice/page.tsx EXACTLY, NOT INVENTED ─────────
 *
 * That page is the source of truth this banner must not contradict or
 * overstate: two real cookie categories exist today — Supabase auth session
 * cookies (required, can't be turned off individually) and Google One Tap
 * (optional sign-in convenience on signed-out pages, not tracking). Beyond
 * those, the notice page states plainly "Talentrah does not set advertising
 * or third-party tracking cookies." This banner says the same thing, links
 * to that page for the full detail, and invents nothing stricter or looser.
 *
 * ── WHY GOOGLE ONE TAP IS NOT GATED BEHIND THIS BANNER'S CHOICE ────────────
 *
 * Considered and decided, not silently picked. One Tap is a sign-in
 * mechanism, not tracking/analytics/advertising — the conventional target of
 * a cookie-consent gate — and the notice page's own words already frame it
 * as "optional sign-in convenience," never as something requiring consent to
 * function ("its absence changes nothing: the ordinary 'Continue with
 * Google' button on the same pages still works"). Gating its script load
 * behind a client-side consent read would add real coordination complexity
 * (GoogleOneTap, src/components/auth/google-one-tap.tsx, would need to know
 * this banner's stored choice) for a ticket explicitly scoped to consent UI
 * infrastructure, not a new privacy control — "don't over-build a granular
 * per-category consent system for categories that don't exist yet."
 * Revisit if Google One Tap itself is ever reclassified as needing consent.
 *
 * ── WHY A PLAIN TOP-OF-PAGE BLOCK, NOT A FIXED/STICKY BAR ──────────────────
 *
 * A fixed bottom bar is the more common cookie-banner pattern, and was
 * considered first — but this app already has TWO real fixed-bottom-bar
 * users at the exact same z-index (marketing-sticky-cta.tsx and
 * farah-mobile-tab.tsx, both `z-[18]`, both mobile-only, both signed-out or
 * signed-in-context-specific), and this banner would need to coexist with
 * marketing-sticky-cta.tsx specifically: both would be live simultaneously
 * on the homepage, for a signed-out mobile visitor, before either has
 * resolved. Coordinating two independently-rendered fixed bars without one
 * covering the other needs either shared z-index/offset bookkeeping between
 * unrelated components, or a race-prone height calculation against a
 * component that resolves its own visibility asynchronously — real
 * complexity for what this ticket asks to be simple, dismissible UI. A
 * plain in-flow block at the very top of <body> (see layout.tsx) sidesteps
 * the whole problem: it pushes every sticky header down while visible,
 * never overlaps anything, and needs no z-index coordination with anything
 * else fixed on the page.
 *
 * ── S1-26 ITEM 3: IT NO LONGER APPEARS AFTER HYDRATION ─────────────────────
 *
 * Being in-flow is right; appearing AFTER the page had painted was the bug. It started hidden and showed once mounted, so on a slow phone the
 * whole page painted, then dropped by the banner's height: CLS 0.16 to 0.19 on /, /jobs and a job page. It is now rendered on the server and
 * is there at first paint. The visitor who already chose is handled before paint by a tiny script (./cookie-consent-script.ts) that marks
 * <html data-cookie-consent="decided">, and one CSS rule (globals.css) hides the banner on that attribute: no flash, no shift. This
 * component still removes itself once mounted if a choice is stored, and when a choice is made.
 */
const STORAGE_KEY = COOKIE_CONSENT_STORAGE_KEY;
type Consent = "accepted" | "rejected";

function readStoredConsent(): Consent | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    // Private browsing / blocked storage — degrade to "treat as undecided",
    // never throw. The banner shows every visit in that case, which is a
    // real but acceptable fallback, not a broken page.
    return null;
  }
}

function storeConsent(value: Consent): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Same degrade-quietly rule as the read above.
  }
}

export function CookieConsentBanner() {
  // Visible from the server render: it is part of the first paint. A returning visitor never sees it, because the pre-paint script and one
  // CSS rule hide it before paint (see the header and cookie-consent-script.ts); the effect below then removes it from the page for good.
  // The read is deferred into a microtask (rather than called directly in the effect body): a direct synchronous setState call in an
  // effect body risks the cascading-render pattern React's own lint rule warns against.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    Promise.resolve().then(() => setVisible(readStoredConsent() === null));
  }, []);

  function dismiss(choice: Consent) {
    storeConsent(choice);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      data-testid="cookie-consent-banner"
      role="region"
      aria-label="Cookie notice"
      className="flex flex-col gap-3 border-b-[1.5px] border-ink bg-card px-5 py-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between min-[760px]:gap-6 print:hidden"
    >
      <p className="text-[13.5px] leading-[1.5] text-ink-soft">
        Talentrah uses cookies required to keep you signed in, and — on some
        signed-out pages — Google&apos;s optional one-tap sign-in. We don&apos;t use
        tracking or advertising cookies.{" "}
        <Link
          href="/legal/data-cookie-notice"
          className="text-rust underline underline-offset-2 hover:text-rust-hover"
        >
          Learn more about cookies
        </Link>
        .
      </p>
      <div className="flex flex-shrink-0 gap-2.5">
        <button
          type="button"
          onClick={() => dismiss("rejected")}
          className={buttonClasses("secondary", "sm")}
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => dismiss("accepted")}
          className={buttonClasses("primary", "sm")}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
