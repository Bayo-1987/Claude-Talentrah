import Link from "next/link";
import { cn } from "@/lib/cn";
import { TRACKER_STAGES } from "@/lib/tracker/stages";

/** "All" is a filter, not a stage, so it is added in front of the shared list here. */
const STAGES: ReadonlyArray<{ key: string; label: string }> = [{ key: "all", label: "All" }, ...TRACKER_STAGES];

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
              "flex min-h-10 items-center border-b-[2.5px] px-2 font-body text-[13.5px] font-bold no-underline",
              stage === s.key
                ? "border-rust text-ink"
                : "border-transparent text-ink-soft",
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
