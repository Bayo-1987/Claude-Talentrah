import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { getAllPosts } from "@/lib/blog/posts";
import { absoluteUrl } from "@/lib/seo/site";

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
 * same change. Every other route under (app) still requires a session and is
 * deliberately absent.
 *
 * ── WHY THE JOBS QUERY IS NOT CACHED ──────────────────────────────────────
 *
 * `status = 'open'` is the point. Postings close continuously through the
 * ingest pipeline, and a stale sitemap advertising closed jobs is exactly the
 * failure Google's own JobPosting guidance calls out — it asks that expired
 * postings stop being served, and a cached list would keep offering them for
 * as long as the cache lived.
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

  const postEntries: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
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
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, posted_at")
      .eq("status", "open")
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

  return [...staticEntries, ...postEntries, ...jobEntries];
}
