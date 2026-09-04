import { JsonLd } from "@/components/seo/json-ld";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOptionalUser } from "@/lib/auth/require-user";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";
import { SHARE_IMAGE, SHARE_IMAGE_META } from "@/lib/seo/site";
import { createClient } from "@/lib/supabase/server";
import { BorderedCard, Button, EyebrowLabel, MatchTierBadge, buttonClasses } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { postingAgeLine, freshnessFloorISO } from "@/lib/jobs/freshness";
import { formatSalary } from "@/lib/jobs/format-salary";
import { relevantJobLandingLinks } from "@/lib/seo/landing-page-links";
import { skillsOf } from "@/lib/jobs/skill-facet";
import { computeAndStoreMatchScores } from "@/lib/matching/compute-and-store";
import { EMPTY_RESUME } from "@/lib/resume/types";
import type { StructuredResume } from "@/lib/resume/types";
import {
  toggleSaveAction,
  applyInAppAction,
  markAppliedExternallyAction,
} from "@/lib/applications/actions";

const WORK_TYPE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

const SENIORITY_LABEL: Record<string, string> = {
  entry: "Entry",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  executive: "Executive",
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // Same client as the page, so a posting the reader cannot see does not leak
  // its title through the tab.
  const { data } = await supabase
    .from("job_postings")
    .select("title, company_name, description, location, employment_type")
    .eq("id", id)
    .gte("posted_at", freshnessFloorISO())
    .maybeSingle();

  if (!data) return { title: "Job — Talentrah" };

  const title = `${data.title} — ${data.company_name} — Talentrah`;

  /*
   * A description built from the posting, not a placeholder.
   *
   * This is not only a search-result snippet: it is what WhatsApp, Slack and
   * X render when someone shares the link, and sharing a job is a normal thing
   * to do here. Without it those unfurls fell back to the site-wide sentence,
   * so every shared job looked identical.
   *
   * Shape: role at company, where, then the opening of the JD itself. Cut on a
   * WORD boundary at ~155 characters — around where Google truncates, and a
   * mid-word cut reads as broken rather than as elided.
   */
  const lead = [
    `${data.title} at ${data.company_name}`,
    data.location?.split(";")[0]?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (data.description ?? "").replace(/\s+/g, " ").trim();
  const room = 155 - lead.length - 2;
  const snippet =
    body.length > room ? `${body.slice(0, Math.max(0, room)).replace(/\s+\S*$/, "")}…` : body;
  const description = snippet ? `${lead}. ${snippet}` : lead;

  return {
    title,
    description,
    alternates: { canonical: `/jobs/${id}` },
    /*
       `images` is restated, not inherited. Next REPLACES the parent openGraph
       object when a child declares one, so omitting it here left the pages
       people actually share — job links in WhatsApp — with no share image.
    */
    openGraph: {
      title,
      description,
      type: "article",
      url: `/jobs/${id}`,
      images: [SHARE_IMAGE_META],
    },
    // `summary`, matching the root layout: the default share image is the
    // square 512 mark and the large card would centre-crop it. See layout.tsx.
    twitter: { card: "summary", title, description, images: [SHARE_IMAGE] },
  };
}

/**
 * One posting, in full.
 *
 * There was no route for this at all: the feed truncated every description at
 * 280 characters and the card title was not a link, so the only way to read a
 * job was to leave for the source site — which for an internal posting does
 * not exist.
 *
 * READ THROUGH THE USER'S OWN CLIENT, never the service role. RLS is what
 * decides whether this posting is visible: an unverified company's listing
 * (0027), and a removed one (0056), are both invisible here for the same
 * reason they are invisible in the feed. A detail page that fetched with
 * elevated credentials would be a way around the gate that the feed respects,
 * and `notFound()` is the right answer for both "no such job" and "not yours
 * to see" — distinguishing them would itself leak.
 */
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /*
   * OPTIONAL user — this page is public, and that is the whole point.
   *
   * It carries JobPosting structured data, and while it required a session
   * Googlebot was answered with a 302 to /login, so not one posting was ever
   * eligible for Google for Jobs. A signed-out visitor now reads the full
   * posting; every action on it still needs an account (see the CTA below).
   */
  const session = await getOptionalUser();
  const user = session?.user ?? null;
  const supabase = await createClient();

  const [{ data: job }, baseResumeResult, applicationResult] = await Promise.all([
    /*
     * The same 30-day floor every discovery surface enforces
     * (src/lib/jobs/freshness.ts) — reached directly by URL, not just via
     * the feed, so this is the one place it must be re-checked rather than
     * assumed from wherever the link came from. A job someone already saved
     * or applied to is unaffected: the Job Tracker and Auto-Apply's review
     * queue render from their OWN tables, never a link to this page (see
     * freshness.ts's header), so an aged-out posting disappearing from here
     * cannot break a user's own history.
     */
    supabase
      .from("job_postings")
      .select("*")
      .eq("id", id)
      .gte("posted_at", freshnessFloorISO())
      .maybeSingle(),
    /*
     * Skipped entirely when signed out rather than run and discarded. Both are
     * owner-scoped by RLS so they would return nothing anyway, but issuing two
     * pointless round trips on the page most likely to be hit by a crawler is
     * the kind of cost that only shows up under load.
     */
    user
      ? supabase
          .from("resumes")
          .select("structured_content")
          .eq("user_id", user.id)
          .eq("is_base", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    user
      ? supabase
          .from("applications")
          .select("stage")
          .eq("user_id", user.id)
          .eq("job_posting_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const { data: baseResume, error: baseResumeError } = baseResumeResult;
  const { data: application } = applicationResult;

  if (!job) notFound();

  // Backlink to whichever SEO landing pages (src/lib/seo/landing-pages.ts)
  // THIS job actually belongs to, and only while each is currently live —
  // "explore more" closes the loop the landing pages open, without ever
  // linking to a category that would 404.
  const landingLinks = await relevantJobLandingLinks(supabase, job);

  /*
   * Same fallback rule as the feed: an empty resume only when there genuinely
   * is not one. A query ERROR scored against EMPTY_RESUME would look identical
   * to "no resume yet" while actually meaning something is broken — the exact
   * shape of QA audit bug #1.
   */
  const resume =
    (!baseResumeError ? (baseResume?.structured_content as StructuredResume | null) : null) ??
    EMPTY_RESUME;

  /*
   * One job through the same function the feed uses, so the number here and
   * the number on the card cannot drift apart.
   *
   * NOT RUN FOR A SIGNED-OUT READER, and not merely because there is no resume
   * to score: `computeAndStoreMatchScores` WRITES to match_scores through the
   * service role. Calling it for an anonymous visitor would mean a crawler
   * generating rows in a per-user cache, which is both meaningless and a way
   * for an unauthenticated request to cause database writes.
   */
  const scored = user
    ? (await computeAndStoreMatchScores(supabase, user.id, resume, [job]))[0]
    : null;

  const isExternal = job.source_type === "external";
  const stage = application?.stage ?? null;
  const isSaved = stage === "saved";
  const alreadyApplied =
    stage === "applied" || stage === "interviewing" || stage === "offer" || stage === "hired";

  /*
   * JobPosting structured data — the thing that makes this posting eligible
   * for Google for Jobs at all.
   *
   * Null when the posting cannot satisfy Google's REQUIRED set (most often a
   * location naming no country), and nothing is rendered in that case. 130 of
   * the 155 live postings currently qualify. Emitting partial markup would
   * trade "not eligible" for "eligible and erroring in Search Console", which
   * is worse because it looks fine on the page.
   *
   * Rendered for signed-in readers too. It costs one script tag, and gating it
   * on being signed out would mean the markup a crawler sees is not the markup
   * a human's browser sees — which is cloaking, and is penalised as such.
   */
  const jsonLd = buildJobPostingJsonLd(job);

  // The feed's own parser, not a second reading of structured_jd — it already
  // tolerates a missing key, a non-array, and non-string members.
  const skills = skillsOf(job);

  const meta = [
    job.location,
    job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
    job.seniority ? SENIORITY_LABEL[job.seniority] : null,
    job.employment_type ? EMPLOYMENT_LABEL[job.employment_type] : null,
    job.years_experience_min ? `${job.years_experience_min}+ years` : null,
  ].filter(Boolean);
  // Its own line, not folded into `meta`: a salary is the one line here a
  // seeker scans for first, and burying it in a middot-joined string of
  // location/seniority/experience would be the wrong hierarchy for the
  // single most decision-relevant fact on the page.
  const salary = formatSalary(job);

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <JsonLd data={jsonLd} />
      <Link
        href="/jobs"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Back to jobs
      </Link>

      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center bg-ink font-display text-[19px] font-bold text-paper">
          {getCompanyInitials(job.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-[28px] leading-[1.2]">{job.title}</h1>
            {scored && <MatchTierBadge score={scored.score} className="flex-shrink-0" />}
          </div>
          <p className="mt-1 text-[15px] text-ink-soft">{job.company_name}</p>
          {salary && <p className="mt-1.5 text-[15px] font-semibold text-ink">{salary}</p>}
          {meta.length > 0 && (
            <p className="mt-0.5 text-[13.5px] text-ink-soft">{meta.join(" · ")}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 border-y border-line py-3">
        <span className="text-[12.5px] text-ink-soft">
          {postingAgeLine(job)}
          {isExternal && " · sourced externally"}
        </span>
        {job.status !== "open" && (
          <span className="text-[12.5px] font-semibold text-amber">
            This posting is no longer open.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!user ? (
          <>
        {/*
          SIGNED OUT: read everything, act on nothing.
          
          The posting above is complete — that is deliberate, and it is what
          makes the page worth indexing. What needs an account is doing
          something with it: saving, applying, tailoring. Each of those writes
          a row owned by a user, so there is nothing to degrade gracefully to.

          One CTA rather than three disabled buttons. Three greyed controls
          would say "you are missing out" three times; one says what to do.

          `redirectTo` carries them back HERE after signing up, using the same
          param /signup already reads through `safeRedirectTo`. Without it the
          person who arrived from a search result for one specific job lands on
          the feed and has to find it again — the exact loss requireUser's own
          return-trip suffix was added to stop.

          "Create a free account" verbatim: CLAUDE.md fixes one term per
          concept and rules out "sign up" / "sign in" in body copy.
        */}
        {/*
          Not offered on a closed posting. "Create a free account to apply" on
          a role that is filled is a promise the product cannot keep, and the
          signed-out view is the one most likely to arrive from a search
          result months later. The amber "no longer open" notice below still
          renders, so the page explains itself rather than going blank.
        */}
        {job.status === "open" && (
          <Link
            href={`/signup?redirectTo=${encodeURIComponent(`/jobs/${job.id}`)}`}
            className={buttonClasses("primary", "sm", "no-underline")}
          >
            Create a free account to apply
          </Link>
        )}
        {isExternal && job.external_url && (
          <a
            href={job.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("secondary", "sm", "no-underline")}
          >
            View on company site
          </a>
        )}
          </>
        ) : (
          <>
        <form action={toggleSaveAction.bind(null, job.id)}>
          <button type="submit" className={buttonClasses("secondary", "sm")}>
            {isSaved ? "Saved — remove" : "Save"}
          </button>
        </form>

        {alreadyApplied ? (
          <span className="inline-flex min-h-10 items-center text-[13.5px] font-semibold text-green">
            Applied
          </span>
        ) : isExternal ? (
          <>
            <a
              href={job.external_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("primary", "sm", "no-underline")}
            >
              Apply on company site
            </a>
            <form action={markAppliedExternallyAction.bind(null, job.id)}>
              <button type="submit" className={buttonClasses("text", "sm")}>
                Mark as applied
              </button>
            </form>
          </>
        ) : (
          <form action={applyInAppAction.bind(null, job.id)}>
            <Button size="sm" type="submit">
              Apply
            </Button>
          </form>
        )}

        <Link href={`/tailor?jobId=${job.id}`} className={buttonClasses("text", "sm", "no-underline")}>
          Tailor my resume for this
        </Link>
          </>
        )}
      </div>

      {skills.length > 0 && (
        <BorderedCard className="flex flex-col gap-2 p-5">
          <EyebrowLabel size="sm">Skills named in this posting</EyebrowLabel>
          <p className="text-[14px] leading-relaxed text-ink-soft">{skills.join(" · ")}</p>
        </BorderedCard>
      )}

      <div className="flex flex-col gap-3">
        <EyebrowLabel size="sm">Full description</EyebrowLabel>
        {/*
          whitespace-pre-line, and the whole thing. The feed's 280-character
          slice is what this page exists to undo, so re-truncating here would
          leave the product with no way to read a job at all.
        */}
        <div
          data-testid="job-full-description"
          className="text-[15px] leading-relaxed whitespace-pre-line text-ink-soft"
        >
          {job.description}
        </div>
      </div>

      {landingLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-[13px]">
          <span className="font-semibold text-ink-soft">Explore more:</span>
          {landingLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-rust underline underline-offset-2 hover:text-rust-hover"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
