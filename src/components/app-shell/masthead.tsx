"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { signOutAction } from "@/lib/auth/actions";
import { FarahMark } from "@/components/ui/farah-mark";
import { scrollToFarahPanel } from "@/lib/farah/scroll-to-panel";

const NAV_LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/tracker", label: "Job Tracker" },
  { href: "/auto-apply", label: "Auto-Apply" },
  { href: "/resume-builder", label: "Resume Builder" },
  { href: "/scholarships", label: "Scholarships" },
  { href: "/refer", label: "Refer a Friend" },
  { href: "/feedback", label: "Feedback" },
];

export interface MastheadProps {
  creditsBalance: number;
  initials: string;
  /**
   * The account's own address. Always present — it is the login identity, so
   * unlike the name there is no case where it is missing.
   */
  email: string;
  /**
   * First + last, or "" when the profile has neither.
   *
   * Empty is the COMMON case, not an edge one: 26 of 36 production profiles
   * have no first_name at all. The menu therefore treats the name as optional
   * decoration above the email rather than as the heading the email explains —
   * rendering an empty bold line over an address looks like a failed load.
   */
  displayName: string;
}

export function Masthead({
  creditsBalance,
  initials,
  email,
  displayName,
}: MastheadProps) {
  const pathname = usePathname();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  /*
   * The nav links move behind a disclosure below `lg` (1024px), and the number
   * is measured rather than chosen.
   *
   * IT USED TO SAY 760, AND THAT WAS RIGHT ABOUT THE WRONG THING. The 728px
   * figure this comment carried was the masthead's intrinsic width with the nav
   * HIDDEN — brand, hamburger and the right-hand group — measured at 360/390/412
   * where nothing shrinks. It correctly justified 760 as the width at which the
   * COLLAPSED bar stops scrolling the document sideways. It said nothing about
   * whether the EXPANDED nav fits there, and it does not: the list has since
   * grown to seven items, Scholarships among them.
   *
   * What actually happens between 760 and ~920 is that the left group is
   * flex-shrunk and its links spill out of their own boxes over the right-hand
   * group. The document never overflows, so nothing catches it — measured, with
   * the painted text extent rather than the link box, because the boxes stop
   * moving at 684px while the text inside keeps going:
   *
   *     width   text vs credits pill   text vs EN chip
   *      760          +87px                 +138px
   *      845           +7px                  +58px
   *      900          -38px                  +13px
   *      920          -54px                   -4px
   *     1024          -98px                  -48px
   *
   * So 845 — where the pill clears — is not the answer either; it just swaps
   * which element is underneath. The nav does not clear everything in the right
   * group until roughly 920.
   *
   * AND 1024 IS NOT ENOUGH EITHER, which the regression test caught after this
   * comment first said it was. Measuring against the EN chip and the credits
   * pill missed the element that is actually leftmost in the right-hand group:
   * "Post a job" appears at 900 and sits left of both. Against IT:
   *
   *     width   text vs "Post a job"
   *     1024          -7px      still overlapping
   *     1120          -2px
   *     1160           0px      touching
   *     1200         +30px
   *     1280        +110px
   *
   * The nav stops being flex-shrunk at about 1200, where its text finally ends
   * at its natural 834px. `xl` is the smallest breakpoint already used here that
   * clears that with room — 110px rather than 30 — and the margin is the point:
   * this bug exists BECAUSE a seventh nav item was added, so a threshold that
   * only just fits is a threshold that breaks on the next one.
   *
   * The cost is that 760-1279 gets the disclosure instead of the bar. That is
   * acceptable only because the disclosure is COMPLETE — every nav link plus
   * "Post a job", which would otherwise be unreachable at those widths since it
   * lives in the right-hand group. e2e/masthead-nav-fit.spec.ts asserts both:
   * the gap at every width the bar renders, and that nothing is stranded below.
   */
  useEffect(() => {
    if (!navOpen) return;
    function onPointer(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node))
        setNavOpen(false);
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

  /**
   * Feedback carries the page you left; every other link is itself.
   *
   * Extracted because the mobile menu renders the same list and the rule must
   * not be written twice — two copies is how one of them ends up pointing at
   * a bare /feedback that tells a reader nothing.
   */
  function hrefFor(link: { href: string; label: string }) {
    return link.href === "/feedback" && pathname && pathname !== "/feedback"
      ? `${link.href}?from=${encodeURIComponent(pathname)}`
      : link.href;
  }

  /*
   * Same contract as the Farah and Report menus: outside click and Escape both
   * close. Copied deliberately rather than abstracted — three call sites is
   * not yet a component, and this one differs in what it closes over.
   */
  useEffect(() => {
    if (!accountOpen) return;
    function onPointer(e: MouseEvent) {
      if (
        accountRef.current &&
        !accountRef.current.contains(e.target as Node)
      ) {
        setAccountOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  return (
    /*
      The `sticky` lives on this component's WRAPPER in (app)/layout.tsx, not
      here — see the note there. Putting it on this div looked right, built
      clean, and did nothing: measured at top:-2500 after a 2500px scroll.
    */
    <div
      data-testid="masthead"
      className="border-b-[2.5px] border-ink bg-paper"
    >
      <div className="flex h-[68px] items-center justify-between px-8">
        <div className="flex items-center gap-4 xl:gap-9">
          {/*
            min-h-10 on the brand link, not on the image. The mark itself is
            24/32px by design and stays that size; the LINK around it grows to
            40, which inside a 68px flex-centred bar changes nothing visually
            and everything about the tap.
          */}
          <Link
            href="/jobs"
            className="flex min-h-10 flex-shrink-0 items-center no-underline"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
            <img
              src="/talentrah-horizontal.svg"
              alt="Talentrah"
              width={320}
              height={80}
              className="h-6 w-auto flex-shrink-0 min-[480px]:h-8"
            />
          </Link>
          <nav className="hidden items-center gap-5.5 xl:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname?.startsWith(link.href);
              const href = hrefFor(link);
              return (
                <Link
                  key={link.href}
                  href={href}
                  className={cn(
                    // min-w-10 as well as min-h-10. Height alone is what let a
                    // 39.1px-wide target through review in #69, and "Jobs"
                    // measured 29.5 x 40 here — the same shape, in the one
                    // component every signed-in page renders.
                    "flex min-h-10 min-w-10 items-center justify-center border-b-[2.5px] font-body text-[14.5px] font-semibold text-ink no-underline",
                    /*
                     * `border-transparent` belongs in the INACTIVE branch, not
                     * the base — and that is a bug fix, not tidying.
                     *
                     * `cn` here is a plain join, not tailwind-merge, so a base
                     * `border-transparent` and a conditional `border-rust`
                     * both land in the class attribute. Two single-class
                     * selectors have equal specificity, so the stylesheet's
                     * own order decides, and `border-transparent` wins:
                     * measured `borderBottomColor: rgba(0,0,0,0)` on the
                     * active item. The active underline has never rendered —
                     * only the rust TEXT did, which is why it read as working.
                     *
                     * With the colour set in exactly one branch there is
                     * nothing to conflict with.
                     */
                    active
                      ? "border-rust text-rust"
                      : "border-transparent hover:text-rust-hover",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}

            {/*
              "Ask Farah" is NOT in NAV_LINKS, and that is the point rather
              than an oversight. Every entry in that list is a route, and the
              map renders each one as a <Link> with an active state derived
              from the pathname. Farah is a panel already on this page, so it
              has no href to be active for — putting it in the list would mean
              inventing a fake route or special-casing the map, and both are
              worse than one sibling element that says what it is.

              Styled to match the links either side of it, including the
              transparent bottom border, so the bar reads as one row of items
              and not as a button someone dropped into a nav. It never takes
              the rust border, because there is no page it can be "on".

              ── WHY xl AND NOT 760, WHICH IS WHAT WAS ASKED FOR ─────────────

              Because this row has NO horizontal slack at 760, measured rather
              than guessed. On main, before this item existed, the masthead's
              scrollWidth at a 760px viewport was exactly 760 — it fits, with
              nothing to spare, which is what "the breakpoint was derived from
              the 728px intrinsic width" means in practice.

              Adding a labelled item therefore overflows immediately: with this
              button at 760 the document scrollWidth measured 809, reintroducing
              the sideways scroll the 760 breakpoint exists to prevent. Worse
              and quieter, at 900 and 1024 the document did NOT overflow but
              the nav spilled out of its shrunken flex box and OVERLAPPED "Post
              a job" — `postLeft - askRight` came back as -107 and -14. A
              scrollWidth assertion would not have caught that; measuring the
              gap between the two elements did. An icon-only version was
              considered and does not help: with zero slack, 40px is still more
              than 0.

              2xl (1536), and the jump from xl is the interesting part. At 1280
              this cleared "Post a job" by 18px on macOS and by EXACTLY 0 on
              CI's Linux runner — same code, same viewport, different font
              metrics, so the same row renders about 18px wider there. An 18px
              margin that is 0 on another platform is not a margin, and real
              users are on all three platforms with their own font fallbacks
              and zoom levels. Tightening the nav's own 22px rhythm to buy the
              space back was tried and rejected: trading a global design
              property for one convenience item, and still only buying ~28px
              against variance nobody can enumerate.

              At 2xl there is ~256px of slack rather than tens of pixels, which
              survives a platform that renders wider.

              Nothing is lost below it. The Farah panel is a sticky column that
              is ON SCREEN at every width from 760 up, so this item is a
              convenience wherever it does not appear, never the only route. It
              is below 760 — where the panel stacks under the feed and off
              screen — that an affordance is actually required, and
              FarahMobileTab is that affordance.
            */}
            <button
              type="button"
              onClick={scrollToFarahPanel}
              className="hidden min-h-10 min-w-10 items-center justify-center gap-1.5 border-b-[2.5px] border-transparent font-body text-[14.5px] font-semibold text-ink hover:text-rust-hover 2xl:flex"
            >
              <FarahMark size={18} />
              Ask Farah
            </button>
          </nav>

          {/*
            The same links, behind a disclosure, under 760px. Same contract as
            the account menu below and the card menus on the feed: outside
            click and Escape both close.
          */}
          <div
            ref={navRef}
            className="relative flex items-center xl:hidden"
          >
            <button
              type="button"
              aria-expanded={navOpen}
              aria-haspopup="menu"
              aria-label="Main menu"
              onClick={() => setNavOpen((o) => !o)}
              className="inline-flex h-10 w-10 items-center justify-center"
            >
              <svg
                width="18"
                height="14"
                viewBox="0 0 18 14"
                fill="none"
                aria-hidden="true"
              >
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
                className="absolute top-[calc(100%+8px)] left-0 z-20 w-[240px] border-[1.5px] border-ink bg-card"
              >
                {NAV_LINKS.map((link) => {
                  const active = pathname?.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={hrefFor(link)}
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
                  "Post a job" is hidden above 900px in the bar and would
                  otherwise have no home at all on a phone — the one link that
                  was unreachable rather than merely cramped.
                */}
                <div className="border-t border-line" />
                <Link
                  href="/employer"
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className="flex min-h-11 items-center px-4 font-body text-[14px] font-semibold text-ink-soft no-underline hover:text-rust"
                >
                  Post a job
                </Link>
              </div>
            )}
          </div>
        </div>

        <div data-testid="masthead-actions" className="flex items-center gap-3.5">
          {/*
            CLAUDE.md §5 lists a persistent "Post Job" shortcut in the seeker
            masthead. Until the employer surface existed there was nothing to
            point it at; now there is, and without it /employer is reachable
            only by typing the URL.
          */}
          <Link
            href="/employer"
            className="hidden min-h-10 items-center text-[13px] font-semibold text-ink-soft no-underline underline-offset-2 hover:text-rust hover:underline min-[900px]:inline-flex"
          >
            Post a job
          </Link>
          <span className="hidden min-h-10 items-center border border-line px-2.5 text-[12.5px] text-ink-soft min-[760px]:inline-flex">
            EN
          </span>
          <Link
            href="/billing"
            className="inline-flex min-h-10 items-center bg-rust-soft px-3.5 text-[13px] font-bold text-rust no-underline hover:bg-[oklch(87%_0.04_40)]"
          >
            {creditsBalance} credits · Top up
          </Link>
          {/*
            The avatar is the account control now, and Sign out lives inside
            it. It used to be a bare 34px div — decoration, not a target — next
            to a standalone Sign out link, which put the single most
            destructive action in the bar permanently one stray click away.
            Behind a disclosure it takes an intent to open and then an intent
            to choose.

            The circle stays 34px because that is the design; the BUTTON around
            it is 40x40, which is the rule CLAUDE.md makes hard. Same trick the
            brand link above uses.
          */}
          <div ref={accountRef} className="relative flex items-center">
            <button
              type="button"
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              aria-label="Account menu"
              onClick={() => setAccountOpen((o) => !o)}
              className="inline-flex h-10 w-10 items-center justify-center"
            >
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-ink font-display text-[12px] font-bold text-paper">
                {initials}
              </span>
            </button>

            {accountOpen && (
              <div
                role="menu"
                className="absolute top-[calc(100%+8px)] right-0 z-20 w-[248px] border-[1.5px] border-ink bg-card"
              >
                {/*
                  Identity block. The name renders only when there is one —
                  see MastheadProps.displayName on why absent is the norm. The
                  email is always shown and carries `break-all`: an address
                  longer than 248px would otherwise widen the menu or spill
                  past its border.
                */}
                <div className="flex flex-col gap-0.5 px-4 py-3">
                  {displayName && (
                    <span className="font-display text-[15px] font-semibold text-ink">
                      {displayName}
                    </span>
                  )}
                  <span className="text-[12.5px] break-all text-ink-soft">
                    {email}
                  </span>
                </div>

                <div className="border-t border-line" />

                {/*
                  One item, not two. Notifications and profile both live at
                  /settings today, and two labels pointing at one page is a
                  menu that lies about what it can do.
                */}
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setAccountOpen(false)}
                  className="flex min-h-10 items-center px-4 text-[13px] font-semibold text-ink no-underline hover:text-rust"
                >
                  Settings
                </Link>

                <div className="border-t border-line" />

                <form action={signOutAction}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex min-h-10 w-full items-center px-4 text-left text-[13px] font-semibold text-ink-soft hover:text-rust"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
