"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";

/**
 * The account menu behind the avatar, shared by the seeker header (src/components/app-shell/masthead.tsx) and the employer header (src/components/employer/employer-masthead.tsx).
 * One component, because the two headers promise the same thing: the avatar is the account control, and Sign out lives inside it.
 *
 * It used to be written out in the seeker header only, with a standalone Sign out link next to a bare avatar in the employer one. A standalone Sign out put the single most destructive
 * action in the bar permanently one stray click away; behind a disclosure it takes an intent to open and then an intent to choose.
 *
 * What the two headers differ in is passed in, not copied:
 *   - `size`: "default" keeps the seeker's 40px button and 40px items (CLAUDE.md's 40x40 rule); "large" is 44px for the employer header, whose menu is also used on a phone.
 *   - `avatarClassName` / `avatarTitle`: the seeker's avatar is a circle of the user's initials; the employer's is the organisation's square badge, with the organisation's name as its title.
 *   - `settingsHref`: both go to /settings. There is no employer-only settings page; /settings is account-level (profile, notifications, sign-out scopes) and works for an employer's account.
 *
 * Same contract as the Farah and Report menus: outside click and Escape both close. Focus moves into the panel on open, and goes back to the avatar button on a close that does not itself
 * navigate (Escape, outside click); a link click just closes the menu so Next.js's own navigation focus is not fought.
 */
export interface AccountMenuProps {
  /** What the avatar shows. */
  initials: string;
  /** The account's own address. Shown in the menu when there is one; never put in a URL and never logged. */
  email: string;
  /** First + last, or "" when the profile has neither (the common case): then the email stands alone. */
  displayName: string;
  settingsHref?: string;
  size?: "default" | "large";
  /** Classes of the avatar itself (the 34px circle or badge); the default is the seeker's circle. */
  avatarClassName?: string;
  /** The avatar's hover title (the employer header puts the organisation's name here). */
  avatarTitle?: string;
}

const SEEKER_AVATAR = "flex h-[34px] w-[34px] items-center justify-center rounded-full bg-ink font-display text-[12px] font-bold text-paper";

const SIZES = {
  default: { button: "h-10 w-10", item: "min-h-10" },
  large: { button: "h-11 w-11", item: "min-h-11" },
} as const;

export function AccountMenu({ initials, email, displayName, settingsHref = "/settings", size = "default", avatarClassName = SEEKER_AVATAR, avatarTitle }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sizes = SIZES[size];

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel on open, and back to the trigger on a close that doesn't itself navigate (Escape, outside click) rather than leaving it to fall back to <body>.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        // Deferred a tick: the browser's own default action for this mousedown (reassigning focus to the click target) runs AFTER event listeners and would clobber a synchronous focus() here.
        setTimeout(() => triggerRef.current?.focus(), 0);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      {/* The circle or badge keeps its design size; the BUTTON around it is the hit target (CLAUDE.md makes the target size a hard rule). */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex ${sizes.button} items-center justify-center`}
      >
        <span className={avatarClassName} title={avatarTitle}>
          {initials}
        </span>
      </button>

      {open && (
        <div role="menu" className="absolute top-[calc(100%+8px)] right-0 z-20 w-[248px] border-[1.5px] border-ink bg-card">
          {/*
            Identity block. The name renders only when there is one (absent is the norm: most profiles have none), the email only when there is one, and the whole block only when there is
            something in it, so an empty padded row never appears. The email carries `break-all`: an address longer than 248px would otherwise widen the menu or spill past its border.
          */}
          {(displayName || email) && (
            <>
              <div className="flex flex-col gap-0.5 px-4 py-3">
                {displayName && <span className="font-display text-[15px] font-semibold text-ink">{displayName}</span>}
                {email && <span className="text-[12.5px] break-all text-ink-soft">{email}</span>}
              </div>
              <div className="border-t border-line" />
            </>
          )}

          {/* One item, not two. Notifications and profile both live at /settings today, and two labels pointing at one page is a menu that lies about what it can do. */}
          <Link
            href={settingsHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={`flex ${sizes.item} items-center px-4 text-[13px] font-semibold text-ink no-underline hover:text-rust`}
          >
            Settings
          </Link>

          <div className="border-t border-line" />

          <form action={signOutAction}>
            <button type="submit" role="menuitem" className={`flex ${sizes.item} w-full items-center px-4 text-left text-[13px] font-semibold text-ink-soft hover:text-rust`}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
