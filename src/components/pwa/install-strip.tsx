"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INSTALL_PROMPT_EVENT } from "@/lib/pwa/bootstrap";
import { computeOffer, runInstall, writeDismissed, type InstallEnv, type InstallOffer } from "@/lib/pwa/install-state";
import { InstallStripView } from "@/components/pwa/install-strip-view";

/**
 * The install strip: decides on mount, from what the early bootstrap already captured (src/lib/pwa/bootstrap.ts), so a `beforeinstallprompt`
 * that fired before this component loaded is not lost. It re-decides when the bootstrap announces a late prompt and when the cookie banner
 * closes (a change in the page's own markup), and renders nothing until there is something true to offer. What it decides is in
 * src/lib/pwa/install-state.ts.
 */
export default function InstallStrip() {
  const [offer, setOffer] = useState<InstallOffer>({ kind: "none" });
  // "Not now" is also remembered for the life of the page: when storage throws (a private window) nothing else would, and the next re-decision
  // (the prompt event, the cookie banner closing) would offer the strip straight back. Found by e2e/pwa-install-strip.spec.ts.
  const dismissed = useRef(false);

  const decide = useCallback(() => {
    if (dismissed.current) return;
    setOffer(computeOffer(window as unknown as InstallEnv, Date.now()));
  }, []);

  useEffect(() => {
    // Deferred out of the effect body, like the cookie banner's own read, so it is not a synchronous setState in an effect.
    Promise.resolve().then(decide);
    window.addEventListener(INSTALL_PROMPT_EVENT, decide);
    // The banner removes itself (childList) or the returning-visitor marker lands on <html> (attributes): either way, look again.
    const observer = new MutationObserver(decide);
    observer.observe(document.body, { childList: true });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-cookie-consent"] });
    return () => {
      window.removeEventListener(INSTALL_PROMPT_EVENT, decide);
      observer.disconnect();
    };
  }, [decide]);

  if (offer.kind === "none") return null;

  return (
    <InstallStripView
      kind={offer.kind}
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
  );
}
