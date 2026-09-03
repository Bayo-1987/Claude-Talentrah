import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/seo/site";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { liveJobLandingLinks } from "@/lib/seo/landing-page-links";
import { loadRemoteJobs } from "@/lib/seo/landing-page-data";
import { PublicJobRow } from "@/components/jobs/public-job-row";
import { EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * Programmatic SEO landing page targeting "remote jobs in Nigeria" and
 * close variants — the query pattern MyJobMag's own sitemap already
 * dedicates a custom page to (remote × field combinations).
 *
 * LIVE, NOT BUILD-TIME (see src/lib/seo/landing-pages.ts's header comment
 * and src/lib/seo/landing-page-data.ts's, which actually runs the query):
 * force-dynamic and a fresh count on every request, because the ingest
 * pipeline's 72-hour staleness sweep and daily presence sweep both close
 * postings continuously — a category that empties out below
 * LANDING_PAGE_MIN_ENTRIES must drop out of the index the same run it
 * happens, with no deploy. See tests/seo/landing-page-liveness.test.ts for
 * the proof, and this page's own generateMetadata/default export for why
 * `dynamic = "force-dynamic"` alone would be an unverified claim without it
 * — the flag stops Next caching a RESPONSE, but only a live count query
 * (loadRemoteJobs, called fresh on every request below) stops the RESPONSE
 * ITSELF from going stale between requests.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const supabase = await createClient();
  const { total } = await loadRemoteJobs(supabase);
  if (total < LANDING_PAGE_MIN_ENTRIES) return { title: "Remote Jobs — Talentrah" };

  const title = `Remote Jobs in Nigeria — ${total} Open Roles | Talentrah`;
  const description = `Browse ${total} remote job openings for Nigerian and African talent, from Moniepoint, Wave, Jumia and other verified employers. Get matched, tailor your resume and apply free.`;
  return pageMetadata({ title, description, path: "/jobs/remote" });
}

export default async function RemoteJobsPage() {
  const supabase = await createClient();
  const { total, jobs } = await loadRemoteJobs(supabase);
  if (total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const relatedLinks = await liveJobLandingLinks(supabase, "/jobs/remote");

  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Talentrah home
      </Link>

      <div>
        <EyebrowLabel>Work from anywhere in Nigeria</EyebrowLabel>
        <h1 className="mt-1.5 text-[28px] leading-[1.2]">Remote Jobs in Nigeria</h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
          {total} remote roles are open right now across fintech, e-commerce and telecom employers
          hiring Nigerian and African talent — Moniepoint, Wave, Jumia and others among them.
          Every listing here is currently accepting applications; a role closes and drops off this
          page the moment its source stops advertising it, so what you see is what is actually
          live today.
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
          Showing {jobs.length} of {total} remote roles.
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
