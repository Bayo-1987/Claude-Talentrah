"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FarahLauncherView } from "@/components/app-shell/farah-launcher-view";
import { FarahSheetFrame } from "@/components/app-shell/farah-sheet-frame";
import { isTextEntryElement, keyboardIsOpen } from "@/lib/farah/keyboard-open";
import { FARAH_SHELL_BREAKPOINT_PX, INITIAL_LAUNCHER_STATE, farahLauncherAllowedFor, isPhoneWidth, launcherReducer } from "@/lib/farah/launcher-rules";
import { hasSeenLauncher, markLauncherOpened, markLauncherPillShown } from "@/lib/farah/launcher-seen";
import { closeSheet, closedSheet, isScrimTap, openSheet, sheetForWidth, sheetKeyAction, type SheetState } from "@/lib/farah/launcher-sheet";
import { FARAH_OPEN_SHEET_EVENT, type OpenSheetDetail } from "@/lib/farah/scroll-to-panel";

/**
 * The state behind the phone launcher and the Farah bottom sheet. It wraps the ONE mounted FarahPanel (children) and adds, below 760px only, the launcher, the scrim and the sheet behaviour.
 *
 *  - OPEN: the launcher, or any other entry through scrollToFarahPanel (the event below). Opening focuses the sheet, locks the page behind it and, if the entry brought a follow-up (a job's
 *    seed), runs that after the sheet has painted, so the panel's own arrival focus lands on something visible.
 *  - CLOSE: the Close button, Escape (not while composing text, not if an inner widget already handled it), a tap on the scrim itself, a client navigation, or the window reaching 760px (the
 *    docked panel takes over). Focus returns to whatever opened the sheet, else to the launcher (launcher-sheet.ts holds those rules).
 *  - BEHIND: while open, the masthead, the content column, the install strip and the launcher are `inert` and the page cannot scroll. Both are undone on close and on unmount.
 *  - THE PILL: collapsed on the server and on the first client render; after mount it expands once if this browser has never opened Farah (launcher-seen.ts: one localStorage key, nothing
 *    sent anywhere). Opening Farah collapses it for good.
 *  - THE KEYBOARD: while a text field has focus and the visual viewport has lost 150px or more, the launcher hides (keyboard-open.ts), so it can never sit on what is being typed.
 *  - WHERE: not on the four deny-listed pages (launcher-rules.ts). The sheet itself stays available through scrollToFarahPanel on those pages.
 *
 * Nothing here sends anything, stores anything but the one local key, or reads an account.
 */
const BEHIND = ['[data-testid="masthead-band"]', '[data-testid="content-column"]', '[data-testid="install-strip"]'];

