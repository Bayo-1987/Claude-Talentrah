import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * Columns any PUBLIC surface may render for a scholarship listing. Not
 * `select("*")`.
 *
 * RLS already governs which ROWS are visible (0084,
 * tests/rls/scholarship-public-read.test.ts) — a pending or rejected listing
 * is invisible to every role regardless of what this list contains. This is
 * a narrower, separate decision: `moderation_note` and `moderated_by` are an
 * admin's internal review trail, not the listing, and have zero value to a
 * reader while being the kind of thing an operator would not expect to see
 * rendered on a page (or, since the blog fact-card embed, a post) the entire
 * internet can load.
 *
 * Shared by the scholarship detail page and the blog's inline fact-card
 * embed (src/lib/blog/scholarship-embed.ts) so this list has exactly one
 * place to drift out of date — a second, independently-typed copy is how a
 * moderation-only column leaks through unnoticed the second time.
 */
export const PUBLIC_COLUMNS =
  "id, provider, program_name, host_institution, degree_levels, field_tags, funding_type, funding_covers, eligibility_nationalities, eligibility_prior_degree, eligibility_age, eligibility_other, application_deadline, deadline_note, cycle_year, official_url, source_name, moderation_status";

/**
 * Reads a scholarship the same way any public, signed-out-readable surface
 * must: through an anonymous-or-caller client, never the service role. RLS
 * (0084) decides visibility, so "no such id" and "not verified" collapse to
 * the same `null` here — on purpose, the same way the scholarship detail
 * page's `notFound()` answers both identically rather than leaking which
 * ids are real.
 *
 * `supabase` is injectable rather than always built here, because the two
 * current callers need genuinely different clients:
 *
 *   - the scholarship detail page (already fully dynamic — it reads the
 *     visitor's session via getOptionalUser for the save/Farah actions
 *     below the fold) passes nothing and gets `@/lib/supabase/server`'s
 *     cookie-aware client, same as before this was extracted.
 *   - the blog's scholarship fact-card embed (scholarship-embed.ts) MUST
 *     NOT call that client: the blog post page is ISR (`revalidate`), and
 *     calling `cookies()` inside an ISR render throws `DYNAMIC_SERVER_USAGE`
 *     — measured directly, not assumed, the first time this shipped. The
 *     embed needs no session anyway (no personalization, just a public
 *     fact), so it passes its own plain anon-key client instead.
 */
export async function loadPublicScholarship(id: string, supabase?: SupabaseClient<Database>) {
  const client = supabase ?? (await createClient());
  const { data } = await client
    .from("scholarships")
    .select(PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return data;
}
