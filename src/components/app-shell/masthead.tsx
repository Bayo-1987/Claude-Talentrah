"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { signOutAction } from "@/lib/auth/actions";

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
}

export function Masthead({ creditsBalance, initials }: MastheadProps) {
  const pathname = usePathname();

  return (
    /*
      The `sticky` lives on this component's WRAPPER in (app)/layout.tsx, not
      here — see the note there. Putting it on this div looked right, built
      clean, and did nothing: measured at top:-2500 after a 2500px scroll.
    */
    <div className="border-b-[2.5px] border-ink bg-paper">
      <div className="flex h-[68px] items-center justify-between px-8">
        <div className="flex items-center gap-9">
          {/*
            min-h-10 on the brand link, not on the image. The mark itself is
            24/32px by design and stays that size; the LINK around it grows to
            40, which inside a 68px flex-centred bar changes nothing visually
            and everything about the tap.
          */}
          <Link href="/jobs" className="flex min-h-10 flex-shrink-0 items-center no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, next/image's optimizer needs SVG allow-listing for no real benefit here */}
            <img
              src="/talentrah-horizontal.svg"
              alt="Talentrah"
              width={320}
              height={80}
              className="h-6 w-auto flex-shrink-0 min-[480px]:h-8"
            />
          </Link>
          <nav className="flex items-center gap-5.5">
            {NAV_LINKS.map((link) => {
              const active = pathname?.startsWith(link.href);
              /*
               * Feedback carries the page you left. It is the only column on
               * `feedback` that says anything about context, and without this
               * every row would read "/feedback" — the form's own path, which
               * tells a reader nothing. The page re-validates it; this is a
               * convenience, not a trusted input.
               */
              const href =
                link.href === "/feedback" && pathname && pathname !== "/feedback"
                  ? `${link.href}?from=${encodeURIComponent(pathname)}`
                  : link.href;
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
                    active ? "border-rust text-rust" : "border-transparent hover:text-rust-hover",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3.5">
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
          <span className="inline-flex min-h-10 items-center border border-line px-2.5 text-[12.5px] text-ink-soft">
            EN
          </span>
          <Link
            href="/billing"
            className="inline-flex min-h-10 items-center bg-rust-soft px-3.5 text-[13px] font-bold text-rust no-underline hover:bg-[oklch(87%_0.04_40)]"
          >
            {creditsBalance} credits · Top up
          </Link>
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-ink font-display text-[12px] font-bold text-paper">
            {initials}
          </div>
          <form action={signOutAction}>
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
