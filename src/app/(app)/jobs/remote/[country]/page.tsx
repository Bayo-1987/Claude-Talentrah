import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/seo/site";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { liveJobLandingLinks } from "@/lib/seo/landing-page-links";
import { loadCountryRemoteJobs } from "@/lib/seo/landing-page-data";
import { COUNTRY_LANDING_SLUG } from "@/lib/jobs/country";
import { PublicJobRow } from "@/components/jobs/public-job-row";
import { EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * Programmatic SEO landing page for "{country}" remote roles — the honest,
 * actually-filtered counterpart to /jobs/remote's deliberately geography-free
 * page (see that page.tsx's own header for why the general page dropped its
 * country claim rather than substituting a broader one).
 *
 * `[country]` is NOT open to arbitrary path segments, same discipline as
 * `/jobs/in/[city]`: only the slugs in COUNTRY_LANDING_SLUG
 * (src/lib/jobs/country.ts) resolve; everything else 404s before a database
 * round trip.
 *
 * LIVE, NOT BUILD-TIME — same contract as loadRemoteJobs/loadCityJobs, see
 * landing-page-data.ts and tests/seo/landing-page-liveness.test.ts.
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
 * each time) and silently save nothing. loadCountryRemoteJobs keeps its
 * plain-client parameter (that is what lets
 * tests/seo/landing-page-data.test.ts call it outside a request); the
 * memoization boundary belongs here instead. The client is handed back so the
 * related-links query can reuse it.
 */
const countryRemoteJobsForRequest = cache(async (countrySlug: string) => {
  const supabase = await createClient();
  return { supabase, result: await loadCountryRemoteJobs(supabase, countrySlug) };
});

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }) {
  const { country: countrySlug } = await params;
  const { result } = await countryRemoteJobsForRequest(countrySlug);
  /*
   * notFound() HERE, not just in the page body below — TESTED, and this does
   * NOT fix the status code by itself. See scholarships/degree/[level]/
   * page.tsx's identical comment for the full empirical result: Next commits
   * to HTTP 200 the moment it decides a route can stream at all (any
   * ancestor loading.tsx is enough), independent of when generateMetadata
   * resolves or whether it calls notFound(). Kept anyway — still correct
   * behaviour, and via the shared `countryRemoteJobsForRequest` call it costs
   * no extra query — but the actual fix is this segment having no
   * loading.tsx ancestor (see (app)/loading.tsx and jobs/loading.tsx, both
   * absent).
   */
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const { country, total } = result;
  const title = `Remote Jobs in ${country} — ${total} Open Roles | Talentrah`;
  const description = `Browse ${total} remote job openings based in or restricted to ${country}, from verified employers and boards. Get matched, tailor your resume and apply free.`;
  return pageMetadata({ title, description, path: `/jobs/remote/${COUNTRY_LANDING_SLUG[country]}` });
}

export default async function CountryRemoteJobsPage({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country: countrySlug } = await params;
  const { supabase, result } = await countryRemoteJobsForRequest(countrySlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const { country, total, jobs } = result;
  const relatedLinks = await liveJobLandingLinks(supabase, `/jobs/remote/${COUNTRY_LANDING_SLUG[country]}`);

  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Talentrah home
      </Link>

      <div>
        <EyebrowLabel>Work from anywhere in {country}</EyebrowLabel>
        <h1 className="mt-1.5 text-[28px] leading-[1.2]">Remote Jobs in {country}</h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
          {total} remote roles based in or open to applicants in {country} are live right now.
          Every listing here is currently accepting applications; a role closes and drops off this
          page the moment its source stops advertising it, so what you see is what is actually
          live today. Looking more broadly? See every remote role below.
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
        {jobs.map((job) => (
          <PublicJobRow key={job.id} job={job} />
        ))}
      </div>

      {total > jobs.length && (
        <p className="text-[13.5px] text-ink-soft">
          Showing {jobs.length} of {total} remote roles in {country}.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <Link
          href={`/signup?redirectTo=${encodeURIComponent("/jobs")}`}
          className={buttonClasses("primary", "sm", "no-underline w-fit")}
        >
          Create a free account to see your match score
        </Link>
        <p className="text-[12.5px] text-ink-soft">
          A free account scores every remote role against your resume, tracks what you apply to,
          and lets Farah tailor your resume for any listing — free to start, no card required.
        </p>
      </div>
    </div>
  );
}
