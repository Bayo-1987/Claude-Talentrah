import "server-only";
import mammoth from "mammoth";
import { ensurePdfRuntimeGlobals } from "./pdf-runtime-polyfill";

/**
 * NOTE ON THE PDF IMPORT: `pdf-parse` is imported DYNAMICALLY, inside the PDF
 * branch, and only after `ensurePdfRuntimeGlobals()` has run.
 *
 * That ordering is the fix, not a style choice. pdfjs-dist evaluates
 * `new DOMMatrix()` at module scope, so a static `import { PDFParse } from
 * "pdf-parse"` at the top of this file runs before any statement in it — there
 * is no point at which a polyfill could be installed in time. Hoisting is
 * exactly what made this a 500 in production; see pdf-runtime-polyfill.ts.
 *
 * The dynamic import also means DOCX and plain-text uploads never load the PDF
 * stack at all, which is why those two paths were unaffected by the outage.
 */
export async function extractResumeText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (mimeType === "application/pdf") {
    ensurePdfRuntimeGlobals();
    const { PDFParse } = await import("pdf-parse");

    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === "text/plain") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported resume file type: ${mimeType}`);
}
