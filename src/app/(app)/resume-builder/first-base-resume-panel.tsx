"use client";

import { useState } from "react";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { ReplaceBaseResume } from "@/components/resume-builder/replace-base-resume";

/**
 * The dead-end fix: a user who skipped /onboarding and has never uploaded a
 * resume any other way has zero reachable UI path to `upsertBaseResume` —
 * /onboarding permanently redirects away once skipped (deliberately, and
 * left untouched here), and ResumeListRow's own "Replace" button only
 * renders on a row that is ALREADY is_base=true. "Build a resume"/"Import my
 * resume" create is_base=false builder rows on purpose (the founder's own
 * corrected flow), so neither of those reaches it either.
 *
 * Mounted on /resume-builder only when `!hasBaseResume` — reuses
 * ReplaceBaseResume (variant="first-upload" for copy only) rather than a
 * second upload component or Server Action, since upsertBaseResume already
 * handles the no-existing-row case as a plain INSERT.
 *
 * Expanded by default: "prominent, always-visible" means uploading takes
 * zero extra clicks, not a button that reveals the real control one click
 * in. Cancel collapses to a compact reopen prompt instead of vanishing —
 * mirroring ResumeListRow's own read/replacing toggle for the same reason
 * that file states for its disabled Delete: an absent control reads as a
 * bug, a present one with the right words answers the question.
 */
export function FirstBaseResumePanel() {
  const [expanded, setExpanded] = useState(true);

  return (
    <BorderedCard className="flex flex-col gap-3 p-5" data-testid="first-base-resume-panel">
      <EyebrowLabel size="sm">Add your resume</EyebrowLabel>
      <p className="text-[14.5px] text-ink-soft">
        Upload your resume so the jobs feed can show real match scores, and so Auto-Apply and
        tailoring have something to work from.
      </p>
      {expanded ? (
        <ReplaceBaseResume variant="first-upload" onCancel={() => setExpanded(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          data-testid="first-base-resume-reopen"
          className="w-fit text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
        >
          Add your resume
        </button>
      )}
    </BorderedCard>
  );
}
