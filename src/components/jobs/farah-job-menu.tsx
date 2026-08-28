"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchExplanation } from "@/lib/matching/score";
import { fitSummary, gapSkills } from "@/lib/matching/vet-summary";

/**
 * Farah's actions for ONE posting, grouped Vet → Land.
 *
 * Replaces the card's single "Ask Farah" link, which went straight to
 * /tailor. The grouping is the point: vetting a job and landing it are
 * different moments, and only the second one costs anything.
 *
 * WHY VET IS FREE AND ANSWERS INLINE. Both Vet items read
 * `match_scores.explanation` — matched skills, missing skills and a seniority
 * read, already computed algorithmically at feed-render time for the score
 * shown on the card. No model call, no credits, nothing new stored. They are
 * two framings of one stored value: "Am I a fit?" is the headline read,
 * "Gap analysis" is the itemised list.
 *
 * WHY LAND ITEMS ARE LINKS AND NOT CHAT. There is no way for a card to seed
 * Farah's docked panel — it takes only a name and its message history, and
 * /api/farah/chat takes only { message, quickAction } with no job context.
 * Building that bridge was deliberately left out of this change rather than
 * folded in quietly, so Land points at the existing credit-gated tailoring
 * flow, which is where those outputs actually come from.
 *
 * WHAT IS DELIBERATELY ABSENT: "Interview prep plan". The generic quick action
 * exists but knows nothing about this job, and a per-job menu whose item is
 * secretly job-blind undersells the whole idea. It comes back if the panel
 * bridge is ever built.
 */

export interface FarahJobMenuProps {
  jobId: string;
  explanation: MatchExplanation;
}

export function FarahJobMenu({ jobId, explanation }: FarahJobMenuProps) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<"fit" | "gap" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. A menu that traps the page is worse
  // than no menu, and this one sits inside a scrolling list of cards.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const missing = gapSkills(explanation);

  function toggleDetail(which: "fit" | "gap") {
    setDetail((d) => (d === which ? null : which));
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 items-center gap-[5px] py-2 text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
      >
        Ask Farah <span className="text-[10px]">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-[calc(100%+8px)] z-30 w-[240px] border-[1.5px] border-ink bg-card px-4 pt-3.5 pb-4"
          role="menu"
        >
          <div className="mb-[10px] flex items-center gap-[7px] text-[12.5px] font-bold text-ink">
            Discuss with Farah — this job
          </div>

          <div className="fm-group">
            <span className="mb-[7px] block text-[10.5px] font-bold tracking-[0.1em] text-rust uppercase">
              Vet
            </span>
            {/*
              min-h-10 rather than the mock's `padding: 5px 0`. CLAUDE.md makes
              a ≥40×40px hit target a hard rule and records under-sized targets
              as a real shipped bug; a 23px row in a menu aimed at low-end
              Android is exactly that bug. Everything else here is the mock's.
            */}
            <button
              type="button"
              onClick={() => toggleDetail("fit")}
              aria-expanded={detail === "fit"}
              className="block min-h-10 w-full py-[5px] text-left text-[13px] text-ink hover:text-rust hover:underline"
            >
              Am I a fit?
            </button>
            {detail === "fit" && (
              <>
              {/*
                No title, no percentage, no tier word. All three are already on
                the card this menu is anchored to, and CLAUDE.md forbids prose
                that restates the tier — naming "a good match" as the example.
                This sentence carries only what is not already on screen.
              */}
              <p className="mb-1 text-[12.5px] leading-[1.5] text-ink-soft">
                {fitSummary(explanation)}
              </p>
              </>
            )}

            <button
              type="button"
              onClick={() => toggleDetail("gap")}
              aria-expanded={detail === "gap"}
              className="block min-h-10 w-full py-[5px] text-left text-[13px] text-ink hover:text-rust hover:underline"
            >
              Gap analysis
            </button>
            {detail === "gap" && (
              <div className="mb-1 text-[12.5px] leading-[1.5] text-ink-soft">
                {missing === null ? (
                  <p>Nothing missing that this posting names — worth a close read of the description.</p>
                ) : (
                  <>
                    <p className="mb-1">Not on your resume yet:</p>
                    <ul className="list-none p-0">
                      {missing.map((skill) => (
                        <li key={skill} className="before:mr-1.5 before:content-['—']">
                          {skill}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 border-t border-dashed border-line pt-3">
            <span className="mb-[7px] block text-[10.5px] font-bold tracking-[0.1em] text-rust uppercase">
              Land
            </span>
            <a
              href={`/tailor?jobId=${jobId}`}
              className="flex min-h-10 items-center py-[5px] text-[13px] text-ink no-underline hover:text-rust hover:underline"
            >
              Tailor my resume
            </a>
            {/*
              Same page as above, but `coverLetter=1` defaults its checkbox on.
              Without that these two items resolve to an identical page in an
              identical state, which is the dead-duplicate problem that got
              "Gap analysis" rewritten rather than linked here.
            */}
            <a
              href={`/tailor?jobId=${jobId}&coverLetter=1`}
              className="flex min-h-10 items-center py-[5px] text-[13px] text-ink no-underline hover:text-rust hover:underline"
            >
              Draft intro message
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
