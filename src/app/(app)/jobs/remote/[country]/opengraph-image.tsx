import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCountryRemoteJobs } from "@/lib/seo/landing-page-data";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { OG_CONTENT_TYPE, OG_IMAGE_SIZE, renderOgCard } from "@/lib/seo/og-card";

/**
 * The share card for /jobs/remote/[country], carrying the LIVE count.
 *
 * Same contract as the city card next door, for the same reasons: the
 * below-threshold gate runs HERE too (a share image for a page that 404s is a
 * thin page with better packaging), `force-dynamic` because the count is in
 * the headline and this feature decides nothing at build time, and
 * `loadCountryRemoteJobs` is the page's own query rather than a second one —
 * see (app)/jobs/in/[city]/opengraph-image.tsx for the long version.
 */
export const dynamic = "force-dynamic";

export const alt = "Open remote jobs on Talentrah";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ country: string }> }) {
  const { country: countrySlug } = await params;
  const supabase = await createClient();
  const result = await loadCountryRemoteJobs(supabase, countrySlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const { country, total } = result;
  return renderOgCard({
    eyebrow: `Remote roles in ${country}`,
    headline: `${total} remote jobs in ${country}`,
    supporting: "Matched against your resume, free to browse.",
  });
}
