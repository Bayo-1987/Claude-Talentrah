# Mobile / low-bandwidth payload audit (send-latency-4, 2026-09-11)

Flagged as undone in `phase-1-summary.md`'s very first end-of-build summary
(2026-08-25) and never revisited since. This is that check, done for real
against a production build and, for the landing page, cross-checked against
the live deployment — not "looks fine."

## Method

Real per-page transfer weight was measured via the browser's own
`performance.getEntriesByType("resource"/"navigation")` — `transferSize` is
the actual encoded bytes that crossed the wire for that request, not a
guess from source size. Measured against a local `next start` production
build (Turbopack, minified) logged in as the real demo account with real
seed data, then cross-checked against `https://claude-talentrah.vercel.app/`
directly for the landing page: **381 KB locally vs 392 KB live**, and the
three font files were byte-identical between the two — confirming the
local numbers are a trustworthy proxy for production, not an artefact of
testing against the wrong build.

No literal Chrome DevTools network-throttling profile was available through
this session's tooling, so Slow 3G / Fast 3G times below are a **throughput-only
extrapolation** from the real measured byte counts (50 KB/s and 200 KB/s
respectively) — real-world time on an actual throttled/lossy mobile network
would be measurably higher, especially on Slow 3G, because each of the
dozen-plus separate requests a page fires costs its own fixed round-trip
latency that a pure KB/s throughput number doesn't capture at all.

## Real numbers, per page (warm session unless noted)

| Page | Transfer | Slow 3G (extrapolated) | Fast 3G (extrapolated) |
|---|---:|---:|---:|
| Landing page (`/`, cold, first visit) | 381–392 KB | ~7.6–7.8s | ~1.9–2.0s |
| Job feed (`/jobs`, warm nav) | +22 KB | +0.44s | +0.11s |
| Tailor (`/tailor`, warm) | +26 KB | +0.52s | +0.13s |
| Resume Builder gallery (`/resume-builder`, warm) | +124 KB | +2.5s | +0.62s |
| Resume Builder editor (`/resume-builder/edit`, warm) | +199 KB | +4.0s | +1.0s |

"Warm" means Next.js's own `<Link>` prefetching had already primed that
route's JS from an earlier page in the same session (confirmed by
`transferSize: 0` on the shared framework chunks — a cache hit, not a
measurement gap) — the realistic case for someone browsing rather than
landing cold on a deep link. A cold arrival directly on an inner
authenticated page pays a similar ~200–250 KB one-time framework+font tax
on THAT page instead; the tax is paid once per session either way, not once
per page.

**Cumulative cost of the whole core journey (landing → feed → tailor →
resume builder gallery → editor), first visit:** ~752 KB total, ~15.2s on
Slow 3G, ~3.85s on Fast 3G (both throughput-only, see caveat above).

## Client-JS-per-route: mostly already disciplined

The two largest JS chunks (~73 KB / ~69 KB, present on every page) are
shared framework/vendor code, paid once per session and then cached with
`Cache-Control: public, max-age=31536000, immutable` — confirmed directly
against a real chunk response. Route-specific JS beyond that is modest
(single-digit-to-low-double-digit KB) for every page except the Resume
Builder, which is a genuinely complex editor (drag-reorder, live preview,
per-template font scoping) and is the heaviest page in the product by a
real margin — expected for what it does, not a leak.

## Font loading: already well-engineered, not a gap

Checked before assuming a problem: the app's own two fonts (Newsreader,
Source Sans — `src/app/layout.tsx`) are loaded via `next/font/google`,
which self-hosts them (no runtime Google Fonts request), applies
`font-display: swap` by default, and is already scoped to `subsets:
["latin"]` — the minimal subset, not the full multi-script character set.
152 KB for 2 families × 3–4 weights each is a real, legitimate content cost
of the design system's own typography choice, not a missing best practice.

The four additional template typefaces (`src/components/resume-builder/
skeletons/fonts.ts` — Poppins, Work Sans, Lora, Barlow Condensed) are
**already deliberately lazy**: `preload: false` on every one of them, with
the file's own header explaining exactly why — a `preload: true` here would
mean an eager `<link rel="preload">` for all four families on every
resume-builder page regardless of which template is actually open, which
the file names outright as "real payload on the low-end-Android/
expensive-mobile-data target market." A given resume uses at most two of
these four, and only that template's fonts actually load. The ~199 KB
measured for the editor page includes two of these four font files
(~60 KB + ~51 KB) for the one specific template that resume happened to
use — the genuine minimum cost of that template's typography, not waste.

