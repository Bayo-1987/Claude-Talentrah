"use client";

import Link from "next/link";
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
];

export function EmployerMasthead({ orgInitials, orgName }: { orgInitials: string; orgName: string }) {
  const pathname = usePathname();

  return (
    <div className="border-b-[2.5px] border-ink bg-paper">
      <div className="flex h-[68px] items-center justify-between px-8">
        <div className="flex items-center gap-9">
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
          <nav className="flex items-center gap-5.5">
            {NAV_LINKS.map((link) => {
              const active = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex min-h-10 items-center border-b-[2.5px] border-transparent font-body text-[14.5px] font-semibold text-ink no-underline",
                    active ? "border-rust text-rust" : "hover:text-rust-hover",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
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
            <button
              type="submit"
              className="text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
