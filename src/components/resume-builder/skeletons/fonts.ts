import { Poppins, Work_Sans, Lora, Barlow_Condensed } from "next/font/google";

/**
 * The four typefaces added for the template library, beyond the app's own
 * DM Serif Display/DM Sans (`--font-display`/`--font-body`, declared in
 * `src/app/layout.tsx`). Each is self-hosted at build by `next/font/google` —
 * no runtime Google Fonts request, and nothing served from Supabase storage,
 * so none of this touches the org's egress cap (CLAUDE.md).
 *
 * `preload: false` ON PURPOSE, unlike the two in `layout.tsx`. Those two are
 * the app's own chrome and load on every page. These four are template-only —
 * a given resume uses at most two of them (`displayFont`/`bodyFont` per
 * `StyleTokens`) — and `layout.tsx` never imports this module, so a
 * `preload: true` here would mean an eager `<link rel="preload">` for all
 * four families on every resume-builder page regardless of which template is
 * open. That is real payload on the low-end-Android/expensive-mobile-data
 * target market this product is built for (CLAUDE.md non-functional
 * requirements). With `preload: false` the browser still only fetches a
 * family's font file when text on the page actually needs its glyphs — i.e.
 * when a skeleton's font-scope wrapper (`fontScopeClassName` below) has
 * actually put that family's CSS variable in scope AND some element carries
 * the matching `font-*` utility class.
 *
 * `display: "swap"` so an unloaded family never blocks first paint of the
 * document — same choice `layout.tsx` already makes for the two app fonts.
 */

// Geometric sans — Poppins. Genuinely geometric construction (near-circular
// bowls, single-story "a", monolinear strokes), which is what the "geometric
// sans" style-token bucket is named for. Distinct in voice from DM Sans
// (the app's own humanist body face) so choosing it for a resume reads as a
// real style decision, not the app's own UI font leaking into the document.
export const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
  preload: false,
});

// Humanist sans — Work Sans. Warmer, more open letterforms and a taller
// x-height than a geometric face, built specifically for UI/body reading at
// small sizes. Picked over reusing DM Sans (already the app's own body
// font) so a template that asks for "humanist sans" is visibly different from
// the app shell, not the default rendered twice.
export const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-worksans",
  display: "swap",
  preload: false,
});

// Modern serif — Lora. Moderate, book-like contrast built for body text
// rather than DM Serif Display's higher-contrast editorial/display voice. The
// two need to read as different registers since a gallery can show both at
// once — DM Serif Display stays the app's own display serif; Lora is the "print resume"
// serif choice inside a template.
export const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  display: "swap",
  preload: false,
});

// Grotesque/condensed — Barlow Condensed. A true condensed grotesque (drawn
// narrow, not a regular face squeezed by a CSS transform), for the
// dense/timeline-heavy configurations where a long senior history needs to
// fit without shrinking type past legibility — the literal brief for
// `compact-dense`.
export const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
  preload: false,
});

/** Which next/font `.variable` a given `Typeface` token needs in scope, or `null` for the two app fonts already scoped globally by `layout.tsx`. */
export function typefaceVariable(typeface: import("./types").Typeface): string | null {
  switch (typeface) {
    case "display":
    case "body":
      return null;
    case "geometric":
      return poppins.variable;
    case "humanist":
      return workSans.variable;
    case "modern-serif":
      return lora.variable;
    case "condensed":
      return barlowCondensed.variable;
  }
}
