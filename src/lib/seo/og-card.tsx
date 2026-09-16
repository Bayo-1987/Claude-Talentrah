import { ImageResponse } from "next/og";

/**
 * The one Editorial share card, rendered by every `opengraph-image` route.
 *
 * ── WHY THESE PAGES AND NOT ALL OF THEM ───────────────────────────────────
 *
 * `SHARE_IMAGE` (lib/seo/site.ts) is still correct for /about, /employer, the
 * legal pages and the homepage: they share one message, so one brand mark is
 * an honest card and a per-page render would be three fonts of work to say
 * "Talentrah" slightly differently. The three families that route through
 * here — a job, a blog post, a city/remote landing page — are the ones a
 * seeker actually forwards to one other person, usually on WhatsApp, where
 * the preview IS the pitch (§6.7). Those cards have to say WHICH job.
 *
 * ── SATORI IS NOT A BROWSER, AND FAILS QUIETLY ────────────────────────────
 *
 * `ImageResponse` renders through Satori: flexbox only, a subset of CSS, and
 * anything it does not understand is IGNORED rather than thrown. Two
 * consequences this file is written around:
 *
 *   - EVERY colour here is a hex literal, not an `oklch()` token. Satori's
 *     bundled colour parser has no oklch support at all (verified: the string
 *     "oklch" does not appear anywhere in next/dist/compiled/@vercel/og), so
 *     the design system's own `--ink` would have rendered as transparent
 *     black with no error. The hex values below are that palette converted
 *     through OKLab→linear-sRGB→sRGB, not eyeballed — see the table.
 *   - every container sets `display: "flex"` explicitly. Satori throws on a
 *     multi-child element with the default `display: block`, and silently
 *     mislays a single-child one.
 *
 * Neither is visible from `tsc` or lint, which is why these routes were
 * verified by fetching the rendered PNG, not by compiling.
 */

/**
 * Editorial palette, converted from the oklch source of truth in
 * CLAUDE.md / globals.css. Keep both in step — these are the SAME colours,
 * spelled in the only notation Satori can read.
 *
 *   --paper     oklch(97% 0.014 85)   #f9f5eb
 *   --ink       oklch(20% 0.018 50)   #1d140f
 *   --ink-soft  oklch(38% 0.02 50)    #4c3f39
 *   --rust      oklch(52% 0.14 40)    #a94620
 *   --line      oklch(78% 0.02 60)    #c1b5ab
 */
const PAPER = "#f9f5eb";
const INK = "#1d140f";
const INK_SOFT = "#4c3f39";
const RUST = "#a94620";
const LINE = "#c1b5ab";

/** Standard Open Graph canvas. 1200x630 is what WhatsApp/Facebook/X expect. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * The real Newsreader and Source Sans 3 bytes, fetched from Google Fonts.
 *
 * `next/font` cannot supply these: its loader hands back a CSS class name, and
 * `ImageResponse` needs an ArrayBuffer. The alternative — committing .ttf
 * files or adding a font package — would put ~400KB into the deploy for an
 * asset only a crawler ever renders, against this project's low-bandwidth
 * priority. So: the CSS2 API, called WITHOUT a User-Agent header, which is
 * what makes Google answer with `format('truetype')` URLs instead of woff2.
 * That matters — Satori reads ttf/otf/woff and cannot decompress woff2.
 *
 * Memoized in a module-level promise so a warm instance fetches once, not once
 * per crawl. On any failure it resolves to `null` and the caller renders with
 * next/og's own bundled font instead: a card in the wrong typeface is a far
 * better outcome than a 500 where a share preview should be, and a font CDN
 * hiccup must not take the preview down.
 */
interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600&family=Source+Sans+3:wght@400;700";

/** The three faces, in the order the CSS2 response lists them. */
const FONT_FACES: ReadonlyArray<{ name: string; weight: 400 | 600 | 700 }> = [
  { name: "Newsreader", weight: 600 },
  { name: "Source Sans 3", weight: 400 },
  { name: "Source Sans 3", weight: 700 },
];

