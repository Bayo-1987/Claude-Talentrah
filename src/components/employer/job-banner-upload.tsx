"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BorderedCard, Button, EyebrowLabel } from "@/components/ui";
import {
  BANNER_GUIDANCE,
  MAX_BANNER_BYTES,
  ACCEPTED_BANNER_TYPES,
  MIN_BANNER_RATIO,
  MAX_BANNER_RATIO,
  MIN_BANNER_WIDTH,
  MIN_BANNER_HEIGHT,
} from "@/lib/employer/banner";

/**
 * Optional banner for one job posting.
 *
 * ── WHY THIS IS ON THE EDIT SCREEN AND NOT THE POST-A-JOB FORM ────────────
 *
 * A banner is stored at `<organization_id>/<job_posting_id>` — it needs the
 * posting's id, which does not exist until the posting does. Rather than
 * inventing an id client-side or staging the file somewhere to move later,
 * this lives where the id is real. The create form points here instead.
 *
 * ── THE CLIENT CHECKS ARE COURTESY; THE SERVER'S ARE THE RULE ─────────────
 *
 * Everything below is re-checked in the route, including the format, which is
 * verified there by reading the file's own signature rather than trusting
 * `File.type` or the extension. These exist so someone learns their export is
 * the wrong shape before spending a slow upload on it, not because the answer
 * they give is trusted.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File) {
    setError(null);

    if (file.size > MAX_BANNER_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`);
      return;
    }

    /*
     * Measured here so a wrong shape is refused before the upload, not after.
     * `createImageBitmap` decodes enough to get dimensions and nothing else;
     * a failure means the browser could not read it as an image at all, which
     * is worth saying plainly rather than letting the server say it slower.
     */
    let width = 0;
    let height = 0;
    try {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      setError("That file could not be read as an image.");
      return;
    }

    if (width < MIN_BANNER_WIDTH || height < MIN_BANNER_HEIGHT) {
      setError(
        `That image is ${width}×${height}. It needs to be at least ${MIN_BANNER_WIDTH}×${MIN_BANNER_HEIGHT} — 1600×400 is ideal.`,
      );
      return;
    }
    const ratio = width / height;
    if (ratio < MIN_BANNER_RATIO || ratio > MAX_BANNER_RATIO) {
      setError(
        `That image is ${ratio.toFixed(1)}:1. A banner needs to be wide and short — between ${MIN_BANNER_RATIO}:1 and ${MAX_BANNER_RATIO}:1, with 4:1 ideal.`,
      );
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.set("jobId", jobId);
      body.set("file", file);
      const res = await fetch("/api/employer/job-banner", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "That upload didn't go through.");
        return;
      }
      // Server Components hold the banner, so a refresh is what shows it.
      router.refresh();
    } catch {
      setError("That upload didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
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

      {error && <p className="text-[13px] text-amber">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id="banner"
          type="file"
          accept={ACCEPTED_BANNER_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Uploading…" : currentBannerUrl ? "Replace banner" : "Add a banner"}
        </Button>
      </div>
    </BorderedCard>
  );
}
