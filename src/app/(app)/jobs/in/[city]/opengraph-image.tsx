import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCityJobs } from "@/lib/seo/landing-page-data";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { OG_CONTENT_TYPE, OG_IMAGE_SIZE, renderOgCard } from "@/lib/seo/og-card";

/**
 * The share card for /jobs/in/[city], carrying the LIVE open-posting count.
 *
 * ── THE THRESHOLD APPLIES TO THE IMAGE, NOT JUST THE PAGE ─────────────────
 *
 * The page 404s below LANDING_PAGE_MIN_ENTRIES because a category page with
 * four results is doorway spam (see lib/seo/landing-pages.ts for the full
 * reasoning). A shareable image for a page that is not live would be that
 * same thin page wearing a share card — a crawler could fetch a perfectly
 * good "Jobs in X" graphic for a URL that answers 404. So the identical gate
 * runs here, on the identical live count.
 *
 * `force-dynamic` for the same reason the page has it: the count is IN the
 * headline. A statically optimized card would freeze a number that changes
 * every few hours, and the whole liveness contract of this feature
 * (tests/seo/landing-page-liveness.test.ts) is that nothing here is decided
 * at build time.
 *
 * `loadCityJobs` is the page's own query, called directly. The page wraps it
 * in a request-scoped `cache()` because ITS request runs the loader twice
 * (generateMetadata + body); this is a separate route and a separate request
 * that calls it exactly once, so there is nothing to memoize — what matters
 * is that it is the same query, not a second one that could drift.
 */
export const dynamic = "force-dynamic";

export const alt = "Open jobs by city on Talentrah";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const supabase = await createClient();
  const result = await loadCityJobs(supabase, citySlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const { city, total } = result;
  return renderOgCard({
    eyebrow: `Openings in ${city.displayName}`,
    headline: `${total} open jobs in ${city.displayName}`,
    supporting: "Matched against your resume, free to browse.",
  });
}
