/**
 * The canonical absolute origin, for the things that cannot ask the request.
 *
 * `getSiteOrigin()` in lib/referrals/url.ts reads `x-forwarded-host` and is the
 * right answer inside a request — a share link should point at whatever host
 * the user is actually on. This is the opposite need. `metadataBase`,
 * `sitemap.ts` and `robots.ts` are evaluated without a request (and cached), so
 * they need ONE canonical answer, and the answer has to be the host Google
 * should index rather than whichever alias served the build.
 *
 * MEASURED RATHER THAN ASSUMED. Three hosts currently answer:
 *
 *   talentrah.com              -> 301 to www.talentrah.com
 *   www.talentrah.com          -> 200
 *   claude-talentrah.vercel.app -> 200, same build (Vercel's project alias)
 *
 * The apex redirecting to `www` is the site telling us which one it considers
 * canonical, so that is what ships. The `.vercel.app` alias answering too is
 * exactly why this is not derived from `VERCEL_URL`: that variable holds the
 * deployment's own hostname, so every preview would advertise itself as
 * canonical and a sitemap built on a preview would list preview URLs.
 *
 * Overridable by env because a domain change should not need a code change,
 * and because a self-hosted or staging deployment has a different truth.
 */
const FALLBACK_ORIGIN = "https://www.talentrah.com";

/** Canonical origin, no trailing slash. */
export const SITE_ORIGIN: string = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || FALLBACK_ORIGIN
).replace(/\/+$/, "");

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The default share image, as an absolute-resolvable path.
 *
 * Lives here rather than in the root layout because Next REPLACES a parent's
 * `openGraph` object when a child declares one — it does not merge field by
 * field. So a page that sets its own openGraph title/description silently
 * drops the inherited image unless it restates it, which is exactly how the
 * job pages ended up with no share image at all.
 *
 * 512x512 is the largest brand raster in public/icons, which is why the
 * Twitter card is `summary` rather than `summary_large_image` — the wide card
 * centre-crops a square into a sliver.
 */
export const SHARE_IMAGE = "/icons/talentrah-mark-512.png";
export const SHARE_IMAGE_META = {
  url: SHARE_IMAGE,
  width: 512,
  height: 512,
  alt: "Talentrah",
} as const;
