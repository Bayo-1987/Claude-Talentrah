import Link from "next/link";
import { EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { JOB_FRESHNESS_WINDOW_DAYS } from "@/lib/jobs/freshness";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import type { Tables } from "@/lib/supabase/types";
import { provenanceLabel } from "@/lib/jobs/link-out";

/**
 * send-484 — the signed-out visitor's entry point at `/jobs`, replacing what used to be a redirect to
 * /login (a 307 from proxy.ts, before any page ran). Same shape as ScholarshipsPublicLanding (send-480): a
 * presentational component with NO database access of its own — the page fetches and passes everything down.
 *
 * ── THE PREVIEW IS HIDDEN, NOT APOLOGISED FOR ─────────────────────────────────────
 * It shows only when there are rows AND the live total is at least LANDING_PAGE_MIN_ENTRIES — the same
 * threshold every programmatic SEO page already obeys, so this page never advertises a thin board. Below
 * it, or when the query failed (the page logs that and passes nothing), the block is simply absent and the
 * rest of the page is intact. The page itself always answers 200, which is why /jobs is a STATIC sitemap
 * entry and not a count-gated one.
 *
 * ── NO MATCH SCORE, ANYWHERE ──────────────────────────────────────────────────────
 * A score is computed against a resume and a signed-out visitor has none; showing one would be invented
 * confidence (docs/match-confidence-invariant.md). The page says a score exists behind a free account and
 * shows none.
 *
 * ── NUMBERS ARE NEVER HARDCODED ───────────────────────────────────────────────────
 * The freshness window and the category threshold are read from the constants that own them
 * (JOB_FRESHNESS_WINDOW_DAYS, LANDING_PAGE_MIN_ENTRIES); the live counts arrive as props.
 * tests/jobs/public-landing.test.tsx swaps those constants for stubs and proves the copy follows them.
 *
 * ── WHY THE GUTTERS ARE NOT `Container` ───────────────────────────────────────────
 * AppShell's signed-out branch already wraps every page in `px-6` / `min-[760px]:px-10`; `Container` adds
 * its own on top and `cn()` is a plain join, so the two stack (232px of content at 360px). A plain
 * width-constrained div lets the shell's gutters apply exactly once.
 */

export interface LandingFacet {
  href: string;
  label: string;
  count: number;
}

export type LandingJob = Pick<
  Tables<"job_postings">,
  "id" | "title" | "company_name" | "location" | "work_type" | "source_type" | "posted_at"
> & { import_feed_id?: string | null };

/** The most rows the preview will ever render, whatever it is handed. */
export const JOB_PREVIEW_MAX = 6;

const WORK_TYPE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };

const SIGNUP_HREF = `/signup?redirectTo=${encodeURIComponent("/jobs")}`;
const LOGIN_HREF = `/login?redirectTo=${encodeURIComponent("/jobs")}`;

const SECTION = "flex flex-col gap-5 border-t border-line pt-10";

