"use client";

import { useState } from "react";
import { BannerCropPicker } from "@/components/employer/banner-crop-picker";

/** Mounts the real BannerCropPicker with a no-op "upload" so a spec can drive pick -> crop -> confirm without a database. */
export function BannerCropFixture() {
  const [cropped, setCropped] = useState(false);
  return (
    <div className="flex flex-col gap-3 p-6">
      <BannerCropPicker
        hasStagedBanner={cropped}
        onCropped={async () => {
          setCropped(true);
          return { ok: true };
        }}
      />
      {cropped && <p>Cropped and ready</p>}
    </div>
  );
}
