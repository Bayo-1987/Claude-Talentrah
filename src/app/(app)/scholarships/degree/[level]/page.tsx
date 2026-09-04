import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/seo/site";
import { LANDING_PAGE_MIN_ENTRIES, currentApplicationCycle } from "@/lib/seo/landing-pages";
import { liveScholarshipLandingLinks } from "@/lib/seo/landing-page-links";
import { loadScholarshipsByLevel } from "@/lib/seo/landing-page-data";
import { DEGREE_LEVEL_LABEL } from "@/lib/scholarships/types";
import { PublicScholarshipRow } from "@/components/scholarships/public-scholarship-row";
import { EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * Programmatic SEO landing page targeting "{degree level} scholarships"
 * ("MSc scholarships", "PhD scholarships for Nigerian students {cycle}").
 *
 * `[level]` covers all five scholarship_degree_level values (see
 * DEGREE_LEVEL_SLUG's own header) — an invalid slug 404s immediately before
 * any query runs; a valid slug still 404s if that level's live count is
 * below threshold. bsc, postgraduate_diploma and other are all under 5 in
 * production as of 2026-09-02, so they 404 today without any special-casing
 * — the same live check that gates msc and phd gates them too, and they
 * start working the moment enough scholarships at that level are verified.
 *
 * LIVE, NOT BUILD-TIME — see loadScholarshipsByLevel
 * (src/lib/seo/landing-page-data.ts) and
 * tests/seo/landing-page-liveness.test.ts for the proof.
 */
export const dynamic = "force-dynamic";

/**
 * ONE loader call per request, not two. Next.js runs generateMetadata and the
 * default export in the SAME request and both need the same result, so before
 * this each visit issued the count+page query pair twice. React's `cache()`
 * is request-scoped memoization and nothing more — deliberately not
 * `unstable_cache`, which persists ACROSS requests and would reintroduce
 * exactly the staleness the force-dynamic contract above exists to rule out.
 * Fresh on every request, once per request.
 *
 * The client is created INSIDE the helper, and the only argument is the plain
 * slug string, because `cache()` memoizes on ARGUMENT IDENTITY: passing the
 * client in would miss on every call (createClient() returns a new object
 * each time) and silently save nothing. loadScholarshipsByLevel keeps its
 * plain-client parameter (that is what lets
 * tests/seo/landing-page-data.test.ts call it outside a request); the
 * memoization boundary belongs here instead. The client is handed back so the
 * related-links query can reuse it.
 */
const scholarshipsByLevelForRequest = cache(async (levelSlug: string) => {
  const supabase = await createClient();
  return { supabase, result: await loadScholarshipsByLevel(supabase, levelSlug) };
});

export async function generateMetadata({ params }: { params: Promise<{ level: string }> }) {
  const { level: levelSlug } = await params;
  const { result } = await scholarshipsByLevelForRequest(levelSlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) return { title: "Scholarships — Talentrah" };

  const { level, total } = result;
  const label = DEGREE_LEVEL_LABEL[level];
  const cycle = currentApplicationCycle();
  const title = `${label} Scholarships for Nigerian Students ${cycle} | Talentrah`;
  const description = `${total} ${label} scholarships open for the ${cycle} cycle, verified against each provider's official page and always attributed and linked.`;
  return pageMetadata({ title, description, path: `/scholarships/degree/${levelSlug}` });
}

export default async function DegreeLevelScholarshipsPage({
  params,
}: {
  params: Promise<{ level: string }>;
}) {
  const { level: levelSlug } = await params;
  const { supabase, result } = await scholarshipsByLevelForRequest(levelSlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const { level, total, scholarships } = result;
  const label = DEGREE_LEVEL_LABEL[level];
  const cycle = currentApplicationCycle();
  const relatedLinks = await liveScholarshipLandingLinks(supabase, `/scholarships/degree/${levelSlug}`);

  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Talentrah home
      </Link>

      <div>
        <EyebrowLabel>Funding by degree level</EyebrowLabel>
        <h1 className="mt-1.5 text-[28px] leading-[1.2]">
          {label} Scholarships for Nigerian Students {cycle}
        </h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
          {total} programmes open to {label} applicants for the {cycle} cycle. Each listing states
          its own eligibility, funding type and deadline exactly as published on the provider&apos;s
          official page — Talentrah records the facts with attribution, it isn&apos;t the authority
          on any of them.
        </p>
      </div>

      {relatedLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-y border-line py-3 text-[13px]">
          <span className="font-semibold text-ink-soft">Also browsing:</span>
          {relatedLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-rust underline underline-offset-2 hover:text-rust-hover">
              {l.label}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {scholarships.map((s) => (
          <PublicScholarshipRow key={s.id} scholarship={s} />
        ))}
      </div>

      {total > scholarships.length && (
        <p className="text-[13.5px] text-ink-soft">
          Showing {scholarships.length} of {total} {label} programmes.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <Link
          href={`/signup?redirectTo=${encodeURIComponent("/scholarships")}`}
          className={buttonClasses("primary", "sm", "no-underline w-fit")}
        >
          Create a free account to save and track these
        </Link>
        <p className="text-[12.5px] text-ink-soft">
          Saving and tracking deadlines is free and unlimited. Farah can also check your
          eligibility against any listing here for a small number of credits.
        </p>
      </div>
    </div>
  );
}
