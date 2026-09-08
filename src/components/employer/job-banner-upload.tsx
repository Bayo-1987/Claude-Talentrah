"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper, { type Area } from "react-easy-crop";
import { BorderedCard, Button, EyebrowLabel, IconButton } from "@/components/ui";
import {
  BANNER_GUIDANCE,
  BANNER_RATIO,
  MAX_BANNER_BYTES,
  ACCEPTED_BANNER_TYPES,
  EXTENSION_FOR,
} from "@/lib/employer/banner";
import { isCroppable, maxCroppableWidth, maxZoomForCrop, renderCroppedBanner } from "@/lib/employer/banner-crop";

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
 *
 * ── WHY THIS NO LONGER REJECTS BY RATIO AT PICK TIME ──────────────────────
 *
 * It used to refuse anything outside 3:1–5:1 outright — a real employer hit
 * this uploading a square (1:1) image and asked to "auto receive different
 * banner types." Silently auto-cropping was considered and rejected: a square
 * auto-cropped to 4:1 loses ~75% of its height, unpredictably, with no way to
 * see or fix it before it goes live. The founder's call was the interactive
 * crop tool below — the employer stays in control of what gets cut.
 *
 * The server-side rule (banner.ts's `validateBanner`, the 3:1–5:1 band, the
 * size floor/ceiling) is UNCHANGED. What changed is that this component now
 * always produces a fixed 1600×400 output (see banner-crop.ts), which was
 * already comfortably inside that band before this existed — the crop step's
 * job is choosing WHICH region of the source becomes that fixed rectangle,
 * not changing what shape is accepted.
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

  // Crop-step state. `cropSource` being non-null is what the modal renders on
  // — nothing else gates it, so closing/clearing this is the only thing
  // "cancel" ever has to do to guarantee no upload happens.
  const [cropSource, setCropSource] = useState<{ objectUrl: string; width: number; height: number } | null>(
    null,
  );
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // The object URL is this component's own allocation, not React state, so
  // it can always be revoked exactly once regardless of which exit path
  // (confirm, cancel, or unmount mid-crop) ends the crop step.
  const revokeCropSource = useCallback(() => {
    setCropSource((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }, []);
  useEffect(() => () => revokeCropSource(), [revokeCropSource]);

  function resetCropState() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }

  async function onPick(file: File) {
    setError(null);

    if (file.size > MAX_BANNER_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`);
      return;
    }

    /*
     * Measured here so an uncroppable file is refused before the crop step
     * opens, not after. `createImageBitmap` decodes enough to get dimensions
     * and nothing else; a failure means the browser could not read it as an
     * image at all, which is worth saying plainly rather than opening a crop
     * tool on nothing.
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

    if (!isCroppable(width, height)) {
      const bestPossible = Math.floor(maxCroppableWidth(width, height));
      setError(
        `That image is ${width}×${height} — even cropped to the widest possible ${BANNER_RATIO}:1 slice, it would only be ${bestPossible}px wide. Try a larger image.`,
      );
      return;
    }

    resetCropState();
    setCropSource({ objectUrl: URL.createObjectURL(file), width, height });
  }

  function onCancelCrop() {
    revokeCropSource();
    resetCropState();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onConfirmCrop() {
    if (!cropSource || !croppedAreaPixels) return;

    setBusy(true);
    setError(null);
    try {
      const { blob, type } = await renderCroppedBanner(cropSource.objectUrl, croppedAreaPixels);
      const file = new File([blob], `banner.${EXTENSION_FOR[type]}`, { type });

      const body = new FormData();
      body.set("jobId", jobId);
      body.set("file", file);
      const res = await fetch("/api/employer/job-banner", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // Crop step stays open on failure — the employer's chosen framing
        // is worth keeping so retrying doesn't mean re-doing the crop.
        setError(json.error ?? "That upload didn't go through.");
        return;
      }

      revokeCropSource();
      resetCropState();
      if (inputRef.current) inputRef.current.value = "";
      // Server Components hold the banner, so a refresh is what shows it.
      router.refresh();
    } catch {
      setError("That upload didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
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
          {currentBannerUrl ? "Replace banner" : "Add a banner"}
        </Button>
      </div>

      {cropSource && (
        <CropDialog
          objectUrl={cropSource.objectUrl}
          maxZoom={maxZoomForCrop(cropSource.width, cropSource.height)}
          crop={crop}
          zoom={zoom}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={setCroppedAreaPixels}
          busy={busy}
          error={error}
          onCancel={onCancelCrop}
          onConfirm={() => void onConfirmCrop()}
        />
      )}
    </BorderedCard>
  );
}

/**
 * The interactive crop step itself — a full-screen overlay because a
 * drag-to-pan, zoom-to-fit crop area needs real screen space, not the
 * BorderedCard's own inline width.
 *
 * No click-outside-to-dismiss: a drag that ends outside the crop frame (a
 * very plausible way to pan) must not read as "cancel" — only the explicit
 * Cancel button and Escape do.
 */
function CropDialog({
  objectUrl,
  maxZoom,
  crop,
  zoom,
  onCropChange,
  onZoomChange,
  onCropComplete,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  objectUrl: string;
  maxZoom: number;
  crop: { x: number; y: number };
  zoom: number;
  onCropChange: (crop: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onCropComplete: (pixels: Area) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    // The dim SCRIM is the only element that needs a dark treatment — the
    // dialog panel itself stays on the app's normal light `bg-card`/
    // `border-ink` chrome (the same pattern job-share-button.tsx's own
    // popover uses) precisely so EyebrowLabel, IconButton and Button render
    // with their ordinary default colors here. This project's `cn` helper
    // (src/lib/cn.ts) is a plain string join, not a Tailwind-merge — a
    // component that already hardcodes e.g. `text-rust` cannot be reliably
    // recolored by appending another color utility after it, since which
    // class wins depends on Tailwind's generated stylesheet order, not on
    // prop order. A light panel sidesteps needing to try.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
      <div
        className="flex w-full max-w-[760px] flex-col gap-4 border-[1.5px] border-ink bg-card p-5"
        role="dialog"
        aria-modal="true"
        aria-label="Crop your banner"
      >
        <div className="flex items-center justify-between">
          <EyebrowLabel>Crop your banner</EyebrowLabel>
          <IconButton type="button" aria-label="Cancel cropping" disabled={busy} onClick={onCancel}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>

        <div className="relative h-[240px] w-full border-[1.5px] border-ink bg-ink">
          <Cropper
            image={objectUrl}
            crop={crop}
            zoom={zoom}
            minZoom={1}
            maxZoom={maxZoom}
            aspect={BANNER_RATIO}
            objectFit="cover"
            restrictPosition
            showGrid
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={(_, pixels) => onCropComplete(pixels)}
          />
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="banner-zoom" className="text-[12px] font-semibold text-ink-soft">
            Zoom
          </label>
          <input
            id="banner-zoom"
            type="range"
            min={1}
            max={maxZoom}
            step={0.01}
            value={zoom}
            disabled={maxZoom <= 1}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="w-full accent-rust"
          />
        </div>

        {error && <p className="text-[13px] text-amber">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? "Uploading…" : "Use this crop"}
          </Button>
        </div>
      </div>
    </div>
  );
}
