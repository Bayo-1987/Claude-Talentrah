"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { signOutAction } from "@/lib/auth/actions";

/**
 * NAV SCOPE — a deliberate divergence from CLAUDE.md's information
 * architecture, called out rather than left ambiguous.
 *
 * §5 lists the employer nav as:
 *   Jobs Posted · Company Profile · Ad Campaigns · Billing · Analytics
 *
 * Three of those five were Phase 2 by CLAUDE.md's own phasing section, and
 * were OMITTED here rather than shipped as disabled "coming soon" items —
 * see PR #16's own reasoning, which this comment used to spell out in full:
 * a nav full of dead entries teaches an employer the product is thinner than
 * it looks. That precedent is exactly why Analytics slots back in only now
 * (0128) that `/employer/analytics` is a real page reading real
 * `ad_events` rows, not a placeholder.
 *
 * Billing is still omitted for the same reason Analytics was until now —
 * nothing behind that label is real yet. When it ships, it slots in here
 * the same way; nothing about this layout has to change to accommodate it.
 */
const NAV_LINKS = [
  { href: "/employer/jobs", label: "Jobs Posted" },
  { href: "/employer/profile", label: "Company Profile" },
  { href: "/employer/campaigns", label: "Ad Campaigns" },
  { href: "/employer/analytics", label: "Analytics" },
  { href: "/employer/talent-directory", label: "Talent Directory" },
];

