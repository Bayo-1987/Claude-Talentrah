/**
 * Carries a cropped-but-not-yet-uploaded job banner across the redirect
 * postJobAction makes from the create form to the post-success card
 * (send-134) — the only reason this exists at all is that a banner needs a
 * real jobId (banner.ts's bannerObjectPath), which doesn't exist until
 * AFTER that redirect, but the employer picks and crops it BEFORE.
 *
 * `sessionStorage`, deliberately: it survives the one full-page navigation
 * this needs to cross, and nothing more — it does not survive the tab
 * closing, and (bar a browser's own "duplicate tab") it is not shared with
 * any other tab, so it cannot hand one employer's staged artwork to a
 * different session open elsewhere. The `userId` check below is the second,
 * cheaper-to-reason-about layer on top of that: even in the one browser
 * feature that DOES copy sessionStorage into a new tab, or the edge case of
 * two different accounts signing in back-to-back in the same tab, a mismatch
 * means the image is silently dropped rather than silently attached to
 * someone else's job.
 *
 * CONSUMED AT MOST ONCE. `takePendingJobBanner` always clears the entry
 * before returning, win or lose — the caller (PostSuccessBannerNote) is the
 * only reader, reads it exactly once per post-success render, and a failed
 * attach must not be retried against a LATER, unrelated job posting that
 * happens to redirect through the same URL shape in the same tab.
 */

const STORAGE_KEY = "talentrah:pending-job-banner";

export interface PendingJobBanner {
  userId: string;
  /** A `data:<mime>;base64,...` URL — sessionStorage only holds strings. */
  dataUrl: string;
}

/**
 * The one piece of this file with no browser API in it, pulled out so the
 * ownership check is testable with a plain string rather than a real
 * `sessionStorage` and `FileReader` — the same split banner.ts and
 * banner-crop.ts already draw between the two of them. `raw` is exactly
 * whatever `sessionStorage.getItem` returned: absent, malformed JSON, a
 * differently-shaped object, or a payload staged by a different signed-in
 * user must all come back `null` rather than throwing, since every one of
 * them means "there is nothing here this caller may use."
 */
export function parseOwnedPendingBanner(
  raw: string | null,
  currentUserId: string,
): PendingJobBanner | null {
  if (!raw) return null;

  let parsed: Partial<PendingJobBanner>;
  try {
    parsed = JSON.parse(raw) as Partial<PendingJobBanner>;
  } catch {
    return null;
  }

  if (typeof parsed.userId !== "string" || typeof parsed.dataUrl !== "string") return null;
  if (!parsed.userId || !parsed.dataUrl) return null;
  if (parsed.userId !== currentUserId) return null;

  return { userId: parsed.userId, dataUrl: parsed.dataUrl };
}

/**
 * Reads a File as a `data:` URL — the one async step, kept separate from the
 * actual sessionStorage write (see `writePendingJobBanner`'s own header for
 * why that split matters).
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the cropped image."));
    reader.readAsDataURL(file);
  });
}

/**
 * Stages a cropped banner for the NEXT post-success render in this tab —
 * SYNCHRONOUS on purpose. `new-job-banner-picker.tsx` calls this from a
 * capturing `submit` listener on `document`, which is the one point in the
 * create form's lifecycle guaranteed to run exactly once, exactly when the
 * employer actually publishes. It converts the picked file to a data URL
 * eagerly at crop-confirm time specifically so nothing async is still in
 * flight at that instant — an `await` inside the submit handler would race
 * the Server Action's own submission, which does not wait for it.
 *
 * Throws on failure (most plausibly sessionStorage's quota — a 1600×400 crop
 * is a few hundred KB to ~2.7MB base64-encoded, comfortably inside every
 * major browser's per-origin sessionStorage quota, but a locked-down context
 * such as private browsing can refuse writes outright). The caller decides
 * what to do with that; by the time this runs there is no form-visible error
 * state left to show, since submission is already underway.
 */
export function writePendingJobBanner(userId: string, dataUrl: string): void {
  const payload: PendingJobBanner = { userId, dataUrl };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Drops any staged banner without using it — called when a create attempt is
 * abandoned (the create form re-mounts) or once a staged banner has already
 * been consumed, successfully or not. Best-effort: a sessionStorage failure
 * here isn't worth surfacing, since the goal is just "don't leave this
 * lying around."
 */
export function clearPendingJobBanner(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to degrade to — see the header above.
  }
}

/**
 * Reads and immediately clears whatever is staged, returning it as a File
 * ready for the same upload job-banner-upload.tsx already does — or null if
 * there was nothing staged, it couldn't be parsed, or it belonged to a
 * different signed-in user than `currentUserId`.
 */
export async function takePendingJobBanner(currentUserId: string): Promise<File | null> {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  clearPendingJobBanner();

  const owned = parseOwnedPendingBanner(raw, currentUserId);
  if (!owned) return null;

  // A data: URL fetch is decoded locally — no network round trip.
  const blob = await fetch(owned.dataUrl).then((r) => r.blob());
  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `banner.${extension}`, { type: blob.type || "image/png" });
}
