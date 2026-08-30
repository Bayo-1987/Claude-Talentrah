"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { dismissResumeSkillsNoticeAction } from "@/lib/profile/settings-actions";

/**
 * Says, on the page where it can be fixed, that this resume has no skills on
 * it and therefore cannot be scored against anything.
 *
 * ── WHY THIS EXISTS AT ALL (issue #145) ───────────────────────────────────
 *
 * A resume can be stored with an empty skills array — the upload's heading
 * pattern missed and the LLM fallback failed (#139). The consequence is total
 * and permanent: `computeMatchScore` divides by the job's screenable skills
 * and the resume matches none of them, so every posting scores near zero, the
 * Excellent band is unreachable, and Auto-Apply can never fire. One production
 * account has been in that state for days.
 *
 * They WERE told, once — a sentence on the onboarding success card, driven by
 * the parse response, on a screen whose primary button is "Continue to your
 * dashboard". It cannot be shown again, because it was never read from
 * anywhere. So the product showed that person an empty-looking job board and
 * never explained it. This is the missing half: a notice that persists until
 * the thing it describes is fixed or the user says they know.
 *
 * ── WHY IT GATES ON THE SKILLS ARRAY, NOT ON parse_confidence ─────────────
 *
 * 0070 records a `low` confidence, and gating on that would be the obvious
 * choice and the wrong one. Confidence also drops to `low` when only the email
 * is missing, which costs the user nothing — matching does not read it. A
 * notice that fires on harmless cases is a notice people learn to ignore, and
 * this one needs to be believed the one time it matters.
 *
 * Reading the real data also removes a whole class of bug: the 35 rows written
 * before 0070 have `parse_confidence = null`, meaning "never recorded" rather
 * than "fine", and the affected account is one of them. Any check against the
 * column would have had to special-case null and would have skipped precisely
 * the user it exists for. The skills array is present on every row, old and
 * new alike.
 *
 * ── WHY IT IS NOT A COMPLETION METER ──────────────────────────────────────
 *
 * CLAUDE.md rules out profile-completion bars and gamification anywhere, and
 * that rule is load-bearing rather than decorative: it ties to the product's
 * anti-gamification retention stance. So this shows no percentage, no count of
 * remaining steps, and no progress of any kind. It states one fact and offers
 * the two ways to act on it. It is a bordered box in the design system's own
 * language — 1.5px ink, no radius, no shadow.
 */
export function EmptySkillsNotice({ baseResumeId }: { baseResumeId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();

  if (dismissed) return null;

  return (
    <div className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-5" data-testid="empty-skills-notice">
      <p className="font-body text-[14.5px] font-semibold text-ink">
        Your resume has no skills on it yet.
      </p>
      <p className="text-[14px] leading-relaxed text-ink-soft">
        Matching works by comparing the skills on your resume against the ones a job asks for, so
        until there are some, every role will score near zero — however well you actually fit it.
        Adding them is the single thing that will change your matches.
      </p>
      <div className="flex flex-wrap items-center gap-5">
        <Link
          href={`/resume-builder/edit?resumeId=${baseResumeId}`}
          className="text-[13.5px] font-semibold underline underline-offset-2 hover:text-rust"
        >
          Add your skills
        </Link>
        <Link
          href="/onboarding"
          className="text-[13.5px] font-semibold underline underline-offset-2 hover:text-rust"
        >
          Upload your resume again
        </Link>
        {/*
          Dismissal is optimistic and the persistence is fire-and-forget: the
          notice must disappear on the click, and a failed write only means it
          returns next visit — which is the safe direction for something the
          user may genuinely need to see again.
        */}
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            startTransition(() => {
              void dismissResumeSkillsNoticeAction();
            });
          }}
          className="min-h-10 text-[13.5px] text-ink-soft underline underline-offset-2 hover:text-rust"
        >
          I know, hide this
        </button>
      </div>
    </div>
  );
}
