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
 */
export function MarketingMasthead() {
  return (
    <div className="sticky top-0 z-20 border-b-[2.5px] border-ink bg-paper/95 backdrop-blur-sm">
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
    </div>
  );
}