**Conclusion: no font-loading fix needed.** This was checked with the
expectation of finding a real gap (unpreloaded fonts, full-charset
subsetting, a runtime Google Fonts call) and found instead that the
existing implementation already reasons through the exact tradeoff this
audit exists to check for.

## Image audit: job banners and org logos

**Job banners** — two render sites, both a deliberate plain `<img>`, not
`next/image`:
- Public job detail page (`jobs/[id]/page.tsx`) — real intrinsic
  `width={1600} height={400}`, CSS-scaled via `aspect-[4/1]`.
- Employer's own edit-page preview (`job-banner-upload.tsx`) — same image,
  but was missing explicit `width`/`height` (CSS aspect ratio only). Fixed
  in this same change: now uses the exact same `CROP_OUTPUT_WIDTH`/
  `CROP_OUTPUT_HEIGHT` constants the upload pipeline itself crops to, so
  the browser reserves layout space before the image loads instead of
  shifting once it does — same reasoning the public page already applies,
  just missing on the auth-gated low-traffic twin.

The `next/image` skip on the public page is itself deliberate and
documented (`jobs/[id]/page.tsx`'s own comment): proxying an
already-CDN-served, already-right-sized image through Next's image
optimizer would mean paying transform cost for an image already served at
the one size it's ever displayed — a real, reasoned tradeoff, not an
oversight. Confirmed there is no `images` block in `next.config.ts` at all
(no `remotePatterns`), so this isn't a case of "should have configured it
and didn't" — `next/image` was never going to work against Supabase
Storage without that config existing, and the app doesn't use `next/image`
anywhere in `src/` at all.

**Upload-time sizing, the real answer to "full original resolution or
not?":** every banner is client-side cropped onto a fixed 1600×400 canvas
before it ever reaches the server (`banner-crop.ts`'s `renderCroppedBanner`,
PNG-then-JPEG-q0.9 fallback past 1.5 MB) — roughly a DPR-2 target for the
760px display width, not an arbitrary multi-megapixel original. The
server-side check is more permissive as a defense-in-depth backstop
(1200–3000px, up to 2 MB) and its own comment already names the gap: "with
no server-side re-encoding, the cap is the worst case" for a caller that
bypasses the UI entirely — a real but narrow, non-UI-reachable gap, not
something a real employer using the product would ever hit.

**Organization/company logos are never rendered as an image anywhere in
the app.** `organization.logo_url` is a free-text field an employer can
type in, saved but never read back into an `<img>`; `job_postings.company_logo_url`
is selected for feed/landing queries but its only consumer is invisible
JSON-LD structured data for search engines. Every visible "logo" in the UI
(job cards, the public job row, the job detail page) is a CSS two-letter
initials badge (`getCompanyInitials`) — zero image bytes. This matches the
design system's own stated rule (`CLAUDE.md`: "44×44px square `--ink`-bg
two-letter company badge — never a brand color") directly.

## What this audit changed

One concrete fix: explicit `width`/`height` on the employer's own banner
preview (`job-banner-upload.tsx`), matching the public page's existing
CLS-prevention pattern. Everything else checked out as already handling
this constraint deliberately — the value of this pass was confirming that
with real numbers and real evidence, not finding a pile of bugs to fix.

## What's still open

- The server-side banner-size backstop (1200–3000px / 2 MB, no
  re-encoding) is real headroom for a non-UI caller — not urgent, not
  reachable through the product as shipped, worth a note for whoever next
  touches `src/lib/employer/banner.ts` rather than a fix here.
- No actual DevTools-simulated Slow 3G/Fast 3G run (packet loss, real RTT,
  connection setup overhead) was performed — the numbers above are a
  throughput-only extrapolation from real transfer bytes, clearly weaker
  evidence than a literal throttled trace. Worth doing for real once there's
  browser tooling in this workflow that exposes network-condition
  emulation directly, rather than approximating it by arithmetic.
