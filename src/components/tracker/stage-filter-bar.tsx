import Link from "next/link";
import { cn } from "@/lib/cn";

const STAGES = [
  { key: "all", label: "All" },
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
] as const;

export interface StageFilterBarProps {
  stage: string;
  sort: "newest" | "oldest";
}

/** Server-rendered, no client JS — every filter/sort is a plain link updating the URL, same pattern as the Job Feed. */
export function StageFilterBar({ stage, sort }: StageFilterBarProps) {
  const nextSort = sort === "newest" ? "oldest" : "newest";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <div className="flex flex-wrap items-center gap-1">
        {STAGES.map((s) => (
          <Link
            key={s.key}
            href={s.key === "all" ? `/tracker?sort=${sort}` : `/tracker?stage=${s.key}&sort=${sort}`}
            className={cn(
              "flex min-h-10 items-center border-b-[2.5px] border-transparent px-2 font-body text-[13.5px] font-bold text-ink-soft no-underline",
              stage === s.key && "border-rust text-ink",
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
      <Link
        href={stage === "all" ? `/tracker?sort=${nextSort}` : `/tracker?stage=${stage}&sort=${nextSort}`}
        className="text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
      >
        Sort: {sort === "newest" ? "Newest first" : "Oldest first"}
      </Link>
    </div>
  );
}
