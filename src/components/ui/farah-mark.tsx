/**
 * Farah's brand mark — two overlapping circles, nothing else. No stock
 * photography or fake human avatars for Farah anywhere in the product
 * (design handoff §7).
 */

/**
 * Smallest stroke, in CSS pixels, that renders as a line rather than a smudge.
 *
 * ── WHY THE STROKE CANNOT JUST BE 2.2 ─────────────────────────────────────
 *
 * A viewBox scales everything uniformly, stroke included. This mark was drawn
 * for its 200px marketing usage, where `strokeWidth="2.2"` in a 220-unit
 * viewBox lands at a clean 2.0 CSS px. Every other usage is an icon, and there
 * the same number collapses:
 *
 *   size 200 (marketing hero)     2.00px   fine, and why this went unnoticed
 *   size  28 (first-visit hint)   0.28px
 *   size  22 (mobile bar)         0.22px
 *   size  18 (masthead nav)       0.18px
 *
 * Below 1px a stroke has no whole pixel to occupy, so the renderer spreads it
 * across neighbours as partial coverage — a pale blur rather than a thin line.
 * It is not a density problem: 0.18px is 0.36 device px even at 2x, still
 * sub-pixel, so it looks washed out on a retina phone exactly as it does on a
 * cheap monitor. The 200px usage looked correct throughout and is precisely
 * what hid this.
 *
 * ── WHY NOT vector-effect="non-scaling-stroke" ────────────────────────────
 *
 * It is the direct fix and it over-corrects, which was measured rather than
 * assumed by rendering all three candidates side by side. `non-scaling-stroke`
 * pins the stroke at 2.2 CSS px at EVERY size — 1.1% of the mark at 200px, but
 * 12% of it at 18px, where the circles are only 3.8px in radius. The outlines
 * thicken into a blob and the two circles stop reading as two circles.
 *
 * The stroke should be constant in DEVICE pixels while the geometry scales,
 * which is what optical sizing means for an icon. So: keep the drawn width
 * wherever it already works, and raise it only where it would fall below one
 * pixel.
 */
const MIN_STROKE_PX = 1.25;

/** The viewBox is 220 units square; `strokeWidth` is in those units. */
const VIEWBOX = 220;
const DRAWN_STROKE = 2.2;

export function FarahMark({ size = 200 }: { size?: number }) {
  /*
   * Rendered width is `strokeWidth * size / VIEWBOX`, so the width that yields
   * MIN_STROKE_PX at this size is `MIN_STROKE_PX * VIEWBOX / size`. Taking the
   * larger of that and the drawn 2.2 means nothing changes at or above 125px —
   * the marketing mark is byte-identical to what shipped — and everything
   * below it is lifted to exactly one and a quarter pixels.
   *
   * 1.25 rather than 1.0: at 18px a 1.0px stroke is legible but thin against
   * the ink text beside it, and 1.5px starts to close up the overlap. Chosen
   * by rendering 1.0 / 1.25 / 1.5 at 18, 22 and 28 and looking at them
   * magnified, not by picking a round number.
   */
  const strokeWidth = Math.max(DRAWN_STROKE, (MIN_STROKE_PX * VIEWBOX) / size);

  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" aria-hidden="true">
      <circle cx="110" cy="110" r="108" fill="var(--rust-soft)" />
      <circle cx="88" cy="96" r="46" stroke="var(--rust)" strokeWidth={strokeWidth} fill="none" />
      <circle cx="132" cy="128" r="46" stroke="var(--ink)" strokeWidth={strokeWidth} fill="none" />
      {/*
        The dot is FILLED, not stroked, so it thins rather than blurs — a small
        filled shape still covers whole pixels at its centre. Left at r=5,
        which is 0.4px at 18px and reads as a faint centre mark rather than a
        defect. Scaling it up would put a dot where the two outlines already
        overlap and turn the middle of the mark into a blot.
      */}
      <circle cx="110" cy="112" r="5" fill="var(--rust)" />
    </svg>
  );
}
