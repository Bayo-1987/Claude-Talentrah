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

/**
 * Page metadata with the social tags filled in from the same strings.
 *
 * ── THE NEXT.JS BEHAVIOUR THIS EXISTS FOR ─────────────────────────────────
 *
 * `openGraph` and `twitter` are REPLACED by a child, not merged field by
 * field. Two consequences, and this codebase hit both:
 *
 *   - a page that declares `openGraph` without `images` loses the inherited
 *     image (the job pages, fixed earlier in this work)
 *   - a page that declares only `title`/`description` and NO `openGraph` never
 *     contributes to og:title at all, so it silently inherits the root's
 *     generic "Talentrah" — which is what /about, /blog, every blog post and
 *     all three legal pages were doing
 *
 * The second is the nastier one because the page looks correct: the `<title>`
 * tag is right, the meta description is right, and only the share card is
 * generic. Nothing surfaces it short of reading the `<head>`.
 *
 * So: one place that takes the title and description ONCE and emits all three
 * representations. A page passing through here cannot have a `<title>` and an
 * `og:title` that disagree, because they come from the same argument.
 */
export function pageMetadata(input: {
  title: string;
  description: string;
  /** Site-relative path, for og:url and the canonical link. */
  path: string;
  /** `article` for blog posts; anything else is a plain page. */
  type?: "website" | "article";
}) {
  const { title, description, path, type = "website" } = input;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      type,
      images: [SHARE_IMAGE_META],
    },
    twitter: {
      // `summary`, not `summary_large_image` — see SHARE_IMAGE above.
      card: "summary" as const,
      title,
      description,
      images: [SHARE_IMAGE],
    },
  };
}