export function EmployerMasthead({
  orgInitials,
  orgName,
}: {
  /** Null before the organisation exists — the badge is omitted, not filled in. */
  orgInitials: string | null;
  orgName: string;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);

  /*
   * 1200, NOT 640 — re-measured (send-388), not inherited from this
   * comment's own stale history.
   *
   * 640 was correct once, for THREE links. Analytics (0128) and Talent
   * Directory (0135) brought NAV_LINKS to five, and nobody re-derived the
   * breakpoint — this comment kept saying "three, and the numbers are not
   * close" long after the array itself said otherwise. A prior attempt to
   * fix this (PR #388, "send-219 phase 1") measured a real 1185px crossover
   * and raised the breakpoint to 1280 — but it was written against the
   * Sunbird design system, reverted back to Editorial the same day (PR
   * #395), and closed unmerged as moot. Its DIAGNOSIS was right; its patch
   * no longer applied. Re-measured fresh against current Editorial markup,
   * signed in as an org owner, via a Range over each link's TEXT content
   * (not the link's own box — `min-h-10` stays 40px whether the label wraps
   * or not, so a box-height check would have missed this the same way it
   * did on the right-hand group, see this file's other breakpoint comment
   * below):
   *
   *     width   wraps?
   *      640     yes
   *      700     yes
   *      768     yes
   *      800     yes
   *      850     no   <- an isolated gap, not a real threshold
   *      900     yes
   *      950     yes
   *      975     yes
   *      985     yes
   *      990     no   <- first width in a CONTINUOUS clean run
   *     1024     no
   *     1150     no
   *     1200     no
   *
   * Non-monotonic, not a clean step function — "Jobs Posted"/"Company
   * Profile"/"Ad Campaigns"/"Talent Directory" wrap and un-wrap across
   * several nearby widths before finally settling clean at 990 and staying
   * clean afterward ("Analytics", the one single-word label, never wraps).
   * That instability is exactly why a threshold picked from the first clean
   * width found (850, or even 990 itself) would be fragile — a single-digit
   * pixel margin has already burned this codebase twice (the seeker
   * masthead's 700px and 2xl breakpoints, both re-measured after passing
   * with 0px margin on CI's Linux runner, where font metrics render this
   * exact row wider than they do here).
   *
   * 1200 — not a fresh number, the SAME value the right-hand group's own
   * breakpoint below already uses (send-442) — buys 210px of real margin
   * over the measured 985px crossover, keeps this masthead down to a single
   * "desktop layout" threshold instead of two adjacent almost-matching
   * magic numbers, and was confirmed to still leave 67px of clearance
   * between this nav's last link and the right-hand group at exactly 1200px
   * (measured live, not assumed from the numbers alone).
   */
  useEffect(() => {
    if (!navOpen) return;
    /*
     * Same focus contract as the seeker masthead's disclosures (see that
     * file's own comment): move focus into the panel on open, since nothing
     * here did, and return it to the trigger on a close that doesn't itself
     * navigate — Escape or an outside click — rather than let it fall back
     * to <body> once the focused panel unmounts. A link click still just
     * closes the menu with no forced refocus, so Next.js's own
     * navigation-focus behaviour isn't fought.
     */
    navRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    function onPointer(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setNavOpen(false);
        /*
         * Deferred a tick, matching masthead.tsx's identical fix: the
         * browser's own default action for this mousedown (reassigning
         * focus based on the click target, which runs AFTER event
         * listeners) would otherwise clobber a synchronous .focus() call
         * here — measured, not assumed, against a non-focusable outside
         * target. setTimeout(0) runs after that default action settles.
         */
        setTimeout(() => navTriggerRef.current?.focus(), 0);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNavOpen(false);
        navTriggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  return (
    <div data-testid="employer-masthead" className="border-b-[2.5px] border-ink bg-paper">
      <div className="flex h-[68px] items-center justify-between px-8">
        <div className="flex items-center gap-4 min-[1200px]:gap-9">
          <Link href="/employer/jobs" className="flex flex-shrink-0 items-center no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, matches Masthead */}
            <img
              src="/talentrah-horizontal.svg"
              alt="Talentrah"
              width={320}
              height={80}
              className="h-6 w-auto flex-shrink-0 min-[480px]:h-8"
            />
          </Link>
          <span className="hidden border border-line px-2 py-1 font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase min-[900px]:inline-block">
            For employers
          </span>
          <nav className="hidden items-center gap-5.5 min-[1200px]:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    /*
                     * The active classes live in an ELSE branch, not on top of a base
                     * that already sets the same properties.
                     *
                     * `cn` in this repo is a plain join, not tailwind-merge, so a base
                     * `border-transparent text-ink-soft` and a conditional
                     * `border-rust text-ink` BOTH reach the class attribute. Equal
                     * specificity means the stylesheet's own order decides, and the
                     * base wins both times: measured `borderBottomColor rgba(0,0,0,0)`
                     * and `color` still ink-soft on the ACTIVE tab. The active state
                     * was rendering identically to the inactive ones.
                     */
                    "flex min-h-10 items-center border-b-[2.5px] font-body text-[14.5px] font-semibold text-ink no-underline",
                    active
                      ? "border-rust text-rust"
                      : "border-transparent hover:text-rust-hover",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/*
            The same five links behind a disclosure below 1200 (was 640 —
            see the nav's own breakpoint comment above for why), with the
            same contract as the seeker masthead and the feed's card menus:
            outside click and Escape both close.
          */}
          <div ref={navRef} className="relative flex items-center min-[1200px]:hidden">
            <button
              ref={navTriggerRef}
              type="button"
              aria-expanded={navOpen}
              aria-haspopup="menu"
              aria-label="Main menu"
              onClick={() => setNavOpen((o) => !o)}
              className="inline-flex h-10 w-10 items-center justify-center"
            >
              <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
                <path
                  d="M1 1h16M1 7h16M1 13h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {navOpen && (
              <div
                role="menu"
                data-testid="employer-nav-menu"
                className="absolute top-[calc(100%+8px)] left-0 z-20 w-[240px] border-[1.5px] border-ink bg-card"
              >
                {NAV_LINKS.map((link) => {
                  const active = pathname?.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      role="menuitem"
                      onClick={() => setNavOpen(false)}
                      className={cn(
                        "flex min-h-11 items-center px-4 font-body text-[14px] font-semibold no-underline",
                        active ? "text-rust" : "text-ink hover:text-rust",
                      )}
                    >
                      {link.label}
                    </Link>
                  );
                })}

                {/*
                  Both of these are hidden above 900px in the bar and would
                  otherwise have nowhere to live on a phone. "For employers" is
                  a label rather than a link, so it is not a menu item — the
                  seeker-side equivalent of "Post a job" is, and gets one.
                */}
                <div className="border-t border-line" />
                <Link
                  href="/jobs"
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className="flex min-h-11 items-center px-4 font-body text-[14px] font-semibold text-ink-soft no-underline hover:text-rust"
                >
                  Looking for work?
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          {/*
            MEASURED, NOT 900 — a real git-stash A/B test (send-442) found
            "Looking for work?" and "Sign out" wrapping onto two lines at
            1024px, clean at 1160px, with the LEFT nav (already showing from
            640px) and this chip's own min-[900px] reveal never checked
            together. Swept the actual combined-width interaction in 4-20px
            steps, logged in signed in as the demo org owner (so the
            orgInitials badge is present, the widest right-hand-group state):

                width   "Looking for work?" / "Sign out"
                 900    wrapped
                1024    wrapped
                1120    wrapped
                1128    wrapped
                1132    wrapped
                1136    clean          <- crossover
                1140    clean
                1160    clean

            Confirmed identical under `next build && next start`, not just
            `next dev`, per this repo's own dev/prod e2e divergence history.

            1136 is the true crossover, but a threshold that only just fits
            is the state this repo has been burned by twice already (the
            seeker masthead's 700px and 2xl breakpoints, both derived after a
            single-digit-pixel margin measured 0 on CI's Linux runner —
            different font metrics render this row wider there). 1200 buys
            ~64px over the measured crossover rather than shipping the bare
            number. Below 1200 this chip stays hidden — "Looking for work?"
            is already unreachable in the bar between 640px (where the left
            nav's own hamburger disappears) and this breakpoint; that gap
            already existed below 900px before this fix and widening it
            slightly is the accepted trade-off here, not a new dead zone —
            fixing THAT is a nav redesign, out of scope for a width-fit bug.

            whitespace-nowrap on this and "Sign out" below is the second half
            of the fix: it stops the flex row from shrinking either box below
            its content width, so a future breakpoint-vs-nav collision
            overflows visibly (easy to catch — e.g. by
            e2e/employer-masthead-nav-fit.spec.ts's own text-wrap check)
            instead of silently reflowing into two lines the way this bug did.
          */}
          <Link
            href="/jobs"
            className="hidden min-h-10 items-center whitespace-nowrap bg-rust-soft px-3.5 text-[13px] font-bold text-rust no-underline hover:bg-[oklch(87%_0.04_40)] min-[1200px]:inline-flex"
          >
            Looking for work?
          </Link>
          {/*
            Omitted entirely when there is no organisation yet, which is the
            normal state on /employer/onboarding. See the layout for why a
            placeholder character was worse than nothing.
          */}
          {orgInitials && (
            <div
              className="flex h-[34px] w-[34px] items-center justify-center bg-ink font-display text-[12px] font-bold text-paper"
              title={orgName}
            >
              {orgInitials}
            </div>
          )}
          <form action={signOutAction}>
            {/*
              min-h-10 min-w-10, which it did not have. Measured at 46 x 20 on
              this masthead — under CLAUDE.md's 40x40 rule, and missed by
              app-chrome.spec.ts because that sweep only walks the SEEKER
              masthead and the Farah panel. Found while porting the mobile
              treatment; fixed here rather than left for the next person to
              measure again.
            */}
            <button
              type="submit"
              className="inline-flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
