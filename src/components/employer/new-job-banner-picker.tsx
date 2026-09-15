"use client";

import { useEffect, useRef, useState } from "react";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { BANNER_GUIDANCE } from "@/lib/employer/banner";
import { BannerCropPicker, type BannerCropOutcome } from "./banner-crop-picker";
import { clearPendingJobBanner, readFileAsDataUrl, writePendingJobBanner } from "@/lib/employer/pending-job-banner";

const STAGE_FAILED_MESSAGE =
  "Couldn't hold onto this banner for after publishing — add it from the job's edit page once it's posted.";

/**
 * The create form's own banner picker (send-134) — an employer posting their
 * first job had no way to know a banner feature existed until AFTER
 * publishing, when the post-success card (added in send-132) pointed at
 * Edit. This closes that gap by showing the pick/crop UI here too, even
 * though nothing can actually upload yet: see job-banner-upload.tsx's own
 * header for why a banner needs a real jobId this form doesn't have.
 *
 * ── WHY THE ACTUAL WRITE HAPPENS ON SUBMIT, NOT ON CROP-CONFIRM ───────────
 *
 * The obvious design — write to sessionStorage the moment the crop is
 * confirmed — looked right and wasn't. Submitting `JobPostingForm` (a
 * sibling component, driven by `postJobAction`) re-renders this page's
 * Server Component tree as part of the action's own pending transition,
 * which remounts this client component BEFORE the redirect to the
 * post-success page actually happens. An earlier version of this file wrote
 * to storage at crop-confirm time and cleared it again on every fresh mount
 * — and that mount-time clear fired a second time from THAT remount,
 * wiping out the banner moments after it was staged and before the
 * post-success page ever got a chance to read it.
 *
 * The fix: convert the picked file to a data URL eagerly (an async
 * FileReader read, cheap, done right after cropping) and hold it in a ref —
 * nothing touches sessionStorage yet. A capturing `submit` listener on
 * `document` does the actual write, synchronously, at the literal moment
 * the employer clicks Publish. That is the one instant in this whole
 * lifecycle guaranteed to happen exactly once, after any remounts the
 * picking/cropping step could have caused and before whatever the
 * submission itself does — so it is also what decides "clear instead" when
 * nothing was staged, replacing the old (buggy) mount-time clear.
 *
 * ── WHAT HAPPENS INSTEAD OF UPLOADING ─────────────────────────────────────
 *
 * `postJobAction` itself is untouched — still redirects server-side to
 * `/employer/jobs?posted=<id>` exactly as before, deliberately out of scope
 * here — and PostSuccessBannerNote on that page is what actually uploads
 * the staged image, once a real jobId exists.
 *
 * ── NO SEPARATE "UNVERIFIED" NOTICE HERE ──────────────────────────────────
 *
 * JobBannerUpload (Edit) shows its own "your company isn't verified, so a
 * banner you upload now won't appear publicly yet" line, because Edit has no
 * other verification notice on the page. This form already has one — the
 * `unverifiedNotice` JobPostingForm renders above, about the POSTING not
 * reaching the public feed unverified. Rather than stack a second,
 * differently-worded warning about the SAME gate right below it, the create
 * page's own notice text was extended to cover the banner too ("this job —
 * and any banner you add"). Two sentences describing one gate would read as
 * two gates to someone skimming.
 */
export function NewJobBannerPicker({ userId }: { userId: string }) {
  const [staged, setStaged] = useState(false);
  const dataUrlRef = useRef<string | null>(null);

  useEffect(() => {
    function onSubmit() {
      if (dataUrlRef.current) {
        try {
          writePendingJobBanner(userId, dataUrlRef.current);
        } catch {
          // Best-effort at this point — see this component's own header.
        }
      } else {
        // No banner staged for THIS submission — clears anything left over
        // from an earlier, abandoned create attempt in the same tab, so it
        // cannot attach itself to the job this submission is about to
        // create instead.
        clearPendingJobBanner();
      }
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [userId]);

  async function handleCropped(file: File): Promise<BannerCropOutcome> {
    try {
      dataUrlRef.current = await readFileAsDataUrl(file);
      setStaged(true);
      return { ok: true };
    } catch {
      return { ok: false, error: STAGE_FAILED_MESSAGE };
    }
  }

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <EyebrowLabel>Banner — optional</EyebrowLabel>
        <p className="text-[13.5px] text-ink-soft">{BANNER_GUIDANCE}</p>
      </div>

      {staged && (
        <p className="text-[13px] text-ink-soft">
          Cropped and ready — it&rsquo;ll attach automatically once you publish.
        </p>
      )}

      <BannerCropPicker hasStagedBanner={staged} onCropped={handleCropped} />
    </BorderedCard>
  );
}
