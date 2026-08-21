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
            "flex min-h-10 items-center border-b-[2.5px] border-transparent font-body text-[13.5px] font-bold text-ink-soft no-underline",
            active === tab.key && "border-rust text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