let fontsPromise: Promise<OgFont[] | null> | null = null;

async function loadFonts(): Promise<OgFont[] | null> {
  fontsPromise ??= (async () => {
    try {
      const css = await fetch(FONT_CSS_URL).then((r) => (r.ok ? r.text() : null));
      if (!css) return null;
      const urls = [...css.matchAll(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/g)].map((m) => m[1]);
      if (urls.length !== FONT_FACES.length) return null;
      const data = await Promise.all(
        urls.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : null))),
      );
      if (data.some((d) => d === null)) return null;
      return FONT_FACES.map((face, i) => ({
        ...face,
        data: data[i] as ArrayBuffer,
        style: "normal" as const,
      }));
    } catch {
      return null;
    }
  })();
  return fontsPromise;
}

/**
 * Hard character caps, picked for the WhatsApp preview rather than for the
 * 1200px canvas: the card is read at roughly thumbnail size, so a headline
 * that technically fits at 48px is not the same as one anybody reads. Cut on
 * a word boundary — a mid-word cut reads as broken rather than as elided,
 * the same rule /jobs/[id]'s own meta description already follows.
 */
function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** Bigger type for a short headline; the cap keeps three lines the worst case. */
function headlineSize(text: string): number {
  if (text.length <= 28) return 84;
  if (text.length <= 52) return 68;
  if (text.length <= 78) return 56;
  return 46;
}

export interface OgCardInput {
  /**
   * Eyebrow label. Per the design system it must literally describe what is
   * below it ("Job opening", "Talentrah blog") — no invented category names.
   * Uppercased here in JS rather than via `textTransform`, which Satori
   * supports inconsistently across font stacks.
   */
  eyebrow: string;
  /** The one thing the card exists to say: job title, post title, "32 jobs in Lagos". */
  headline: string;
  /** One supporting line — company · location, or nothing. */
  supporting?: string | null;
}

export async function renderOgCard({ eyebrow, headline, supporting }: OgCardInput) {
  const fonts = await loadFonts();
  const title = clamp(headline, 96);
  const sub = supporting ? clamp(supporting, 84) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PAPER,
          fontFamily: "Source Sans 3",
        }}
      >
        {/*
          The one piece of pure brand at thumbnail size. A full-bleed rust rule
          reads as Talentrah from across a chat list, where 30px of wordmark
          does not — and it is a rule, not a rounded chip, per the no-radius
          rule that governs every other surface.
        */}
        <div style={{ display: "flex", width: "100%", height: 14, backgroundColor: RUST }} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            padding: "52px 72px 44px 72px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 23,
              fontWeight: 700,
              letterSpacing: 3.2,
              color: RUST,
            }}
          >
            {eyebrow.toUpperCase()}
          </div>

          <div
            style={{
              display: "flex",
              width: "100%",
              height: 1,
              marginTop: 20,
              backgroundColor: LINE,
            }}
          />

          <div
            style={{
              display: "flex",
              marginTop: 30,
              fontFamily: "Newsreader",
              fontWeight: 600,
              fontSize: headlineSize(title),
              lineHeight: 1.14,
              color: INK,
            }}
          >
            {title}
          </div>

          {sub ? (
            <div
              style={{
                display: "flex",
                marginTop: 24,
                fontSize: 31,
                lineHeight: 1.35,
                color: INK_SOFT,
              }}
            >
              {sub}
            </div>
          ) : null}

          <div style={{ display: "flex", flexGrow: 1 }} />

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              borderTop: `2px solid ${INK}`,
              paddingTop: 22,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: "Newsreader",
                fontWeight: 600,
                fontSize: 32,
                color: INK,
              }}
            >
              Talentrah
            </div>
            <div style={{ display: "flex", fontSize: 22, color: INK_SOFT }}>talentrah.com</div>
          </div>
        </div>
      </div>
    ),
    fonts ? { ...OG_IMAGE_SIZE, fonts } : { ...OG_IMAGE_SIZE },
  );
}
