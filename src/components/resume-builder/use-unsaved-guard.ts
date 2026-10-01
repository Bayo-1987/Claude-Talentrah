"use client";

import { useEffect } from "react";

/**
 * Asks before the user leaves a page that holds work they have not saved (send-493).
 *
 * WHY THIS EXISTS. A paid Farah rewrite lives only in the editor's React state until Save. Reproduced by the
 * owner: rewrite a bullet, follow any link, and the paid result is gone with nothing said. Credits are not
 * refunded for a lost rewrite, so "silently lost" is a money problem as well as a courtesy one.
 *
 * TWO MECHANISMS, because two kinds of leaving exist:
 *   - A real page unload (tab close, reload, typing a new address, an external link) fires `beforeunload`,
 *     which is the only hook the browser gives; its own dialog text cannot be customised.
 *   - An in-app link click is a soft navigation (Next's router fetches an RSC payload and swaps the page), which
 *     fires NO `beforeunload`. A capture-phase click listener on `document` sees the click before React or the
 *     router do, and can stop it after a `window.confirm`.
 * Not covered: the browser's Back button (a `popstate`, which cannot be reliably vetoed without pushing dummy
 * history entries that fight the router). Said here so nobody assumes it is.
 *
 * Inactive (`active` false) it attaches nothing, so a page with no unsaved work is never interrupted.
 */
export function useUnsavedGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required by some browsers for the prompt to appear; the string itself is ignored by modern ones.
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      // New-tab links and downloads leave this page where it is.
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // A full navigation to another origin fires beforeunload, which already asks.
      if (url.origin !== window.location.origin) return;
      // Same page (a hash or the current URL): nothing is being left.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}
