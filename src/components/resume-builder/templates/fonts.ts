import "@/fonts/source-sans-3/source-sans-3.css";
import { selfHostedFont } from "@/fonts/self-hosted-font";

/**
 * The six fixed templates' own body font — deliberately independent of the
 * app's `--font-body`. send-470 repointed that to IBM Plex Sans and, because
 * PDF export is literally Chromium's print-to-PDF pipeline over the same
 * rendered DOM/CSS the screen shows (see e2e/ats-safety.spec.ts's own header
 * on `page.pdf()`), the swap silently changed these templates' text
 * wrapping and page-break points and broke their ATS-safety section-order
 * guarantee. A resume a user has already downloaded, or been graded on by
 * an ATS, must render identically regardless of any future app-wide
 * redesign — the same reason Enhancv and other resume builders treat the
 * exported document as its own fixed product, not a themed page.
 *
 * Source Sans 3 specifically, not a new choice: it's the body face these
 * six templates were already tuned and proven safe against in the
 * ATS-safety suite before send-470 ever touched `--font-body`.
 *
 * `preload: false` / `display: "swap"` for the same reason
 * `skeletons/fonts.ts` gives its own four extra typefaces — this is
 * template-only weight, not something every page in the app should pay for.
 *
 * Because it is not preloaded, this is a COLD font load on a user's first
 * resume-builder visit — exactly the kind that can still be arriving when
 * they click "Download PDF". PrintButton therefore waits on the whole
 * document's fonts before `window.print()` (src/lib/resume-builder/
 * wait-for-fonts.ts); a new resume typeface needs no registration there.
 */
export const resumeSourceSans = selfHostedFont({ slug: "source-sans-3", family: "Source Sans 3", singleStyle: true });
