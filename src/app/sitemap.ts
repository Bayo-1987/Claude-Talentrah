import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { getAllPosts } from "@/lib/blog/posts";
import { absoluteUrl } from "@/lib/seo/site";
import { CITY_LANDING_PAGES, DEGREE_LEVEL_SLUG, LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { Constants } from "@/lib/supabase/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";

/**
 * The sitemap, generated rather than listed.
 *
 * ── WHAT IS IN IT, AND THE RULE ───────────────────────────────────────────
 *
 * Only URLs a signed-out visitor actually receives a 200 for. That rule is the
 * whole design: a sitemap is a claim that these pages exist and are worth
 * indexing, and listing a URL that answers with a redirect to /login is a
 * claim that is false. Google treats a sitemap full of redirects as a quality
 * problem with the site, not as a hint to try harder.
 *
 * So job postings appear here ONLY because /jobs/[id] was made public in the
 * same change, and scholarships ONLY because /scholarships/[id] was made
 * public the same way, later. Every other route under (app) still requires a
 * session and is deliberately absent.
 *
 * ── WHY THE JOBS AND SCHOLARSHIPS QUERIES ARE NOT CACHED ──────────────────
 *
 * `status = 'open'` and `moderation_status = 'verified'` are the point in each
 * case. Postings close continuously through the ingest pipeline, and
 * scholarships are re-checked on a Mon/Wed/Fri schedule plus a daily expiry
 * sweep — a stale sitemap advertising a closed posting or an expired
 * scholarship is exactly the failure Google's own JobPosting guidance calls
 * out generalised to a second catalog: it asks that expired listings stop
 * being served, and a cached list would keep offering them for as long as the
 * cache lived. Filtering on `moderation_status` here is also the sitemap's own
 * defence in depth on top of RLS (0084) — even if this query ever ran with
 * elevated credentials, it would still only ever list what a signed-out
 * visitor can actually load.
 */
export const dynamic = "force-dynamic";

/** Marketing and legal pages that render without a session. */
const STATIC_PATHS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/employer", priority: 0.7, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.7, changeFrequency: "weekly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/data-cookie-notice", priority: 0.3, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((p) => ({
    url: absoluteUrl(p.path),
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  /*
   * From the database now, not a directory listing — so a post published from
   * /admin/blog appears here without a deploy, and an unpublished one drops
   * out. `getAllPosts` filters `status = 'published'`, the same discipline the
   * job entries below use to exclude closed postings: a sitemap must only ever
   * claim URLs that actually answer 200.
   */
  const postEntries: MetadataRoute.Sitemap = (await getAllPosts()).map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: new Date(post.date),
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  /*
   * Failure here degrades to the static entries rather than throwing.
   *
   * A sitemap that 500s is worse than a short one: Google records the fetch
   * failure against the site and stops asking as often. Logged rather than
   * swallowed — the same rule applied to the Auto-Apply scan in #134, and for
   * the same reason: a silently short sitemap looks identical to a site with
   * no jobs.
   */
  let jobEntries: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    // Same 30-day floor as every other discovery surface
    // (src/lib/jobs/freshness.ts) — a URL claimed here that /jobs/[id]
    // itself now 404s for would be exactly the false claim this file's own
    // header rules out.
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, posted_at")
      .eq("status", "open")
      .gte("posted_at", freshnessFloorISO())
      .order("posted_at", { ascending: false });
    if (error) throw new Error(error.message);
    jobEntries = (data ?? []).map((job) => ({
      url: absoluteUrl(`/jobs/${job.id}`),
      lastModified: new Date(job.posted_at),
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));
  } catch (err) {
    console.error("[sitemap] could not list open postings:", err);
  }

  /*
   * NO .eq("moderation_status", "verified") HERE, and that is deliberate,
   * not an oversight — checked directly against how this table's own list
   * page already reasons about the same gate (src/app/(app)/scholarships
   * /page.tsx): "there is deliberately no .eq(...) here. The gate lives in
   * RLS... Enforcing it here as well would imply the filter is what's
   * protecting users, and the next page that forgets it would silently leak
   * an unreviewed listing."
   *
   * That reasoning transfers here more exactly than it first looks like it
   * would. The jobs block above DOES filter on `status = 'open'`, and needs
   * to: job_postings' RLS policy (0027) gates on organisation verification
   * and membership, not on `status`, so a closed posting stays visible to
   * RLS and the app is genuinely what keeps it out of the sitemap.
   * scholarships' RLS policy gates on `moderation_status` DIRECTLY — the
   * exact column this filter would repeat — so removing it was tried and
   * changed nothing: a pending or expired-into-rejected row still does not
   * appear, because 0084's policy already excludes it. Sabotage-proven, not
   * assumed: the filter was removed here, the pending-listing e2e test
   * (e2e/scholarship-sitemap.spec.ts) still passed, and it was removed for
   * real rather than restored out of caution.
   */
  let scholarshipEntries: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("scholarships")
      .select("id, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    scholarshipEntries = (data ?? []).map((row) => ({
      url: absoluteUrl(`/scholarships/${row.id}`),
      lastModified: new Date(row.updated_at),
      // Not daily like jobs: the recheck/expiry cadence for scholarships is
      // Mon/Wed/Fri plus a daily sweep, not a continuous ingest.
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch (err) {
    console.error("[sitemap] could not list verified scholarships:", err);
  }

  /*
   * Programmatic landing pages (src/lib/seo/landing-pages.ts) — the
   * 200-only rule extended to content-emptiness, not just auth-redirects.
   * A page here answers 200 only while its own live count clears
   * LANDING_PAGE_MIN_ENTRIES (each page's own route re-checks the identical
   * condition on every request and 404s below it), so this block runs the
   * SAME queries rather than assuming a page that was live yesterday still
   * is — a category that empties out from the job-expiry sweep or a
   * scholarship deadline passing must drop out of the sitemap the same run
   * it happens, with no deploy.
   */
  const landingPageEntries: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    const today = new Date().toISOString().slice(0, 10);
    const stillOpen = `application_deadline.is.null,application_deadline.gte.${today}`;
    const jobFreshnessFloor = freshnessFloorISO();

    const { count: remoteCount } = await supabase
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .eq("work_type", "remote")
      .gte("posted_at", jobFreshnessFloor);
    if ((remoteCount ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
      landingPageEntries.push({
        url: absoluteUrl("/jobs/remote"),
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }

    for (const city of CITY_LANDING_PAGES) {
      const { count } = await supabase
        .from("job_postings")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .or(city.locationPatterns.map((p) => `location.ilike.${p}`).join(","))
        .gte("posted_at", jobFreshnessFloor);
      if ((count ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
        landingPageEntries.push({
          url: absoluteUrl(`/jobs/in/${city.slug}`),
          lastModified: now,
          changeFrequency: "daily",
          priority: 0.7,
        });
      }
    }

    const { count: fullyFundedCount } = await supabase
      .from("scholarships")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "verified")
      .eq("funding_type", "full")
      .or(stillOpen);
    if ((fullyFundedCount ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
      landingPageEntries.push({
        url: absoluteUrl("/scholarships/fully-funded"),
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    for (const level of Constants.public.Enums.scholarship_degree_level) {
      const { count } = await supabase
        .from("scholarships")
        .select("id", { count: "exact", head: true })
        .eq("moderation_status", "verified")
        .contains("degree_levels", [level])
        .or(stillOpen);
      if ((count ?? 0) >= LANDING_PAGE_MIN_ENTRIES) {
        landingPageEntries.push({
          url: absoluteUrl(`/scholarships/degree/${DEGREE_LEVEL_SLUG[level]}`),
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.6,
        });
      }
    }
  } catch (err) {
    console.error("[sitemap] could not list programmatic landing pages:", err);
  }

  return [...staticEntries, ...postEntries, ...jobEntries, ...scholarshipEntries, ...landingPageEntries];
}
