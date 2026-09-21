"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOneTapNonceAction } from "@/lib/auth/one-tap-actions";
import { completeOneTapSignIn, oneTapSuccessDestination } from "@/lib/auth/one-tap-client";
import { oneTapMomentAction } from "@/lib/auth/one-tap-events";

const SCRIPT_ID = "google-identity-services";
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/**
 * Minimal shape of the bit of the Google Identity Services API this file
 * actually calls. GIS attaches itself to `window.google` once its script
 * loads — there's no npm package to get real types from.
 */
interface GoogleIdConfig {
  client_id: string;
  callback: (response: { credential: string }) => void;
  nonce: string;
  use_fedcm_for_prompt?: boolean;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}
/**
 * The subset of GIS's PromptMomentNotification this file reads to log why
 * a prompt did or didn't show — send-446. Google's own three top-level
 * moment types are 'display' | 'skipped' | 'dismissed'; a display moment
 * can still mean "not actually shown" (isNotDisplayed(), e.g. suppressed by
 * a FedCM cooldown or no active Google session) as distinct from a genuine
 * "skipped" (the user or the page dismissed it) or "dismissed" (closed
 * after being shown) moment.
 */
interface PromptMomentNotification {
  isNotDisplayed: () => boolean;
  getNotDisplayedReason: () => string;
  isSkippedMoment: () => boolean;
  getSkippedReason: () => string;
  isDismissedMoment: () => boolean;
  getDismissedReason: () => string;
}
interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void;
  prompt: (momentListener?: (notification: PromptMomentNotification) => void) => void;
  cancel: () => void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

function loadGoogleIdentityScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("gsi script error")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gsi script error"));
    document.head.appendChild(script);
  });
}

/**
 * Google One Tap — the passive sign-in prompt Chrome shows in the corner for
 * a visitor with an active Google session, on top of (not instead of) the
 * existing "Continue with Google" click-through button.
 *
 * RENDERS NOTHING OF ITS OWN. `null` always — the visible prompt, if Google
 * decides to show one, is an iframe Google's own script injects into
 * `document.body`; this component only drives the handshake. That is also
 * why there's no loading state, no placeholder box, and therefore no layout
 * shift possible from this component itself (requirement: no layout shift).
 *
 * MUST DEGRADE COMPLETELY SILENTLY, and every early return below is one of
 * the ways that happens: no client ID configured, an already-signed-in
 * visitor, the script failing to load (ad blocker / tracking-protection
 * browser / offline), or Google itself declining to show a prompt (no active
 * Google session, third-party-cookie/FedCM context blocked). None of these
 * throw, none of them render an error, and — deliberately — none of them
 * `console.error`. A visitor who was never going to see One Tap should see
 * literally nothing different about the page.
 *
 * Only ever mounted on signed-out surfaces (landing page, /login, /signup,
 * job/scholarship detail pages) — see the call sites for why each one is
 * safe to add it to. The `getSession()` check below is a second, redundant
 * guard against ever prompting a signed-in visitor, in case this ever gets
 * added somewhere that doesn't already exclude them (e.g. the marketing
 * homepage renders for anyone, signed in or not — see src/app/page.tsx).
 */
export function GoogleOneTap() {
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    /*
     * NOT a `useRef`-backed "only ever once" latch — that was tried and is
     * wrong. React's Strict Mode runs every effect as setup → cleanup →
     * setup in development, specifically to surface effects that don't
     * tolerate being restarted. A ref set to `true` on the first setup and
     * never reset by the cleanup fails exactly that check: the SECOND
     * (real) setup sees the stale flag and returns immediately, so the
     * whole flow silently does nothing — confirmed live in this sandbox,
     * where it was the reason no request to Google's script or this
     * component's own server action ever fired. `cancelled` below is scoped
     * to THIS effect invocation, which is what makes a restart correct:
     * setup 1's in-flight work sees its own `cancelled` flip to true and
     * bails at its next `await`, while setup 2 starts clean.
     */
    let cancelled = false;

    (async () => {
      try {
        // Created inside the try block, deliberately: constructing the
        // browser client can itself throw (a misconfigured/missing Supabase
        // URL, most concretely), and that must degrade exactly like every
        // other failure here — never an uncaught throw inside an effect.
        const supabase = createClient();

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled || session) return;

        const { nonce, hashedNonce } = await getOneTapNonceAction();
        if (cancelled) return;

        await loadGoogleIdentityScript();
        if (cancelled || !window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce: hashedNonce,
          use_fedcm_for_prompt: true,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => {
            if (cancelled) return;
            void completeOneTapSignIn(supabase, response.credential, nonce).then((result) => {
              if (cancelled) return;
              if (result.ok) {
                window.location.assign(oneTapSuccessDestination());
              }
              // A rejected/failed exchange (nonce mismatch, expired
              // credential, network error) falls through to here and does
              // nothing further — the visitor still has the ordinary
              // sign-in buttons on the page, which is the whole point of
              // this being an enhancement rather than a replacement.
            });
          },
        });

        // send-446: log the moment-notification outcome, anonymously and
        // best-effort — see one-tap-events.ts's own header for why this is
        // a Server Action rather than the server-only pattern
        // credit_gate_events/country_default_events use, and for why there
        // is no user_id (this fires before any credential exchange). This
        // callback only ever runs once GIS actually returned a real
        // response to `prompt()`, so it cannot fire on any of this
        // component's existing silent-failure paths (missing client ID,
        // already-signed-in, script blocked) — none of those reach here.
        window.google.accounts.id.prompt((notification) => {
          if (cancelled) return;
          const page = window.location.pathname;
          const userAgent = navigator.userAgent;
          if (notification.isNotDisplayed()) {
            void oneTapMomentAction({
              momentType: "display",
              reason: notification.getNotDisplayedReason(),
              page,
              userAgent,
            });
          } else if (notification.isSkippedMoment()) {
            void oneTapMomentAction({
              momentType: "skipped",
              reason: notification.getSkippedReason(),
              page,
              userAgent,
            });
          } else if (notification.isDismissedMoment()) {
            void oneTapMomentAction({
              momentType: "dismissed",
              reason: notification.getDismissedReason(),
              page,
              userAgent,
            });
          } else {
            // A genuine, successful display — shown, not suppressed.
            void oneTapMomentAction({ momentType: "display", reason: null, page, userAgent });
          }
        });
      } catch {
        // Script blocked, network failure, or any other surprise: silent,
        // by design — see the class comment above.
      }
    })();

    return () => {
      cancelled = true;
      try {
        window.google?.accounts?.id.cancel();
      } catch {
        // Nothing to clean up if GIS never finished loading.
      }
    };
  }, []);

  return null;
}
