import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/seo/site";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { liveJobLandingLinks } from "@/lib/seo/landing-page-links";
import { loadCityJobs } from "@/lib/seo/landing-page-data";
import { PublicJobRow } from "@/components/jobs/public-job-row";
import { EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * Programmatic SEO landing page targeting "{role} jobs in {city}" and
 * "jobs in {city}" query patterns — the role-agnostic city page is the
 * layer that exists today; a role×city cross (MyJobMag's own custom-pages
 * shape) is a natural next step once one city passes the threshold, not
 * before.
 *
 * `[city]` is NOT open to arbitrary path segments — only slugs listed in
 * CITY_LANDING_PAGES resolve to anything; everything else 404s immediately,
 * before a database round trip. See that file's header for why this is a
 * short curated list rather than a dynamic gazetteer.
 *
 * LIVE, NOT BUILD-TIME — see loadCityJobs (src/lib/seo/landing-page-data.ts)
 * and tests/seo/landing-page-liveness.test.ts for the proof.
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
 * each time) and silently save nothing. loadCityJobs keeps its plain-client
 * parameter (that is what lets tests/seo/landing-page-data.test.ts call it
 * outside a request); the memoization boundary belongs here instead. The
 * client is handed back so the related-links query can reuse it.
 */
const cityJobsForRequest = cache(async (citySlug: string) => {
  const supabase = await createClient();
  return { supabase, result: await loadCityJobs(supabase, citySlug) };
});

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const { result } = await cityJobsForRequest(citySlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) return { title: "Jobs — Talentrah" };

  const { city, total } = result;
  const title = `Jobs in ${city.displayName}, Nigeria — ${total} Open Roles | Talentrah`;
  const description = `Browse ${total} open job openings in ${city.displayName} from verified employers. Get matched against your resume, tailor your application and apply free.`;
  return pageMetadata({ title, description, path: `/jobs/in/${city.slug}` });
}

export default async function CityJobsPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const { supabase, result } = await cityJobsForRequest(citySlug);
  if (!result || result.total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const { city, total, jobs } = result;
  const relatedLinks = await liveJobLandingLinks(supabase, `/jobs/in/${city.slug}`);

  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Talentrah home
      </Link>

      <div>
        <EyebrowLabel>Openings in {city.displayName}</EyebrowLabel>
        <h1 className="mt-1.5 text-[28px] leading-[1.2]">Jobs in {city.displayName}, Nigeria</h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
          {total} open roles based in {city.displayName} right now, aggregated from Greenhouse,
          Lever and Workable-listed employers and refreshed every few hours. Onsite and hybrid
          roles based in {city.displayName} are here; if you can work from anywhere, the remote
          jobs page below covers roles that never require relocating.
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
          Showing {jobs.length} of {total} roles in {city.displayName}.
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
          A free account scores every {city.displayName} role against your resume, tracks what
          you apply to, and lets Farah tailor your resume for any listing — free to start, no
          card required.
        </p>
      </div>
    </div>
  );
}
