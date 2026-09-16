import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { freshnessFloorISO } from "@/lib/jobs/freshness";

/**
 * ONE loader call per request, not two. Next.js runs generateMetadata and the
 * default export in the SAME request and both need this row, so before this
 * fix each visit issued two separate `job_postings` queries — one narrow
 * (metadata's own column list), one `select("*")` (the page's). React's
 * `cache()` is request-scoped memoization: the page's own call hits this same
 * cached result rather than re-querying, and gets the full row for free since
 * metadata's fields are a subset of it.
 *
 * Client created INSIDE the helper, argument is the plain id string, because
 * `cache()` memoizes on ARGUMENT IDENTITY — same reasoning as the sibling SEO
 * landing pages' own `*ForRequest` loaders (scholarships/degree/[level],
 * jobs/remote/[country], jobs/in/[city]).
 *
 * generateMetadata's own notFound() does NOT fix this route's status-code bug
 * by itself — TESTED empirically against a real built server, see
 * (app)/scholarships/degree/[level]/page.tsx's comment on the same call for
 * the full result. The actual fix is this segment (and its ancestors) carrying
 * no loading.tsx at all; this loader exists for the query dedup, and
 * notFound() in generateMetadata is honest (a reader/crawler asking about a
 * missing job shouldn't get that job's own metadata shape back) rather than
 * load-bearing for the status code.
 *
 * ── WHY IT LIVES HERE AND NOT IN page.tsx ─────────────────────────────────
 *
 * `opengraph-image.tsx` needs the same row, and it is a SEPARATE route — its
 * own request, so `cache()` never spans the two and there is no dedup to be
 * had between them. What there IS to keep is one definition of the query:
 * the freshness floor, the `organizations!job_postings_organization_id_fkey`
 * hint, and the user's-own-client-not-service-role decision below are all
 * things a second copy would drift away from. The image card must show
 * exactly the job the page shows, including being absent for exactly the same
 * rows.
 *
 * READ THROUGH THE USER'S OWN CLIENT, never the service role. RLS is what
 * decides whether this posting is visible: an unverified company's listing
 * (0027), and a removed one (0056), are both invisible here for the same
 * reason they are invisible in the feed.
 */
export const jobForRequest = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_postings")
    /*
     * `organizations(verified)` is joined for ONE reason: the banner (0115).
     * The posting's own visibility is still RLS's decision — this adds no gate
     * — but whether the banner renders is a different, stricter question that
     * the row alone cannot answer.
     *
     * `!job_postings_organization_id_fkey` hints WHICH relationship: 0128
     * added a second FK to organizations (claimed_by_organization_id), so an
     * unhinted embed is ambiguous to PostgREST — this must stay the poster's
     * own org, never the org that claimed some OTHER external row.
     */
    .select("*, organizations!job_postings_organization_id_fkey(verified)")
    .eq("id", id)
    .gte("posted_at", freshnessFloorISO())
    .maybeSingle();
  return { supabase, data };
});
