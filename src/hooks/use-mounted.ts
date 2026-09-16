"use client";

import { useEffect, useState } from "react";

/**
 * True only once this subtree has mounted on the client — false during SSR
 * and during the very first client render (which must match the server's
 * output exactly, or React logs a hydration mismatch). Flips to `true`
 * inside a `useEffect` with an empty dependency array, which React only
 * runs after the commit is painted and event handlers for this subtree are
 * attached — i.e. after hydration has actually happened for this component.
 *
 * WHY THIS EXISTS (#142): a handful of controls on the /jobs feed — Report,
 * Ask Farah, Share, the Auto-Apply toggle — are wired with a plain `onClick`
 * rather than a `<form action={serverAction}>`. A `<form>` progressively
 * enhances and works before hydration; a bare `onClick` does not exist in
 * the DOM until React attaches it, so a click that lands in that window is
 * silently swallowed — the button is painted, looks enabled, and gives no
 * feedback. The feed renders 150+ of these per control, which multiplies
 * the exposure window, and CLAUDE.md calls out low-end Android on expensive
 * mobile data as a real constraint for exactly this kind of page.
 *
 * Gate a purely-client control's trigger on `useMounted()` (see
 * `mountedTriggerProps` below for the common case) so it renders an honest,
 * visibly-disabled state until it is actually safe to click — never a fake
 * spinner, per the issue: this is dead time, not busy time.
 *
 * Server-action forms do NOT need this — they already work pre-hydration.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

/**
 * Shared props for a plain `<button>` trigger that should stay inert until
 * `useMounted()` flips true. One place that decides "disabled + inert +
 * doesn't look clickable" so a fifth client-only control added later gets
 * the same protection automatically instead of reinventing (or forgetting)
 * it — see #142.
 *
 * Real `disabled` (not just `aria-disabled`) is deliberate: a native
 * `disabled` button is rendered identically by the server and by the first
 * client render (both see `mounted === false`), so there is no hydration
 * mismatch, and — unlike `aria-disabled` alone — it actually prevents the
 * click from reaching a not-yet-attached handler rather than merely
 * describing the state to assistive tech.
 */
export function mountedTriggerProps(mounted: boolean) {
  return {
    disabled: !mounted,
    "aria-disabled": !mounted,
  } as const;
}
