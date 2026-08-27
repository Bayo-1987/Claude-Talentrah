import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  { key: "recommended", label: "Recommended" },
  { key: "external", label: "External Jobs" },
  { key: "recent", label: "Most Recent" },
  { key: "saved", label: "Saved Jobs" },
] as const;

export function FeedTabs({ active }: { active: string }) {
  return (
    <div className="flex items-center gap-6">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/jobs?tab=${tab.key}`}
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
            active === tab.key
              ? "border-rust text-ink"
              : "border-transparent text-ink-soft",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
