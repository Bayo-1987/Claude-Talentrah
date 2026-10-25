/**
 * The Farah bottom sheet's open/close state helpers.
 *
 * DORMANT BY DESIGN (PR-1 of the mobile launcher plan): nothing imports this module yet. The sheet is the already-mounted Farah panel shown as a dialog on phones; these pure helpers decide WHAT
 * happens and the component (a later PR) does it:
 *  - focus goes back, on close, to the element that opened the sheet (the launcher, or a job's "Ask Farah" link), or to the launcher when that element has left the page;
 *  - Escape closes it, unless an input method is composing text or an inner widget already handled the key;
 *  - a tap closes it only when it lands on the scrim itself, not when it started inside the sheet;
 *  - reaching the 760px shell breakpoint with the sheet open closes it (the docked panel takes over).
 * Elements are described by the two things the helpers use, focus() and isConnected, so the tests need no DOM.
 */
import { FARAH_SHELL_BREAKPOINT_PX } from "./launcher-rules";

export interface FocusableLike {
  focus(options?: { preventScroll?: boolean }): void;
  /** Absent means "assume still on the page". */
  isConnected?: boolean;
}

export interface SheetState<T extends FocusableLike = FocusableLike> {
  open: boolean;
  /** The element that opened the sheet, or null when it was opened by code. */
  returnTo: T | null;
}

export function closedSheet<T extends FocusableLike = FocusableLike>(): SheetState<T> {
  return { open: false, returnTo: null };
}

/** Opens the sheet. Opening an open sheet keeps the FIRST opener (or adopts the new one if there was none). */
export function openSheet<T extends FocusableLike>(state: SheetState<T>, opener: T | null): SheetState<T> {
  return { open: true, returnTo: state.open ? (state.returnTo ?? opener) : opener };
}

const stillThere = (el: FocusableLike | null): el is FocusableLike => el !== null && el.isConnected !== false;

/** Closes the sheet and says where focus should go: the opener, else the fallback, else nowhere. A sheet that is not open takes no focus. */
export function closeSheet<T extends FocusableLike>(state: SheetState<T>, fallback: T | null): { state: SheetState<T>; focusTarget: T | null } {
  if (!state.open) return { state, focusTarget: null };
  const target = stillThere(state.returnTo) ? state.returnTo : stillThere(fallback) ? fallback : null;
  return { state: closedSheet<T>(), focusTarget: target };
}

export interface SheetKeyInput {
  key: string;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

/** What a key press does to the sheet: only Escape on an open sheet closes it. */
export function sheetKeyAction(event: SheetKeyInput, open: boolean): "close" | "none" {
  return open && event.key === "Escape" && !event.isComposing && !event.defaultPrevented ? "close" : "none";
}

/** True when the tap's target is the scrim element itself. */
export function isScrimTap(target: unknown, scrim: unknown): boolean {
  return target !== null && target !== undefined && target === scrim;
}

/** An open sheet closes once the width reaches the shell breakpoint; anything else (a phone width, a width that is not a number) leaves it as it is. */
export function sheetForWidth<T extends FocusableLike>(state: SheetState<T>, widthPx: number): SheetState<T> {
  if (!state.open) return state;
  return typeof widthPx === "number" && Number.isFinite(widthPx) && widthPx >= FARAH_SHELL_BREAKPOINT_PX ? closedSheet<T>() : state;
}
