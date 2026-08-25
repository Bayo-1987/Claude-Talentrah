import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Keep the PDF stack out of the server bundle.
   *
   * pdf-parse pulls in pdfjs-dist's legacy Node build, and pdf.js resolves
   * its worker script RELATIVE TO ITS OWN MODULE LOCATION. Once the bundler
   * rewrites that module into a hashed chunk, the worker path it computes
   * points inside the chunk directory — where the worker file was never
   * emitted — and every PDF upload dies with:
   *
   *   Setting up fake worker failed: "Cannot find module
   *   '.../.next/dev/server/chunks/pdf.worker.mjs' imported from
   *   '.../.next/dev/server/chunks/node_modules_pdfjs-dist_legacy_build_pdf_mjs_<hash>.js'"
   *
   * Listing them here makes Node require them from node_modules at runtime,
   * so pdf.js resolves the worker beside its real module as it expects.
   * Both are named deliberately: pdf-parse is the direct dependency, but
   * pdfjs-dist is the package that actually does the path resolution, and
   * leaving it bundled reintroduces the failure.
   *
   * Reproduced and verified against a real PDF through /api/resume/parse,
   * not inferred — see e2e/resume-upload.spec.ts, which drives a real PDF
   * through the real route on the real server, so a dependency bump or a
   * config edit cannot silently bring this back. It has to be an e2e test:
   * the failure only exists once Next bundles, so a unit test calling the
   * parser directly would pass while the product stayed broken.
   */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],

  /**
   * Force pdf.js's worker script into the deployed function bundle.
   *
   * `serverExternalPackages` above fixes WHERE pdf.js looks for the worker
   * (beside its real module in node_modules, not inside a hashed chunk). It
   * does nothing about whether that file is actually SHIPPED. Vercel's
   * dependency tracer copies only what it can statically see, and pdf.js loads
   * the worker through a computed dynamic import — invisible to the tracer, so
   * the file gets pruned out of the function bundle.
   *
   * Found by testing against the real production deployment rather than
   * trusting a green CI run. With only the DOMMatrix fix (PR #32) in place,
   * production still returned:
   *
   *   422 {"error":"Setting up fake worker failed: \"Cannot find module
   *   '/var/task/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
   *   imported from /var/task/node_modules/pdfjs-dist/legacy/build/pdf.mjs\"."}
   *
   * Note what that proves: pdf.mjs itself WAS traced, at the expected
   * node_modules path — so PR #21's fix is doing its job. Only the worker,
   * reached dynamically, was missing.
   *
   * This is the case where outputFileTracingIncludes IS the right tool, unlike
   * the @napi-rs/canvas gap in src/lib/resume/pdf-runtime-polyfill.ts: canvas
   * is a rendering dependency this route never uses and could be stubbed away,
   * the worker is genuinely required and cannot.
   */
  outputFileTracingIncludes: {
    "/api/resume/parse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
