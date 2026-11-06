/**
 * The limits of one upload (PR-U1), checked BEFORE anything is planned or written. 2 MB because the body limit of a function on this host is 4.5 MB and the real sheet (838 rows) is far
 * below it; 1,000 rows because the sheet is under it and one request must finish its batches (about 17) inside the route's duration limit.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 1000;
/** Fingerprints asked about in one read: a longer list would make the request address too long. */
export const EXISTING_FINGERPRINT_CHUNK = 200;
/** Lines of the preview table shown in the page; the counts and the preview CSV cover every row. */
export const PREVIEW_LINE_LIMIT = 100;
/** Form fields and boundaries add a little to the file's own size. */
export const FORM_OVERHEAD_BYTES = 256 * 1024;

/** `manual-upload-<yyyymmdd>-<first 8 hex of the file's sha256>`: the `manual-` prefix keeps the stale-posting sweep off these rows (src/lib/jobs/expiry.ts). */
export const UPLOAD_KEY_PATTERN = /^manual-upload-\d{8}-[0-9a-f]{8}$/;

export function uploadSourceKey(now: Date, sha256Hex: string): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `manual-upload-${day}-${sha256Hex.slice(0, 8)}`;
}
