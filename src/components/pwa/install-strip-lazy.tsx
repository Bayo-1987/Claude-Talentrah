"use client";

import dynamic from "next/dynamic";

/**
 * The install strip, loaded after the page has hydrated and never on the server: the signed-in shell is a Server Component, which cannot call
 * `dynamic(..., { ssr: false })` itself, so this tiny client wrapper does. Nothing here is in the first render, so it cannot move LCP, and a
 * visitor with nothing to be offered still only pays for this wrapper. src/components/pwa/install-strip.tsx has the behaviour.
 */
const InstallStrip = dynamic(() => import("@/components/pwa/install-strip"), { ssr: false });

export function InstallStripLazy() {
  return <InstallStrip />;
}
