"use client";

import { useRouter } from "next/navigation";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { BANNER_GUIDANCE } from "@/lib/employer/banner";
import { BannerCropPicker, type BannerCropOutcome } from "./banner-crop-picker";

/**
 * Optional banner for one job posting — Edit's own upload-on-confirm wrapper
 * around BannerCropPicker (send-134 pulled the pick/crop UI out into that
 * shared component; this file is now just the network half plus the
 * already-saved-banner preview).
 *
 * ── WHY THE ACTUAL UPLOAD LIVES ON EDIT, NOT THE CREATE FORM ──────────────
 *
 * A banner is stored at `<organization_id>/<job_posting_id>` — it needs the
 * posting's id, which does not exist until the posting does. That is still
 * true and unchanged. What DID change (send-134): the create form now shows
 * this same pick/crop UI too (new-job-banner-picker.tsx), it just can't
 * upload immediately for the reason above — it stages the cropped image in
 * sessionStorage instead, and the post-success card
 * (src/app/employer/jobs/page.tsx's PostSuccessBannerNote) is what actually
 * calls this same /api/employer/job-banner route, once a real jobId exists.
 * This component's own upload path — used whenever an employer adds or
 * replaces a banner from Edit directly — is untouched by any of that.
 *
 * ── THE CLIENT CHECKS ARE COURTESY; THE SERVER'S ARE THE RULE ─────────────
 *
 * Everything BannerCropPicker checks before this is called is re-checked in
 * the route, including the format, which is verified there by reading the
 * file's own signature rather than trusting `File.type` or the extension.
 * These exist so someone learns their export is the wrong shape before
 * spending a slow upload on it, not because the answer they give is trusted.
 */
export function JobBannerUpload({
  jobId,
  currentBannerUrl,
  organizationVerified,
}: {
  jobId: string;
  currentBannerUrl: string | null;
  organizationVerified: boolean;
}) {
  const router = useRouter();

  async function handleCropped(file: File): Promise<BannerCropOutcome> {
    try {
      const body = new FormData();
      body.set("jobId", jobId);
      body.set("file", file);
      const res = await fetch("/api/employer/job-banner", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        return { ok: false, error: json.error ?? "That upload didn't go through." };
      }
      // Server Components hold the banner, so a refresh is what shows it.
      router.refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "That upload didn't go through. Check your connection and try again." };
    }
  }

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <EyebrowLabel>Banner — optional</EyebrowLabel>
        <p className="text-[13.5px] text-ink-soft">{BANNER_GUIDANCE}</p>
      </div>

      {currentBannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentBannerUrl}
          alt="The banner currently on this posting"
          className="aspect-[4/1] w-full border-[1.5px] border-ink object-cover"
        />
      )}

      {!organizationVerified && (
        /*
         * Said before they upload, not after. An employer who adds artwork and
         * never sees it appear would reasonably conclude the feature is broken;
         * the honest version is that it is stored and waiting.
         */
        <p className="text-[13px] text-amber">
          Your company isn&rsquo;t verified yet, so a banner you upload now is saved but
          won&rsquo;t appear on the public posting until verification comes through — the same
          gate that decides whether the posting itself is listed.
        </p>
      )}

      <BannerCropPicker hasStagedBanner={!!currentBannerUrl} onCropped={handleCropped} />
    </BorderedCard>
  );
}
