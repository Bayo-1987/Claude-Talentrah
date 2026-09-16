"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";

const TABS = [
  { key: "recommended", label: "Recommended" },
  { key: "external", label: "External Jobs" },
  { key: "recent", label: "Most Recent" },
  { key: "saved", label: "Saved Jobs" },
] as const;

/**
 * WHY THIS IS A CLIENT COMPONENT, AND WHY jobs/(feed)/loading.tsx ALONE
 * ISN'T ENOUGH FOR A TAB CLICK
 *
 * Measured directly with a throttled real click, not assumed: the route's
 * loading.tsx engages for an actual route change into `/jobs` (masthead
 * logo, any other page), but a tab click never leaves `/jobs` — only the
 * `?tab=` search param changes — and the App Router does not run the
 * ancestor Suspense/loading boundary for a searchParams-only navigation on
 * the same segment. With 20s of throttled network given for the boundary to
 * show up, it never did; the old tab's content just sat frozen on screen for
 * the full server round trip. That is the exact "frozen tab row" symptom
 * this component exists to fix, so it needs its own feedback independent of
 * the route boundary.
 *
 * `useTransition` gives that without a data fetch of its own:
 * `setPendingTab` is a plain, synchronous state update, so React paints the
 * clicked tab's active state on the very next frame; `startTransition`
 * wraps the actual navigation so it doesn't block that paint. The tabs stay
 * real `<Link>`s with real `href`s — the click handler only intercepts a
 * plain, unmodified left-click, so middle-click / cmd-click / ctrl-click
 * ("open in new tab") and the no-JS fallback all still work exactly as
 * before.
 */
export function FeedTabs({ active }: { active: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  const displayActive = isPending && pendingTab ? pendingTab : active;

  return (
    <div className="flex items-center gap-6">
      {TABS.map((tab) => {
        const tabIsActive = displayActive === tab.key;
        return (
          <Link
            key={tab.key}
            href={`/jobs?tab=${tab.key}`}
            aria-current={tabIsActive ? "page" : undefined}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
              }
              e.preventDefault();
              setPendingTab(tab.key);
              startTransition(() => {
                router.push(`/jobs?tab=${tab.key}`);
              });
            }}
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
              "flex min-h-10 items-center border-b-[2.5px] font-body text-[13.5px] font-bold no-underline",
              tabIsActive ? "border-rust text-ink" : "border-transparent text-ink-soft",
              isPending && tab.key === pendingTab && "opacity-60",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
