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

  /**
   * HTTP security headers — none of these were set anywhere before this:
   * checked this file, looked for a request `middleware.ts` (there is
   * none — `src/lib/supabase/middleware.ts` is the Supabase session-refresh
   * helper, not a request middleware, and doesn't touch response headers),
   * and grepped the whole repo for `Content-Security-Policy`, `Strict-
   * Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`,
   * `Referrer-Policy`: zero hits anywhere. Vercel's own platform defaults
   * cover some of this, but relying on an undocumented platform default for
   * a security posture is exactly the kind of unreviewable assumption this
   * repo's own CLAUDE.md warns against elsewhere (the grant-vs-policy
   * confusion that cost four separate RLS incidents) — these are explicit
   * and reviewable instead.
   *
   * Scoped against what this app actually loads client-side, checked
   * directly rather than assumed:
   *   - Fonts (Newsreader, Source Sans 3) go through `next/font/google`,
   *     which self-hosts the font files at build time — confirmed no
   *     runtime request to fonts.googleapis.com/fonts.gstatic.com exists
   *     anywhere in the app, so neither host needs a CSP entry.
   *   - Paystack checkout is a full top-level redirect to Paystack's own
   *     hosted page (`initializeTransaction`'s `authorization_url`, opened
   *     via navigation) — never embedded via script or iframe — so it needs
   *     no CSP entry either; a `frame-ancestors`/`frame-src` directive has
   *     nothing to do with a page that navigates AWAY rather than embeds.
   *   - Google One Tap (`src/components/auth/google-one-tap.tsx`) DOES load
   *     `https://accounts.google.com/gsi/client` and has Google inject an
   *     iframe for the prompt — both allowed below.
   *   - Supabase (`NEXT_PUBLIC_SUPABASE_URL`, a `*.supabase.co` host) is
   *     called directly from the browser client for auth/session calls.
   *
   * THE CSP IS REPORT-ONLY, DELIBERATELY, NOT A CONFIG OVERSIGHT. Everything
   * else here (HSTS, nosniff, frame protection, Referrer-Policy) is safe to
   * enforce immediately — none of it can break a legitimate page load. A CSP
   * is different: `'unsafe-inline'` is still present below because Next.js's
   * own inline bootstrap scripts and this app's few inline styles haven't
   * been audited against a nonce-based policy, and shipping an enforcing CSP
   * that turns out to block one of those would take down real pages rather
   * than just log a violation. Report-Only mode is how that gets tightened
   * safely: watch `report-to`/browser devtools for real violations against
   * real traffic, remove `'unsafe-inline'` once nothing depends on it, and
   * only then switch this to the enforcing header name.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com`,
      "frame-src https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        // Every route — these are response-header policies, not per-page
        // content, so there's no reason to scope them narrower.
        source: "/:path*",
        headers: [
          {
            // includeSubDomains + a year, matching how HSTS is meant to be
            // deployed once a site is fully HTTPS (this one already is, on
            // Vercel) — preload is left off deliberately: submitting to the
            // browser preload list is effectively permanent (removal takes
            // months to propagate), and that's a call for the founder to
            // make explicitly, not a default this config should reach for.
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Belt-and-braces with the CSP's own frame-ancestors 'none' above
          // — legacy-browser fallback, since X-Frame-Options predates CSP2.
          { key: "X-Frame-Options", value: "DENY" },
          // Sends the full URL to a same-origin navigation/fetch, only the
          // origin cross-origin — never nothing, so analytics/referral
          // attribution this app already relies on (Refer & Earn) still
          // works for same-site traffic, but a click OUT to an external job
          // posting doesn't hand that site a full internal URL.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
