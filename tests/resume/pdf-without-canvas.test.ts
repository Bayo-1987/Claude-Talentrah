/**
 * The regression guard for the production-only PDF crash.
 *
 * ── Why the existing e2e test could not have caught this ──────────────────
 *
 * The brief's hypothesis was that `e2e/resume-upload.spec.ts`'s fixture PDF is
 * too simple to reach the canvas code path, and that a richer PDF would have
 * caught it. That is not what happened, and it matters, because "diversify the
 * fixture" would have closed nothing:
 *
 * pdfjs-dist evaluates `const SCALE_MATRIX = new DOMMatrix()` at MODULE SCOPE
 * (legacy/build/pdf.mjs:15620). It runs on IMPORT, before a single byte of any
 * PDF is read. Every PDF crashes when the global is missing; every PDF works
 * when it is present. The fixture's contents are irrelevant.
 *
 * The real divergence is environmental: CI runs against a complete
 * `node_modules`, where `@napi-rs/canvas` is installed and pdf.js self-polyfills
 * from it. Vercel runs against a traced, pruned function bundle where that
 * package is absent, because pdf.js reaches for it through a try/catch
 * `require()` that the dependency tracer cannot follow. A passing CI run
 * genuinely did not prove this path worked in production.
 *
 * ── What this test does instead ───────────────────────────────────────────
 *
 * Simulates the pruned bundle in-process: it hides `@napi-rs/canvas` from the
 * module resolver, then drives the real extraction path. That reproduces the
 * production failure on a developer machine and in CI, without needing a
 * deployment — which is what makes it a usable regression guard rather than a
 * post-mortem note.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Module from "node:module";
import { extractResumeText } from "@/lib/resume/extract-text";

/** A genuinely valid single-page PDF, built rather than committed as a blob. */
function buildPdf(lines: string[]): Buffer {
  const content =
    "BT\n/F1 11 Tf\n50 760 Td\n14 TL\n" +
    lines.map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj\nT*\n`).join("") +
    "ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const RESUME_LINES = [
  "Amaka Obi",
  "amaka.obi@example.com | Lagos, Nigeria",
  "EXPERIENCE",
  "Senior Backend Engineer, Paystack, 2021 - 2026",
  "SKILLS",
  "Node.js, TypeScript, Postgres",
];

/**
 * Makes `require("@napi-rs/canvas")` fail the way it does inside a traced
 * Vercel function bundle, without touching node_modules on disk.
 */
type Resolver = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
) => string;

const moduleInternals = Module as unknown as { _resolveFilename: Resolver };
let realResolve: Resolver | undefined;

function hideCanvasPackage() {
  realResolve = moduleInternals._resolveFilename;
  const original = realResolve;
  moduleInternals._resolveFilename = function (request, parent, isMain, options) {
    if (request === "@napi-rs/canvas" || request.startsWith("@napi-rs/canvas/")) {
      const err = new Error(`Cannot find module '${request}'`) as Error & { code: string };
      err.code = "MODULE_NOT_FOUND";
      throw err;
    }
    return original.call(this, request, parent, isMain, options);
  };
}

function restoreCanvasPackage() {
  if (realResolve) moduleInternals._resolveFilename = realResolve;
  realResolve = undefined;
}

describe("PDF extraction survives a bundle with no @napi-rs/canvas", () => {
  beforeEach(hideCanvasPackage);
  afterEach(restoreCanvasPackage);

  it("extracts text when the canvas package cannot be resolved", async () => {
    /*
     * Proven to catch the bug: with the polyfill removed from
     * extract-text.ts, this fails with the exact production error —
     * "ReferenceError: DOMMatrix is not defined" — rather than an assertion
     * mismatch.
     */
    const text = await extractResumeText(buildPdf(RESUME_LINES), "application/pdf");

    expect(text).toContain("Amaka Obi");
    expect(text).toContain("amaka.obi@example.com");
    expect(text, "the skills section must survive extraction").toContain("Postgres");
  });

  it("still works for a PDF with more structure than the happy-path fixture", async () => {
    // Not because structure was the cause — it wasn't — but because the brief
    // reasonably asked whether a richer document changes anything. It does not,
    // and pinning that stops the question being re-opened.
    const busy = [
      ...RESUME_LINES,
      "PROJECTS",
      "Payments reconciliation service — Node.js, Postgres, 2m txns/day",
      "CERTIFICATIONS",
      "AWS Solutions Architect (2024)",
      ...Array.from({ length: 40 }, (_, i) => `Bullet point number ${i + 1} with some detail.`),
    ];
    const text = await extractResumeText(buildPdf(busy), "application/pdf");
    expect(text).toContain("Payments reconciliation service");
    expect(text).toContain("Bullet point number 40");
  });
});

describe("the other upload formats never touch the PDF stack", () => {
  // Confirmed rather than assumed: the outage was PDF-only, and these two
  // paths are why. extract-text.ts imports pdf-parse dynamically inside the
  // PDF branch, so neither of these can load pdfjs at all.
  beforeEach(hideCanvasPackage);
  afterEach(restoreCanvasPackage);

  it("plain text extracts with the canvas package hidden", async () => {
    const text = await extractResumeText(Buffer.from("Amaka Obi\nLagos", "utf-8"), "text/plain");
    expect(text).toBe("Amaka Obi\nLagos");
  });

  it("an unsupported type fails with a clear message, not a module error", async () => {
    await expect(
      extractResumeText(Buffer.from("x"), "image/png"),
    ).rejects.toThrow(/Unsupported resume file type/);
  });
});
