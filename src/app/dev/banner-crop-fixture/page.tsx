import { BannerCropFixture } from "./fixture";

/**
 * QA-only, same convention as `/dev/resume-editor-fixture`: reached by URL, outside the `(app)` group (no
 * masthead, no auth), no database. It mounts the real `BannerCropPicker` so `e2e/banner-crop-picker.spec.ts` can
 * drive the pick -> crop -> confirm path, and stall hydration on purpose, without signing in as an employer.
 */
export default function BannerCropFixturePage() {
  return <BannerCropFixture />;
}
