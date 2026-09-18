/**
 * Assessment exercise/response documents: what a valid one is, and where it
 * lives. Shared by BOTH sides of the assessment feature (send-346 v2) — an
 * employer's exercise document and a candidate's response document are the
 * same three file types, same size cap, same magic-byte discipline.
 *
 * Pure functions with no database and no network, mirroring
 * src/lib/employer/banner.ts's own shape exactly (that file's header
 * explains why: "every branch is testable and the rules can be asserted
 * rather than described").
 *
 * NEITHER assessment bucket is scanned for viruses/malware — a known,
 * pre-existing gap, not one this feature opens or closes: no upload this
 * app accepts today (resumes, banners) gets malware scanning either.
 */

/** Public: the employer's own exercise document. No more sensitive than the job description text sitting next to it. */
export const ASSESSMENT_EXERCISE_BUCKET = "job-assessment-exercises";
/** Private: a candidate's response document. Readable by exactly two parties — see the storage policy in 0177. */
export const ASSESSMENT_SUBMISSION_BUCKET = "job-assessment-submissions";

/**
 * 5 MB — the SAME cap /api/resume/parse already uses (src/app/api/resume/parse/route.ts's
 * own MAX_SIZE_BYTES), not a new number picked for this feature. These are
 * the same three document shapes this app already knows how to receive
 * safely; a second, different cap for materially the same kind of upload
 * would be a number nobody could explain the difference of.
 */
export const MAX_ASSESSMENT_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_ASSESSMENT_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;
export type AssessmentDocumentMimeType = (typeof ACCEPTED_ASSESSMENT_DOCUMENT_TYPES)[number];

export const EXTENSION_FOR: Record<AssessmentDocumentMimeType, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

export const ASSESSMENT_DOCUMENT_GUIDANCE = "PDF, Word (.docx) or plain text, up to 5 MB.";

/**
 * send-364 — up to this many files per assessment. A placeholder, like other
 * picked-not-researched numbers in this repo (e.g. billing/catalog.ts's
 * ₦100/review price): small, explainable, not derived from usage data. The
 * REAL enforcement is 0178's `enforce_max_assessment_files` trigger, not
 * this constant — this exists for the UI (disable "Add file" at the cap)
 * and the upload route's own nicer-error pre-check. Keep this number in
 * sync with that trigger's hardcoded `5` if either ever changes; SQL can't
 * import a TS constant, so the two are cross-referenced by comment only,
 * the same way MAX_ASSESSMENT_DOCUMENT_BYTES's 5 MB already appears a
 * second time as a raw number in 0177's own bucket config.
 */
export const MAX_ASSESSMENT_FILES = 5;

/**
 * FILE SIGNATURE FOR PDF IS A REAL PROOF. `%PDF` (0x25 0x50 0x44 0x46) at
 * the start of the file is PDF's own required magic — same discipline
 * banner.ts's sniffImageType already applies to images: read the bytes,
 * not `File.type` or the filename, neither of which says anything about
 * what the bytes actually are.
 *
 * DOCX IS WEAKER, AND SAYS SO. A .docx file is a ZIP container (signature
 * `PK\x03\x04`, 0x50 0x4B 0x03 0x04), but a bare ZIP signature cannot prove
 * the archive is SPECIFICALLY a Word document rather than any other
 * zip-based format (an .xlsx, a plain .zip, a .jar) — actually parsing the
 * archive's own `[Content_Types].xml` to confirm would be a real
 * dependency for a narrow gain. So a ZIP signature is accepted as docx
 * ONLY when the declared content-type or filename extension ALSO claims
 * docx — a second, independently weaker signal that at least rules out
 * "someone renamed an unrelated zip to .docx and didn't also lie about the
 * content-type." This is honestly weaker than the PDF check, not a gap
 * hidden behind the same confidence.
 *
 * PLAIN TEXT HAS NO SIGNATURE AT ALL. There is no magic-byte proof a file
 * is "plain text" — the check here is content-shaped instead: no NUL byte
 * (the one byte no real UTF-8 text file contains) and the bytes decode as
 * valid UTF-8. Combined with the declared type/extension also claiming
 * text/plain, the same "weaker, said so" stance as docx.
 */
export function sniffAssessmentDocumentType(
  bytes: Uint8Array,
  declaredContentType: string,
  filename: string,
): AssessmentDocumentMimeType | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }

  const lowerName = filename.toLowerCase();
  const isZip =
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip) {
    const claimsDocx =
      declaredContentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx");
    return claimsDocx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  }

  const claimsText = declaredContentType === "text/plain" || lowerName.endsWith(".txt");
  if (claimsText && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return "text/plain";
    } catch {
      return null;
    }
  }

  return null;
}

