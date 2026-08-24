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
};

export default nextConfig;