function JobRow({ job }: { job: LandingJob }) {
  const provenance = provenanceLabel(job);
  const workType = job.work_type ? WORK_TYPE_LABEL[job.work_type] : null;
  // A location of just "Remote" plus a "Remote" work type would read "Company · Remote · Remote".
  const workTypeAddsInfo = workType && !(job.location ?? "").toLowerCase().includes(workType.toLowerCase());
  const meta = [job.company_name, job.location, workTypeAddsInfo ? workType : null].filter(Boolean);
  return (
    <li>
      <BorderedCard className="flex items-start gap-3 p-5">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center bg-ink font-display text-[13px] font-bold text-paper">
          {getCompanyInitials(job.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px]">
            <Link href={`/jobs/${job.id}`} className="inline-flex min-h-6 items-center text-ink no-underline hover:text-rust hover:underline">
              {job.title}
            </Link>
          </h3>
          <div className="mt-0.5 text-[13px] text-ink-soft">{meta.join(" · ")}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
            {/* The signed-in card's own wording for an aggregated listing, so one concept has one term. */}
            {provenance ? (
              <span className="border border-line px-2 py-0.5 font-display text-[10.5px] font-bold italic">{provenance}</span>
            ) : (
              <span className="border border-line px-2 py-0.5 font-display text-[10.5px] font-bold italic">Posted on Talentrah</span>
            )}
            <span>{formatRelativeTime(job.posted_at)}</span>
          </div>
        </div>
      </BorderedCard>
    </li>
  );
}

const FACTS: Array<{ label: string; text: string }> = [
  { label: "Where it came from", text: "Posted directly on Talentrah, or sourced from another job board — each listing says which." },
  { label: "Who is hiring", text: "The company, the location and whether the role is remote, hybrid or onsite." },
  { label: "How recent it is", text: "When it was posted. Listings older than the window above are not shown at all." },
  { label: "The original posting", text: "A sourced listing links back to where it was originally published." },
];

const WITH_ACCOUNT: Array<{ title: string; text: string }> = [
  {
    title: "A match score for every listing",
    text: "Each job is scored against your resume, with the reasons — so you can tell a fit from a long shot before you spend an evening on an application.",
  },
  { title: "Save and track", text: "Save jobs you want to come back to, and follow each application from saved to hired in your Job Tracker." },
  {
    title: "Ask Farah about a job",
    text: "Farah can compare a listing with your resume and tell you where you are strong and where you are not.",
  },
  {
    title: "Auto-Apply, with you in charge",
    text: "Turn it on and Farah queues the strongest matches for your review. Nothing is sent until you confirm it.",
  },
];

export function JobsPublicLanding({
  total,
  jobs,
  facets,
}: {
  /** Every fresh open listing, not just the rows passed. */
  total: number;
  jobs: LandingJob[];
  facets: LandingFacet[];
}) {
  const showPreview = jobs.length > 0 && total >= LANDING_PAGE_MIN_ENTRIES;
  const shown = jobs.slice(0, JOB_PREVIEW_MAX);
  // "The 6 open listings" when that is all of them; "A few of the 378" when it is a sample. Compared with
  // the rows actually SHOWN (after the cap), not the rows supplied.
  const previewHeading =
    total === shown.length
      ? `The ${total} open ${total === 1 ? "listing" : "listings"} from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`
      : `A few of the ${total} open listings from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-14 py-6 sm:py-10">
      {/* A — hero */}
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
        <div className="flex flex-col gap-5">
          <EyebrowLabel>Jobs</EyebrowLabel>
          <h1 className="font-display text-[30px] leading-[1.15] sm:text-[36px]">
            Open jobs, each labelled by where it came from.
          </h1>
          <p className="max-w-[640px] text-[16px] leading-[1.6] text-ink-soft">
            Browse listings posted directly on Talentrah and ones we source from other job boards, each with a match score once you add your resume. Every listing names the company, the place and the source, and a sourced one links back to the original posting.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
              Create a free account
            </Link>
            {facets.length > 0 && (
              <Link href={facets[0].href} className={buttonClasses("secondary", "md", "no-underline")}>
                {`Browse ${facets[0].label.toLowerCase()}`}
              </Link>
            )}
          </div>
          <p className="max-w-[560px] font-display text-[14.5px] italic leading-[1.55] text-ink-soft">
            Reading every listing is free and needs no account. An account adds match scores, saving and applying.
          </p>
        </div>

        {facets.length > 0 && (
          <BorderedCard className="flex flex-col gap-3 p-5">
            <EyebrowLabel size="sm">Browse by</EyebrowLabel>
            <ul className="flex list-none flex-col p-0">
              {facets.map((f) => (
                <li key={f.href} className="border-t border-line first:border-t-0">
                  <Link
                    href={f.href}
                    className="flex min-h-11 items-center justify-between gap-3 py-1 text-[14px] text-ink no-underline hover:text-rust"
                  >
                    <span>{f.label}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-ink-soft">{`${f.count} open →`}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] leading-[1.5] text-ink-soft">
              {`Counts are live. A category appears here only once it has at least ${LANDING_PAGE_MIN_ENTRIES} open listings.`}
            </p>
          </BorderedCard>
        )}
      </div>

      {/* B — the live preview (hidden when there is nothing honest to show) */}
      {showPreview && (
        <section className={SECTION}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <EyebrowLabel>Newest listings</EyebrowLabel>
              <h2 className="font-display text-[24px] leading-[1.2]">{previewHeading}</h2>
            </div>
            <Link href={SIGNUP_HREF} className={buttonClasses("secondary", "md", "no-underline")}>
              See them all, matched to your resume&nbsp;→
            </Link>
          </div>
          <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
            {shown.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        </section>
      )}

      {/* C — what every listing tells you */}
      <section className={SECTION}>
        <EyebrowLabel>What every listing tells you</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">Enough to decide whether it is worth your time — and where to check.</h2>
        <dl className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col gap-1">
              <dt className="font-body text-[14.5px] font-semibold text-ink">{f.label}</dt>
              <dd className="text-[14px] leading-[1.55] text-ink-soft">{f.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* D — with a free account */}
      <section className={SECTION}>
        <EyebrowLabel>With a free account</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">Turn a long list into the few jobs worth applying to.</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {WITH_ACCOUNT.map((c) => (
            <BorderedCard key={c.title} className="flex flex-col gap-3 p-5">
              <h3 className="font-display text-[18px] font-semibold">{c.title}</h3>
              <p className="text-[14px] leading-[1.55] text-ink-soft">{c.text}</p>
            </BorderedCard>
          ))}
        </div>
      </section>

      {/* E — closing card */}
      <BorderedCard borderWidth="2" className="flex flex-col items-start gap-4 p-8">
        <h2 className="font-display text-[22px] font-semibold">Start with your resume.</h2>
        <p className="max-w-[560px] text-[14.5px] leading-[1.55] text-ink-soft">
          Create a free account, add your resume, and every listing gets a match score you can act on. Browsing stays free either way.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
            Create a free account
          </Link>
          <Link
            href={LOGIN_HREF}
            className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
          >
            Already have one? Log in
          </Link>
        </div>
      </BorderedCard>
    </div>
  );
}
