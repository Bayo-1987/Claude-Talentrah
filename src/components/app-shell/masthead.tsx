"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { signOutAction } from "@/lib/auth/actions";

// Job Tracker and Refer a Friend are M7/M9 — not built yet. Re-add them here
// once those routes actually exist (QA audit bug #6: they were linking to a
// generic, unbranded 404).
const NAV_LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/resume-builder", label: "Resume Builder" },
];

export interface MastheadProps {
  creditsBalance: number;
  initials: string;
}

export function Masthead({ creditsBalance, initials }: MastheadProps) {
  const pathname = usePathname();

  return (
    <div className="border-b-[2.5px] border-ink bg-paper">
      <div className="flex h-[68px] items-center justify-between px-8">
        <div className="flex items-center gap-9">
          <Link href="/jobs" className="flex flex-shrink-0 items-center no-underline">
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
