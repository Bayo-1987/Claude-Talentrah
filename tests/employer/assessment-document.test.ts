/**
 * src/lib/employer/assessment-document.ts — the shared file-type validator
 * for both assessment buckets (send-346 v2). Pure functions, no database,
 * so every branch can be asserted directly, same discipline as
 * tests/employer/banner-validation (banner.ts's own suite, if one exists)
 * would take for sniffImageType/validateBanner.
 *
 * ── WHAT THIS FILE EXISTS TO PIN ──────────────────────────────────────────
 *
 *   1. A real PDF (genuine `%PDF` magic bytes) is accepted regardless of
 *      what content-type/filename claims.
 *   2. A ZIP-signature file claiming to be .docx (both the extension AND
 *      the declared content-type) is accepted as docx.
 *   3. A ZIP-signature file NOT claiming to be docx (e.g. a plain .zip) is
 *      REJECTED — the weaker docx check still requires the second signal.
 *   4. A renamed executable (or any non-PDF, non-ZIP, non-UTF8-text binary)
 *      claiming to be a PDF via filename/extension alone is REJECTED — the
 *      exact "magic-byte check rejects a renamed file" case the spec calls
 *      out by name, checked for BOTH buckets since they share this one
 *      validator.
 *   5. Plain text is accepted only when it both claims text/plain AND is
 *      genuinely valid UTF-8 with no NUL byte.
 *   6. The size cap matches /api/resume/parse's own MAX_SIZE_BYTES (5 MB),
 *      not a new number.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_ASSESSMENT_DOCUMENT_BYTES,
  sniffAssessmentDocumentType,
  validateAssessmentDocument,
} from "@/lib/employer/assessment-document";

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
// A real Windows PE executable's own magic ("MZ..."), renamed to claim PDF —
// the exact "renamed executable" attack this feature's spec names directly.
const EXE_MAGIC = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe("sniffAssessmentDocumentType", () => {
  it("accepts a real PDF regardless of what the filename/content-type claim", () => {
    expect(sniffAssessmentDocumentType(PDF_MAGIC, "application/octet-stream", "resume.exe")).toBe(
      "application/pdf",
    );
  });

  it("accepts a ZIP signature as docx ONLY when the filename or content-type also claims docx", () => {
    const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(sniffAssessmentDocumentType(ZIP_MAGIC, docxType, "exercise.bin")).toBe(docxType);
    expect(sniffAssessmentDocumentType(ZIP_MAGIC, "application/octet-stream", "exercise.docx")).toBe(docxType);
  });

  it("REJECTS a ZIP signature that claims neither docx content-type nor .docx extension", () => {
    // A plain .zip, or any other zip-based format — the weaker docx check
    // exists specifically so this doesn't slip through as a Word document.
    expect(sniffAssessmentDocumentType(ZIP_MAGIC, "application/zip", "archive.zip")).toBeNull();
  });

  it(
    "SABOTAGE-PROOF TARGET: rejects a renamed executable claiming to be a PDF by filename alone",
    () => {
      // The exact case this feature's own spec calls out by name: an
      // executable renamed to .pdf. Real magic bytes (MZ...) are neither
      // PDF's %PDF signature nor a ZIP signature, and the file is not valid
      // UTF-8 text either (it contains NUL/control bytes), so every branch
      // must fall through to null regardless of what the name claims.
      expect(sniffAssessmentDocumentType(EXE_MAGIC, "application/pdf", "resume.pdf")).toBeNull();
    },
  );

  it("accepts plain text only when it's genuinely valid UTF-8 with no NUL byte", () => {
    const text = new TextEncoder().encode("A genuine plain-text response.");
    expect(sniffAssessmentDocumentType(text, "text/plain", "response.txt")).toBe("text/plain");
  });

  it("rejects a binary file with a NUL byte even if it claims text/plain", () => {
    const fakeText = new Uint8Array([0x41, 0x42, 0x00, 0x43]); // "AB\0C"
    expect(sniffAssessmentDocumentType(fakeText, "text/plain", "response.txt")).toBeNull();
  });

  it("rejects a file that claims nothing recognizable at all", () => {
    const randomBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    expect(sniffAssessmentDocumentType(randomBytes, "application/octet-stream", "file.bin")).toBeNull();
  });
});

describe("validateAssessmentDocument", () => {
  it("rejects a file over the 5 MB cap — the same cap /api/resume/parse uses, not a new one", () => {
    expect(MAX_ASSESSMENT_DOCUMENT_BYTES).toBe(5 * 1024 * 1024);
    const result = validateAssessmentDocument({
      bytes: PDF_MAGIC,
      byteLength: MAX_ASSESSMENT_DOCUMENT_BYTES + 1,
      declaredContentType: "application/pdf",
      filename: "big.pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("5 MB");
  });

  it("accepts a real PDF within the size cap", () => {
    const result = validateAssessmentDocument({
      bytes: PDF_MAGIC,
      byteLength: PDF_MAGIC.length,
      declaredContentType: "application/pdf",
      filename: "exercise.pdf",
    });
    expect(result).toEqual({ ok: true, type: "application/pdf" });
  });

  it("rejects a renamed executable, byte size aside — the size check passing must not mask the type check", () => {
    const result = validateAssessmentDocument({
      bytes: EXE_MAGIC,
      byteLength: EXE_MAGIC.length,
      declaredContentType: "application/pdf",
      filename: "totally-a-pdf.pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/isn't a PDF/i);
  });
});
