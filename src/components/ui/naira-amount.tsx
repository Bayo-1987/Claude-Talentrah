/**
 * Renders a Naira amount for use INSIDE a `font-display` (Newsreader)
 * context — the big serif figures like `MatchTierBadge`'s 46px score, a
 * wallet balance, or a credit-pack price.
 *
 * send-401: Newsreader has no glyph for U+20A6 (₦), and its declared
 * fallback chain (`--font-display: var(--font-newsreader), Georgia, "Times
 * New Roman", serif` in globals.css) doesn't reliably supply one either —
 * confirmed with a real rendered screenshot of `/employer/campaigns`, where
 * the wallet balance "₦0" rendered as something readable as "N0" at 22px.
 * Source Sans 3 (this app's `--font-body`) DOES have the glyph: every
 * body-font currency string on the very same screens (the top-up presets,
 * "Top up (₦)") already renders correctly, which is the evidence this
 * component's fix relies on rather than a blanket font swap.
 *
 * So: keep the numerals in the inherited display font (matching
 * `MatchTierBadge`'s own precedent of a big font-display number, and this
 * task's brief not to change the page's visual hierarchy) and render ONLY
 * the ₦ sign in `font-body`, inline. Digits/comma/period are plain ASCII and
 * Newsreader renders those fine — this is not a "Newsreader can't do
 * numbers" bug, it is specifically the currency glyph.
 *
 * Not for body-font currency strings (e.g. a plain `₦${n}` inside a `<p>`)
 * — those already render correctly and don't need this treatment; wrapping
 * them too would be a no-op at best and an inconsistent pattern at worst.
 */
export function NairaAmount({ amount }: { amount: number }) {
  return (
    <>
      <span className="font-body">₦</span>
      {amount.toLocaleString("en-NG")}
    </>
  );
}
