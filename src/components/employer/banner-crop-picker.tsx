"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button, EyebrowLabel, IconButton } from "@/components/ui";
import {
  BANNER_RATIO,
  MAX_BANNER_BYTES,
  ACCEPTED_BANNER_TYPES,
  EXTENSION_FOR,
} from "@/lib/employer/banner";
import { isCroppable, maxCroppableWidth, maxZoomForCrop, renderCroppedBanner } from "@/lib/employer/banner-crop";

export type BannerCropOutcome = { ok: true } | { ok: false; error: string };

/**
 * Pick-a-file-and-crop-it, with no network call of its own — send-134 pulled
 * this out of what is now JobBannerUpload (Edit's own upload-on-confirm
 * wrapper around this) so the same picking/cropping UI can also sit on the
 * create form, where there is no jobId yet to upload against.
 *
 * `onCropped` is what makes this reusable for both: it receives the finished
 * File and returns whether that resolved successfully. Returning
 * `{ ok: false, error }` keeps the crop dialog OPEN with that error shown —
 * preserved from the original component, and just as load-bearing for a
 * deferred, sessionStorage-backed "upload" (new-job-banner-picker.tsx) as it
 * always was for a real network request (job-banner-upload.tsx): either way,
 * the employer's chosen framing shouldn't be thrown away over a failure they
 * might retry.
 */
export function BannerCropPicker({
  hasStagedBanner,
  onCropped,
  pickLabelWhenEmpty = "Add a banner",
}: {
  /** Governs the button label ("Replace" vs "Add") — true once a banner is
   * either already saved (Edit) or already staged for after-publish (create). */
  hasStagedBanner: boolean;
  onCropped: (file: File) => Promise<BannerCropOutcome>;
  pickLabelWhenEmpty?: string;
}) {
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

      const outcome = await onCropped(file);
      if (!outcome.ok) {
        // Crop step stays open on failure — the employer's chosen framing
        // is worth keeping so retrying doesn't mean re-doing the crop.
        setError(outcome.error);
        return;
      }

      revokeCropSource();
      resetCropState();
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
          {hasStagedBanner ? "Replace banner" : pickLabelWhenEmpty}
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
    </>
  );
}

/**
 * The interactive crop step itself — a full-screen overlay because a
 * drag-to-pan, zoom-to-fit crop area needs real screen space, not the
 * Card's own inline width.
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
    // component that already hardcodes e.g. `text-coral` cannot be reliably
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
            className="w-full accent-coral"
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
