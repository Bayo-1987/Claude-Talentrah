"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Prefetches routes the moment it mounts, and renders nothing.
 *
 * For links that live inside a menu: next/link prefetches a link when it scrolls into the viewport, and a link inside a closed menu is not in the DOM, so it is never prefetched. Opening the
 * menu mounts it, and a click right after waits for a server round trip before the route's loading skeleton can paint. Mounting this beside the menu's trigger (the avatar is on every signed-in
 * page) restores what a link in the bar always had: its shell is cached before anyone reaches for it. Same call next/link makes (`router.prefetch`), so production only and the same cost, which
 * for a route with a loading.tsx is the layout down to its loading boundary, not the page.
 */
export function PrefetchOnMount({ hrefs }: { hrefs: readonly string[] }) {
  const router = useRouter();
  // Keyed on the joined list so a parent that rebuilds the array each render does not prefetch again on every render.
  const key = hrefs.join("\n");
  useEffect(() => {
    for (const href of key.split("\n")) router.prefetch(href);
  }, [router, key]);
  return null;
}
