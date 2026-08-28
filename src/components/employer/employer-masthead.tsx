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
 * Three of those five are Phase 2 by CLAUDE.md's own phasing section. They are
 * OMITTED here, not shipped as disabled "coming soon" items.
 *
 * Why omit rather than stub: PR #16 did a full pass removing every place the
 * site implied an unshipped feature existed, and three dead entries out of
 * five turns the primary nav into mostly signposts to nothing — an employer
 * clicking "Billing" and finding a placeholder learns the product is thinner
 * than it looks, which is the exact impression that pass was correcting.
 *
 * There IS repo precedent the other way (§6.5 stubs a disabled "book a mentor"
 * hand-off for Phase 3), and it is a reasonable call — but that is one
 * in-context affordance inside a working screen, not a third of the top-level
 * navigation. When Ad Campaigns, Billing and Analytics ship, they slot in
 * here; nothing about this layout has to change to accommodate them.
 */
const NAV_LINKS = [
  { href: "/employer/jobs", label: "Jobs Posted" },
  { href: "/employer/profile", label: "Company Profile" },
  { href: "/employer/campaigns", label: "Ad Campaigns" },
];

export function EmployerMasthead({ orgInitials, orgName }: { orgInitials: string; orgName: string }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  /*
   * 640, NOT the seeker masthead's 760 — measured rather than inherited.
   *
   * That side needed 728px because it carries seven nav links; this one has
   * three, and the numbers are not close:
   *
   *     width   page overflows?   nav link text
   *      360    yes (379px)       wrapped to two lines
   *      390    no                wrapped
   *      412    no                wrapped
   *      560    no                wrapped
   *      640    no                one line
   *
   * So the page only breaks below ~380, but the nav is visibly squeezed all
   * the way to 640 — "Company Profile" rendered 59px wide over two lines
   * instead of 103px over one. 640 is where it stops being cramped, and it is
   * already a breakpoint this codebase uses. Copying 760 across would have
   * hidden a nav that fits perfectly well from 640 to 759.
   */
  useEffect(() => {
    if (!navOpen) return;
    function onPointer(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setNavOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
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
        <div className="flex items-center gap-4 min-[640px]:gap-9">
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
          <nav className="hidden items-center gap-5.5 min-[640px]:flex">
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
            The same three links behind a disclosure below 640, with the same
            contract as the seeker masthead and the feed's card menus: outside
            click and Escape both close.
          */}
          <div ref={navRef} className="relative flex items-center min-[640px]:hidden">
            <button
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
          <Link
            href="/jobs"
            className="hidden min-h-10 items-center text-[13px] font-semibold text-ink-soft no-underline underline-offset-2 hover:text-rust hover:underline min-[900px]:inline-flex"
          >
            Looking for work?
          </Link>
          <div
            className="flex h-[34px] w-[34px] items-center justify-center bg-ink font-display text-[12px] font-bold text-paper"
            title={orgName}
          >
            {orgInitials}
          </div>
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
              className="inline-flex min-h-10 min-w-10 items-center justify-center text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
