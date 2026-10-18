"use client";

import { useEffect, useState, type ComponentType } from "react";

/**
 * The install strip, imported after the page has mounted and never on the server.
 *
 * NOT `next/dynamic(..., { ssr: false })`, which looks right and is not: on the server it bails out to client rendering at the nearest Suspense boundary, so the
 * server HTML of everything inside that boundary (here, the whole signed-in page) is thrown away and rebuilt in the browser, and the page becomes interactive late.
 * e2e/credit-prices.spec.ts caught it: a click right after the page appeared did nothing, 4 runs in 28 failed, 0 in 28 with the strip removed. This renders `null` on the
 * server and on the first client render (so hydration matches), then imports the strip chunk in an effect. tests/pwa/install-strip-lazy.test.tsx pins that nothing bails out.
 *
 * The shell is a Server Component and cannot hold this state itself, so this small client wrapper does. src/components/pwa/install-strip.tsx has the behaviour.
 */
export function InstallStripLazy() {
  const [Strip, setStrip] = useState<ComponentType | null>(null);

  useEffect(() => {
    let live = true;
    import("@/components/pwa/install-strip").then((m) => {
      if (live) setStrip(() => m.default);
    });
    return () => {
      live = false;
    };
  }, []);

  return Strip ? <Strip /> : null;
}
