/**
 * The two colours the installed app tells the operating system about, as hex.
 *
 * A web app manifest and the <meta name="theme-color"> tag cannot hold oklch(), so the paper token is written here as hex.
 *
 *   --paper (src/app/globals.css)  oklch(98% 0.004 90)  ->  #f9f8f5
 *
 * Converted with the CSS Color 4 oklch -> linear sRGB -> sRGB path (Ottosson's matrices), rounded to 8 bits, so it is the same colour a
 * browser paints for the token, not an eyeballed neighbour. tests/pwa/manifest.test.ts re-derives it from globals.css and fails if the
 * token or this constant moves without the other.
 */
export const PAPER_HEX = "#f9f8f5";
