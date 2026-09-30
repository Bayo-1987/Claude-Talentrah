/**
 * The three font files every page preloads: the latin subset of Newsreader (normal and italic) and of IBM Plex Sans —
 * exactly the files `next/font/google` preloaded for layout.tsx's two families. (The skeleton and template families
 * were `preload: false` and still are: a resume uses at most two of them, and the browser fetches a face only when text
 * needs it.)
 *
 * Each URL comes from importing the same file the family's CSS references with `url(./…)`, so it is the bundler's hashed
 * URL for that file and can only equal the one the stylesheet uses. `manifest.json` marks the same three files
 * `preload: true`; tests/fonts/self-hosted-fonts.test.ts holds the two lists equal.
 */
import plexSansLatin from "./ibm-plex-sans/ibm-plex-sans-normal-latin-w400_500_600_700-056e4e24.woff2";
import newsreaderItalicLatin from "./newsreader/newsreader-italic-latin-w400_500_600-19a83cc7.woff2";
import newsreaderNormalLatin from "./newsreader/newsreader-normal-latin-w400_500_600-2a69ec1c.woff2";

export const PRELOADED_FONT_URLS: readonly string[] = [newsreaderNormalLatin, newsreaderItalicLatin, plexSansLatin];
