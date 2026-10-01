# Resume PDF: server-side generation vs keeping `window.print()` (plan only)

Status: a plan, not an implementation. Nothing in this document is built, and
nothing in the code assumes it will be.

## The question

The resume PDF today is the browser's own print-to-PDF (`window.print()`, see
`src/components/resume-builder/print-button.tsx`). Should we instead render the
PDF on the server with headless Chromium on Vercel, so the user gets a file
from a button and the file is the same whichever browser they use?

## What print-to-PDF costs us today, and what has already been fixed

| Problem | State |
|---|---|
| Filename was the app's page title | Fixed: `<First>-<Last>-Resume` (`print-title.ts`) |
| No top/bottom margin on pages 2+ (`@page { margin: 0 }` is kept to suppress Chromium's header/footer) | Fixed: `ResumePrintSurface` repeats 0.5in with `box-decoration-break: clone`, measured per page in `e2e/resume-print-margins.spec.ts` |
| Button wording promised a download it cannot make | Fixed: "Save as PDF" plus a help line |
| Output depends on the user's browser, OS and print settings | **Not fixed.** Paper size follows the user's locale (A4 vs Letter), "Background graphics" is off by default, Safari and Firefox lay pages out differently, and a user can add headers/footers back in the dialog |
| The user has to find "Save as PDF" in a print dialog | **Not fixed**, only explained (the help line) |
| Mobile: Chrome on Android offers "Save as PDF" but Safari on iOS has no equivalent of a direct save | **Not fixed**; matters because the target market skews to low-end Android, where the print dialog is the weakest part of the flow |

The first three were the cheap, certain wins. The remaining three are exactly
what server-side generation would remove.

## Option A: keep print (recommended for now)

- Zero new infrastructure, zero per-export cost, no function-size risk.
- The exported document is the same DOM and CSS the user sees, and the ATS-safety
  suite (`e2e/ats-safety.spec.ts`) already proves what Chromium's print pipeline
  produces for it.
- Fonts are already solved for print: `waitForFontsSettled` holds the click until
  the self-hosted faces have loaded.
- Weakness: the browser variance above. We can only measure Chromium.

## Option B: headless Chromium on Vercel

Shape: a Route Handler (`POST /api/resume/pdf`, authenticated, rate-limited like
`/api/tailoring`) that launches Chromium, loads a print-only route that renders
the same `ResumePrintSurface`, calls `page.pdf({ format: "A4", printBackground:
true })` and streams the file back with a `Content-Disposition` filename built
from `resumePrintTitle`.

### Constraints that decide it (Vercel docs, checked 2026-10-01)

- Function size: **250 MB uncompressed** by default. "Large functions" up to
  **5 GB** are in beta and need Fluid compute with Active CPU; new projects are
  eligible by default, existing ones opt in with
  `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`.
- Memory: 2 GB / 1 vCPU default; 4 GB / 2 vCPU maximum on Pro.
- Duration: 300 s default and maximum on Hobby; 800 s on Pro.
- Response body: **4.5 MB** maximum. A resume PDF is far below that, but it means
  the file must come back in the response, not be proxied from a larger source.
- This project deploys to `arn1` (`vercel.json`), so the function runs in
  Stockholm, a long way from most Nigerian users; the PDF itself is small, so
  latency is dominated by the cold start below, not the transfer.

### Candidate packages

- **`@sparticuz/chromium`** (the maintained serverless Chromium build) with
  **`puppeteer-core`** or `playwright-core`. The full package carries a
  brotli-compressed Chromium binary (tens of MB packed, roughly 150 MB or more
  unpacked in `/tmp`; **not measured here**), which on its own approaches the
  250 MB default once traced into the function with the rest of the app's
  server dependencies.
- **`@sparticuz/chromium-min`**: no binary in the bundle. `executablePath()`
  downloads a hosted `chromium-pack.tar` at cold start. Keeps the function well
  under 250 MB, at the price of a cold-start download and a file we must host
  (our own storage or `public/`).
- Playwright is already a devDependency for e2e. `playwright-core` plus
  `@sparticuz/chromium` is a workable pairing, but `playwright install` browsers
  are not usable on Vercel; the binary must come from `@sparticuz`.

Because `pdf-parse`/`pdfjs-dist` already needed `serverExternalPackages`
(`next.config.ts`), expect the same for `puppeteer-core` and `@sparticuz/*`, plus
`outputFileTracingIncludes` for the Chromium files.

### Cold start and cost

- A cold invocation has to start Node, unpack (or download) Chromium, and
  launch it before it renders. The community reports for this stack are
  seconds, not milliseconds (commonly quoted as 3 to 8 seconds cold, around 1
  to 2 seconds warm). **These are quoted, not measured on this project**; a
  spike would measure them, from `arn1`, with this app's fonts.
- Billing is Active CPU plus provisioned memory time. A 2 to 4 GB function
  running 2 to 8 seconds per export is cheap per click, but it is a new
  per-export cost where print is free, and PDF export is a free action today
  (build prompt 6.9: free and uncapped for zero-AI-cost actions). It would need a
  rate limit (the same `consumeRateLimit` the tailoring route uses) to avoid
  becoming an abuse vector.
- Low-end Android on mobile data: waiting 5 to 10 seconds on a spinner for a
  file is worse than the print dialog appearing instantly. Print's weakness is
  fiddliness, not slowness.

### Fonts

The repo self-hosts every face under `src/fonts/` (about 1.5 MB: Newsreader, IBM
Plex Sans, Source Sans 3 for the resume document, plus the template typefaces).
Server-side, Chromium has no system fonts on Vercel, so:

- The print route must load the faces the way the app does, via `@font-face`
  from our own origin, and the handler must wait for `document.fonts.ready`
  before `page.pdf()`, the server-side twin of `waitForFontsSettled`.
- Because the route is fetched by the function itself, it must be reachable from
  the function (its own deployment URL) and must not require the user's session
  cookie. Either the handler passes the resume to the page in a signed, short-lived
  token, or it renders the resume HTML directly with `renderToStaticMarkup`
  plus an inlined stylesheet and base64 font data, which avoids the self-request
  but means maintaining a second render path.
- `@sparticuz/chromium` ships a small set of fallback fonts only; a missing face
  must fail loudly (assert the document's `fonts.status`), not fall back silently.

### Risks specific to this app

- A second render path (or a self-fetched route) is a second place for the PDF
  to diverge from the preview. The ATS-safety suite would need to run against
  the server-generated file as well as the print one.
- Employers print an applicant's resume through the employer view. Server-side
  export there needs the same RLS-gated read (`employer_view_resume`) inside the
  function, and must keep `record_employer_resume_view` semantics unchanged.
- Chromium upgrades: `@sparticuz/chromium` tracks Chromium versions and has had
  breaking launch-flag changes between majors. Pin it.

## Recommendation

**Keep `window.print()` for now.** The defects that made the PDF look careless
(filename, missing margins, a misleading button) are fixed without new
infrastructure, and the remaining browser variance is a cost to users we have not
yet measured. Server-side generation costs a new binary in the deploy, a cold
start of several seconds on the exact devices where waiting hurts most, a
per-export cost on a currently free action, and a second render path to keep in
step with the preview.

Revisit it when there is evidence it is worth that, specifically any of:

1. Support or feedback reports PDFs with wrong paper size, missing backgrounds
   or browser headers on a meaningful share of exports.
2. Real analytics show iOS Safari seekers dropping out at the print dialog.
3. A product need that print cannot meet: emailing a PDF to an employer from the
   server, an "apply with this PDF" attachment, or a stable download URL.

If it is revisited, the cheap first step is a spike, not a build: one throwaway
route in a preview deployment, `@sparticuz/chromium-min` with `puppeteer-core`,
measuring cold and warm export time from `arn1`, function size, and whether the
output passes `e2e/ats-safety.spec.ts` and `e2e/resume-print-margins.spec.ts`
unchanged. That answers the open numbers above (cold start, size) with this app's
real fonts and bundle instead of with quoted figures.
