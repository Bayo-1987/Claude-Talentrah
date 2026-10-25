"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INSTALL_PROMPT_EVENT } from "@/lib/pwa/bootstrap";
import { computeOffer, runInstall, writeDismissed, type InstallEnv, type InstallOffer } from "@/lib/pwa/install-state";
import { InstallStripView } from "@/components/pwa/install-strip-view";
import { watchRelevantChanges } from "@/lib/pwa/watch-relevant-changes";

/**
 * The install strip: decides on mount, from what the early bootstrap already captured (src/lib/pwa/bootstrap.ts), so a `beforeinstallprompt`
 * that fired before this component loaded is not lost. It re-decides when the bootstrap announces a late prompt and when the cookie banner
 * closes (a change in the page's own markup), and renders nothing until there is something true to offer. What it decides is in
 * src/lib/pwa/install-state.ts.
 */
export default function InstallStrip() {
  const [offer, setOffer] = useState<InstallOffer>({ kind: "none" });
  const [reserve, setReserve] = useState(0);
  const barRef = useRef<HTMLElement>(null);
  // "Not now" is also remembered for the life of the page: when storage throws (a private window) nothing else would, and the next re-decision
  // (the prompt event, the cookie banner closing) would offer the strip straight back. Found by e2e/pwa-install-strip.spec.ts.
  const dismissed = useRef(false);

  const decide = useCallback(() => {
    if (dismissed.current) return;
    const next = computeOffer(window as unknown as InstallEnv, Date.now());
    // Keep the same state object when nothing changed, so a re-decision that finds the same answer re-renders nothing.
    setOffer((prev) => (prev.kind === next.kind && (prev.kind !== "prompt" || (next.kind === "prompt" && prev.event === next.event)) ? prev : next));
  }, []);

  useEffect(() => {
    // Deferred out of the effect body, like the cookie banner's own read, so it is not a synchronous setState in an effect.
    Promise.resolve().then(decide);
    window.addEventListener(INSTALL_PROMPT_EVENT, decide);
    // Only the things that can change the answer: the hint or the cookie banner added or removed (at any depth), and the returning-visitor marker on <html>.
    // Not every DOM change under <body>, and no frame callback (frames do not run in a background tab).
    const stop = watchRelevantChanges(MutationObserver, document.body, document.documentElement, decide);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_EVENT, decide);
      stop();
    };
  }, [decide]);

  // The bar is fixed, so it covers the last strip of the page. While it shows, the page gets the same height of padding at its end (a spacer in flow, last in the
  // shell), kept equal to the bar's real height: the text wraps to two lines on a narrow phone.
  const showing = offer.kind !== "none";
  useEffect(() => {
    const el = barRef.current;
    if (!showing || !el) {
      Promise.resolve().then(() => setReserve(0));
      return;
    }
    const root = document.documentElement;
    const measure = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      setReserve(height);
      // The Farah launcher (fixed, bottom right, phones) stands above the strip by this much; removed the moment the strip goes.
      root.style.setProperty("--farah-strip-h", `${height}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--farah-strip-h");
    };
  }, [showing]);

  if (offer.kind === "none") return null;

  return (
    <>
      <InstallStripView
        kind={offer.kind}
        barRef={barRef}
        onInstall={() => {
          if (offer.kind !== "prompt") return;
          runInstall(window as unknown as InstallEnv, offer.event).then(() => setOffer({ kind: "none" }));
        }}
        onDismiss={() => {
          dismissed.current = true;
          writeDismissed(window as unknown as InstallEnv, Date.now());
          setOffer({ kind: "none" });
        }}
      />
      <div aria-hidden="true" data-testid="install-strip-spacer" style={{ height: reserve }} className="print:hidden" />
    </>
  );
}