export function FarahSheetHost({ children, hasUnreadNotification = false }: { children: ReactNode; hasUnreadNotification?: boolean }) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<SheetState<HTMLElement>>(() => closedSheet<HTMLElement>());
  const [launcher, dispatch] = useReducer(launcherReducer, INITIAL_LAUNCHER_STATE);
  const [keyboard, setKeyboard] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const afterRef = useRef<(() => void) | null>(null);

  const open = useCallback((opener: HTMLElement | null, after?: () => void) => {
    afterRef.current = after ?? null;
    markLauncherOpened();
    dispatch({ type: "opened" });
    setSheet((s) => openSheet(s, opener));
  }, []);

  const close = useCallback(() => {
    setSheet((s) => {
      const { state, focusTarget } = closeSheet(s, launcherRef.current);
      // After the sheet is closed and visible again to focus, not during this update.
      if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
      return state;
    });
  }, []);

  // The pill: decide after mount, from the one local value. Deferred out of the effect body, like the rest of the shell's reads.
  useEffect(() => {
    Promise.resolve().then(() => {
      const seen = hasSeenLauncher();
      dispatch({ type: "mounted", seen });
      if (!seen) markLauncherPillShown();
    });
  }, []);

  // Every way into Farah on a phone: scrollToFarahPanel dispatches this and the host answers.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<OpenSheetDetail>).detail;
      if (!detail || !isPhoneWidth(window.innerWidth)) return;
      detail.handled = true;
      const opener = detail.opener instanceof HTMLElement && detail.opener !== document.body ? detail.opener : null;
      open(opener, detail.after);
    }
    window.addEventListener(FARAH_OPEN_SHEET_EVENT, onOpen);
    return () => window.removeEventListener(FARAH_OPEN_SHEET_EVENT, onOpen);
  }, [open]);

  // Once the sheet is open: focus it, then run the follow-up after a frame (the sheet is painted and visible by then).
  useEffect(() => {
    if (!sheet.open) return;
    frameRef.current?.focus({ preventScroll: true });
    const after = afterRef.current;
    afterRef.current = null;
    if (!after) return;
    const id = requestAnimationFrame(() => after());
    return () => cancelAnimationFrame(id);
  }, [sheet.open]);

  // Escape, and the window growing to the docked layout.
  useEffect(() => {
    if (!sheet.open) return;
    function onKey(e: KeyboardEvent) {
      if (sheetKeyAction({ key: e.key, isComposing: e.isComposing, defaultPrevented: e.defaultPrevented }, true) === "close") close();
    }
    const wide = window.matchMedia(`(min-width: ${FARAH_SHELL_BREAKPOINT_PX}px)`);
    function onWide() {
      setSheet((s) => sheetForWidth(s, window.innerWidth));
    }
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [sheet.open, close]);

  // The page behind a modal dialog: unreachable and unscrollable while it is open, restored exactly on close.
  useEffect(() => {
    if (!sheet.open) return;
    const touched: Element[] = [];
    for (const selector of BEHIND) {
      for (const el of document.querySelectorAll(selector)) {
        if (!el.hasAttribute("inert")) {
          el.setAttribute("inert", "");
          touched.push(el);
        }
      }
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const el of touched) el.removeAttribute("inert");
      document.body.style.overflow = previous;
    };
  }, [sheet.open]);

  // A client navigation (a link inside the panel, say) closes the sheet; the new page starts with it closed. Adjusted while rendering so there is no frame of the old state.
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    if (sheet.open) setSheet(closedSheet<HTMLElement>());
  }

  // The soft keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function check() {
      const viewport = window.visualViewport;
      if (!viewport) return;
      setKeyboard(keyboardIsOpen({ layoutHeight: window.innerHeight, visualHeight: viewport.height, textFieldFocused: isTextEntryElement(document.activeElement), scale: viewport.scale }));
    }
    vv.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      vv.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);

  const showLauncher = farahLauncherAllowedFor(pathname);

  return (
    <>
      <FarahSheetFrame
        open={sheet.open}
        onClose={close}
        frameRef={frameRef}
        scrimRef={scrimRef}
        onScrimTap={(e) => {
          if (isScrimTap(e.target, scrimRef.current)) close();
        }}
      >
        {children}
      </FarahSheetFrame>
      {showLauncher && (
        <>
          {/*
            THE RESERVE, in flow and at the end of the page, below 760px: the launcher is fixed, so without it the last of the page (the Farah panel used to be the last thing) could sit under it. The
            action rows that hold Apply reserve the same column sideways (data-farah-avoid) for the places it can float over mid-page.
          */}
          <div aria-hidden="true" data-testid="farah-launcher-spacer" style={{ height: "calc(72px + env(safe-area-inset-bottom))" }} className="min-[760px]:hidden print:hidden" />
          <FarahLauncherView
            expanded={launcher.expanded}
            concealed={keyboard}
            open={sheet.open}
            hasUnreadNotification={hasUnreadNotification}
            buttonRef={launcherRef}
            onClick={() => open(launcherRef.current)}
          />
        </>
      )}
    </>
  );
}
