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
 * Always mounted on /resume-builder (see the `hasBaseResume` note below for
 * why); renders nothing once a base resume exists and this panel hasn't been
 * expanded. Reuses ReplaceBaseResume (variant="first-upload" for copy only)
 * rather than a second upload component or Server Action, since
 * upsertBaseResume already handles the no-existing-row case as a plain
 * INSERT.
 *
 * Expanded by default: "prominent, always-visible" means uploading takes
 * zero extra clicks, not a button that reveals the real control one click
 * in. Cancel collapses to a compact reopen prompt instead of vanishing —
 * mirroring ResumeListRow's own read/replacing toggle for the same reason
 * that file states for its disabled Delete: an absent control reads as a
 * bug, a present one with the right words answers the question.
 *
 * `hasBaseResume` IS ONLY EVER READ FOR THE INITIAL RENDER — real bug found
 * by CI, not a flake: replaceBaseResumeAction's own revalidatePath("/resume-
 * builder") triggers Next's automatic post-Server-Action router refresh the
 * instant confirmReplace()'s await resolves, and that refresh re-renders the
 * PARENT page with hasBaseResume now true — unmounting this whole component,
 * including ReplaceBaseResume's local "done" state, before the confirmation
 * screen the child was about to show could ever paint. Caught by
 * e2e/resume-builder-first-upload.spec.ts on real CI infrastructure (not
 * locally, where the timing happened to lose the race the other way): its
 * failure snapshot showed the base resume already correctly created and
 * listed under "Your resumes" — the write succeeded — with this panel
 * already gone and "Your resume has been saved" never having rendered.
 * `useState`'s initializer runs once, on mount, so keeping this component
 * itself always mounted (see page.tsx — no more `{!hasBaseResume && ...}`)
 * and reading the prop only there means a same-render revalidation refresh
 * cannot yank the "done" screen out from under the user; only an actual
 * fresh navigation (a real new mount) re-evaluates the initial prop.
 */
export function FirstBaseResumePanel({ hasBaseResume }: { hasBaseResume: boolean }) {
  const [expanded, setExpanded] = useState(!hasBaseResume);

  if (hasBaseResume && !expanded) return null;

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
