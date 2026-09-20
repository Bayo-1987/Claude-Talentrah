"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui";

const NAV_LINKS = [
  { href: "/#jobs", label: "Browse Jobs" },
  { href: "/#farah", label: "Meet Farah" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#faqs", label: "FAQs" },
];

/**
 * Marketing-site masthead for the signed-out landing page. Visually the same
 * masthead language as the signed-in app shell (src/components/app-shell/masthead.tsx)
 * — sticky, Newsreader logo, bordered — but a separate component since the
 * nav here is anchor-based (in-page sections) rather than route-based, and
 * there's no signed-in user to read credits/initials from.
 *
 * Below 900px the bar hid the four nav links with NO replacement at all — no
 * hamburger, no drawer, nothing. The target market skews low-end Android
 * (CLAUDE.md's non-functional requirements), so that breakpoint is exactly
 * where most first-time signed-out visitors land, and "Browse Jobs" / "Meet
 * Farah" / "How it works" / "FAQs" were simply unreachable for them. This
 * ports the same disclosure pattern already proven in both signed-in
 * mastheads (src/components/app-shell/masthead.tsx and
 * src/components/employer/employer-masthead.tsx) — a hamburger trigger with
 * aria-expanded/aria-haspopup="menu", a role="menu" panel, and outside-click
 * plus Escape to close — rather than inventing a third implementation.
 *
 * Complementary breakpoint to the bar's own `max-[900px]:hidden`: the
 * disclosure is `min-[900px]:hidden`, so exactly one of the two renders at
 * any width, with no gap and no overlap.
 */
export function MarketingMasthead() {
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  /*
   * Same contract as both signed-in mastheads: outside click and Escape both
   * close the disclosure. Copied rather than abstracted — three call sites
   * across two other components already didn't share this, and the anchor
   * hrefs here make this one different enough that inventing a shared hook
   * for four instances isn't worth it yet.
   */
  useEffect(() => {
    if (!navOpen) return;
    function onPointer(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setNavOpen(false);
      }
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
    <header className="sticky top-0 z-20 border-b-[2.5px] border-ink bg-paper/95 backdrop-blur-sm">
      {/*
        send-381's own skip link used to live here. It's now a single
        shared instance in the root layout (src/app/layout.tsx), rendered
        before send-406's cookie consent banner — see that file's comment
        for why. Still targets the same #main-content id this masthead's
        page always renders.
      */}
      <div className="mx-auto flex h-[78px] max-w-[1120px] items-center justify-between px-10">
        <Link href="/" className="flex flex-shrink-0 items-center no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
          <img
            src="/talentrah-horizontal.svg"
            alt="Talentrah"
            width={320}
            height={80}
            className="h-6 w-auto flex-shrink-0 min-[480px]:h-8"
          />
        </Link>

        <nav className="flex items-center gap-2 max-[900px]:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex min-h-11 items-center px-1 font-body text-[14.5px] font-semibold text-ink no-underline hover:text-rust"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/*
          The same links behind a disclosure below 900px — the bar's own
          `max-[900px]:hidden` breakpoint mirrored exactly, so this is the
          only thing rendered wherever the bar isn't.
        */}
        <div ref={navRef} className="relative flex items-center min-[900px]:hidden">
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
              className="absolute top-[calc(100%+8px)] left-0 z-20 w-[240px] border-[1.5px] border-ink bg-card"
            >
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className="flex min-h-11 items-center px-4 font-body text-[14px] font-semibold text-ink no-underline hover:text-rust"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Link href="/login" className={buttonClasses("ghost", "md", "no-underline")}>
            Log in
          </Link>
          <Link
            href="/signup"
            className={buttonClasses(
              "primary",
              "md",
              "min-h-11 px-[22px] py-[11px] text-[14px] no-underline",
            )}
          >
            Get started for free
          </Link>
        </div>
      </div>
    </header>
  );
}
