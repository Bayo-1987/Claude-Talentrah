/**
 * Renders a Naira amount as ONE text node ("₦2,500"), for use anywhere, including inside a `font-display` (Newsreader) context.
 *
 * send-503 (S18): the sign and the digits used to be two things, `<span class="font-body">₦</span>` plus a bare text node, so a
 * reader that walks nodes could announce a price as "2,500" with no currency. One string fixes that at the source.
 *
 * Why the separate span existed (send-401): the Newsreader the app shipped then had no glyph for U+20A6, so the sign was set in the
 * body font. Since the font families were self-hosted with every unicode-range subset (#604), Newsreader's latin-ext file DOES
 * carry U+20A6 (checked in the committed woff2 with fontTools: the file is newsreader-normal-latin-ext-w400_500_600), and the
 * @font-face unicode-range (U+20A0-20AB) makes the browser fetch it when a ₦ is rendered. If that file were ever dropped, the browser
 * would fall back per glyph, which is the degraded case the old span avoided: check `/employer/campaigns`'s wallet balance on a real
 * screen after any font change.
 *
 * The amount is formatted `en-NG` (grouped thousands, no decimals unless the number has them).
 */
export function NairaAmount({ amount }: { amount: number }) {
  return <>{`₦${amount.toLocaleString("en-NG")}`}</>;
}
