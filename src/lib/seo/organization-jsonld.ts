import { SITE_ORIGIN, SHARE_IMAGE_META, absoluteUrl } from "./site";

/**
 * Organization and WebSite structured data — send-383.
 *
 * ── WHY THESE TWO, TOGETHER, HERE ─────────────────────────────────────────
 *
 * The homepage had zero structured data before this (checked: no other file
 * in this codebase emits a top-level Organization or WebSite block — the
 * only existing `"@type": "Organization"` values are the nested
 * `hiringOrganization`/`publisher` fields inside JobPosting and BlogPosting,
 * which describe a specific posting or article, not the site itself).
 * Organization and WebSite are Google's two site-identity schemas —
 * Organization tells Search who runs the site (name, logo, official
 * profiles), WebSite names the site and is the vehicle for a sitelinks
 * searchbox IF a real search entry point exists (it doesn't yet here — see
 * buildWebSiteJsonLd's own comment).
 *
 * Neither schema has a required-property set the way JobPosting does, so the
 * failure mode this guards against is the one blog-posting-jsonld.ts already
 * documents: not invalid markup, but a claim the site can't back up. That's
 * why `sameAs` is built from the exact same env vars marketing-footer.tsx
 * reads to decide which social/community icons to render, rather than a
 * hand-copied snapshot of today's live links — a WhatsApp community invite
 * link rotates, and a hardcoded value here would silently go stale the next
 * time it does, disagreeing with the footer that sits on the same page.
 *
 * ── WHY THIS FILE'S OUTPUT IS RENDERED ON THE HOMEPAGE, NOT ROOT LAYOUT.TSX
 *
 * Both job-posting-jsonld.ts and blog-posting-jsonld.ts render their
 * `<JsonLd>` at the page that describes that entity, not in a shared layout.
 * Root layout.tsx wraps every route in the app, so putting a site-identity
 * block there would repeat the identical <script> tag on every page render —
 * every job, every blog post, every legal page — for no benefit: Google's own
 * guidance places Organization/WebSite on the homepage specifically, it is
 * not per-page data that needs to travel with whichever URL is being served.
 */

/**
 * Read in the same order marketing-footer.tsx declares its own
 * `COMMUNITY_LINKS`/`SOCIAL_LINKS` arrays, and gated the same way (present
 * and non-empty, no other validation) — so this can never assert a profile
 * that the footer sitting on the same page doesn't actually link to.
 * Confirmed live on production before writing this: only the WhatsApp,
 * Telegram and X env vars are actually set there today; the rest resolve to
 * `undefined` and are filtered out below, exactly as they are in the footer.
 */
const SAME_AS_ENV_VARS = [
  "NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL",
  "NEXT_PUBLIC_TELEGRAM_CHANNEL_URL",
  "NEXT_PUBLIC_LINKEDIN_URL",
  "NEXT_PUBLIC_X_URL",
  "NEXT_PUBLIC_FACEBOOK_URL",
  "NEXT_PUBLIC_INSTAGRAM_URL",
  "NEXT_PUBLIC_THREADS_URL",
  "NEXT_PUBLIC_TIKTOK_URL",
  "NEXT_PUBLIC_REDDIT_URL",
] as const;

export function buildOrganizationJsonLd(): Record<string, unknown> {
  const sameAs = SAME_AS_ENV_VARS.map((key) => process.env[key]).filter(
    (url): url is string => !!url,
  );

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Talentrah",
    url: SITE_ORIGIN,
    // Same 512x512 brand mark blog-posting-jsonld.ts already uses for its own
    // publisher.logo — one asset, one convention, for the same reason.
    logo: absoluteUrl(SHARE_IMAGE_META.url),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/**
 * NO SearchAction.
 *
 * A sitelinks searchbox needs a real, publicly-reachable query-string search
 * entry point — Google substitutes `{search_term_string}` into the target URL
 * and expects genuine results back, including for its own signed-out crawler.
 * `/jobs?q={search_term_string}` looks like exactly that (the job feed does
 * read `params.q` as a real filter — see `(app)/jobs/(feed)/page.tsx`), but
 * checked live before wiring anything: `/jobs` requires a session and
 * redirects a signed-out request straight to `/login`.
 *
 *   $ curl -s -D - -o /dev/null "https://www.talentrah.com/jobs?q=engineer"
 *   HTTP/2 307
 *   location: /login?redirectTo=%2Fjobs%3Fq%3Dengineer
 *
 * Wiring a SearchAction at that URL would tell Google the search works for
 * anyone arriving from a search result, when in fact every one of them lands
 * on a login page instead of results — worse than the omission, not better.
 * Revisit if/when a public, unauthenticated job search surface exists.
 */
export function buildWebSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Talentrah",
    url: SITE_ORIGIN,
  };
}