export type AssessmentDocumentRejection = { ok: false; reason: string };
export type AssessmentDocumentAcceptance = { ok: true; type: AssessmentDocumentMimeType };

/**
 * Everything checkable about a candidate/employer document, in one place.
 * Takes already-read bytes rather than a File, so the rule is testable
 * without a browser or a network call — same shape as validateBanner.
 */
export function validateAssessmentDocument(args: {
  bytes: Uint8Array;
  byteLength: number;
  declaredContentType: string;
  filename: string;
}): AssessmentDocumentAcceptance | AssessmentDocumentRejection {
  const { bytes, byteLength, declaredContentType, filename } = args;

  if (byteLength > MAX_ASSESSMENT_DOCUMENT_BYTES) {
    return {
      ok: false,
      reason: `That file is ${(byteLength / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`,
    };
  }

  const type = sniffAssessmentDocumentType(bytes, declaredContentType, filename);
  if (!type) {
    return {
      ok: false,
      reason: "That file isn't a PDF, Word (.docx) or plain text document. Checked by reading the file itself, not its name.",
    };
  }

  return { ok: true, type };
}

/**
 * The object path ONE of an assessment's EXERCISE documents lives at
 * (send-364 — up to MAX_ASSESSMENT_FILES per assessment, was exactly one
 * before this).
 *
 * `<organization_id>/<job_posting_id>/<file_id>.<ext>` — a folder of
 * objects now, not one object. Still puts the owning organisation in the
 * FIRST folder segment, which is all 0177's storage policies ever read
 * (`storage.foldername(name)[1]`) — confirmed directly against this
 * project's real `storage.foldername` behavior in 0178's own migration
 * comment before this shape changed, not assumed. `fileId` is generated by
 * the caller BEFORE the row exists (the same `id` the
 * job_posting_assessment_files row is later inserted with), the same
 * "compose the path first, write the DB row second" order the single-file
 * version already used.
 */
export function exerciseObjectPath(
  organizationId: string,
  jobPostingId: string,
  fileId: string,
  type: AssessmentDocumentMimeType,
): string {
  return `${organizationId}/${jobPostingId}/${fileId}.${EXTENSION_FOR[type]}`;
}

/**
 * The object path ONE of a candidate's RESPONSE documents lives at
 * (send-365 — up to MAX_ASSESSMENT_FILES per response, was exactly one
 * before this, same widening 0178 already did on the employer's exercise
 * side).
 *
 * `<uploader's own user id>/<job_posting_id>/<file_id>.<ext>` — NOT the
 * organisation, because at upload time (before the candidate has finished
 * applying) no application row exists yet for an org-scoped path to be
 * checked against. The uploader's own id is the one thing already known
 * and already theirs — see 0177's own header on why the write policy is
 * self-contained. Confirmed directly against this project's real
 * `storage.foldername` behavior in 0179's own migration comment before
 * this shape changed, not assumed: `(storage.foldername(name))[1]` is
 * still the uploader's own auth.uid() under the three-segment shape.
 */
export function submissionObjectPath(
  userId: string,
  jobPostingId: string,
  fileId: string,
  type: AssessmentDocumentMimeType,
): string {
  return `${userId}/${jobPostingId}/${fileId}.${EXTENSION_FOR[type]}`;
}

const EXERCISE_PATH_SHAPE = /^([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\.(pdf|docx|txt)$/;

/**
 * The public URL for ONE stored assessment EXERCISE document — or null
 * (send-364 widened this from one file to a folder of them; call this once
 * per `job_posting_assessment_files` row, same as bannerPublicUrl's own
 * callers do for a single value).
 *
 * Same reasoning as bannerPublicUrl: `job_posting_assessment_files` rows
 * are written through the employer's own session client (RLS is the real
 * gate), so nothing downstream should trust `file_path` as a column alone.
 * A URL is only rendered if the path is exactly
 * `<uuid>/<uuid>/<uuid>.<ext>` AND its first segment is THIS POSTING'S OWN
 * organisation AND its second segment is THIS POSTING'S OWN id — a
 * stricter, two-segment check than the storage RLS policy itself makes
 * (which only ever reads the first segment), the same "defense in depth"
 * gap the single-file version already had between the DB policy and this
 * function's own extra validation.
 */
export function assessmentExerciseFileUrl(args: {
  supabaseUrl: string;
  filePath: string;
  organizationId: string;
  jobPostingId: string;
}): string | null {
  const { supabaseUrl, filePath, organizationId, jobPostingId } = args;

  const match = EXERCISE_PATH_SHAPE.exec(filePath);
  if (!match) return null;
  if (match[1].toLowerCase() !== organizationId.toLowerCase()) return null;
  if (match[2].toLowerCase() !== jobPostingId.toLowerCase()) return null;

  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${ASSESSMENT_EXERCISE_BUCKET}/${filePath}`;
}
