import Link from "next/link";
import { notFound } from "next/navigation";
import { getOptionalUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/seo/site";
import { BorderedCard, EyebrowLabel, buttonClasses } from "@/components/ui";
import {
  DEGREE_LEVEL_LABEL,
  FUNDING_TYPE_LABEL,
  type SaveStatus,
} from "@/lib/scholarships/types";
import { daysUntil, formatDeadline } from "@/components/scholarships/scholarship-card";
import { SaveToggle } from "@/components/scholarships/save-toggle";
import { SaveStatusSelect } from "@/components/scholarships/save-status-select";
import { FarahActions } from "@/components/scholarships/farah-actions";
import { relevantScholarshipLandingLinks } from "@/lib/seo/landing-page-links";
import { checkPassCoverage } from "@/lib/passes/entitlement";

/**
 * Columns the public page actually renders. Not `select("*")`.
 *
 * RLS already governs which ROWS are visible (see 0084 and
 * tests/rls/scholarship-public-read.test.ts) — a pending or rejected listing
 * is invisible to every role regardless of what this list contains. This is
 * a narrower, separate decision: `moderation_note` and `moderated_by` are an
 * admin's internal review trail (see ingest.ts's mapping of `reviewNote`),
 * not the listing, and have zero value to a reader while being the kind of
 * thing an operator would not expect to see rendered on a page the entire
 * internet can load. Nothing stops a direct REST call from reading them
 * regardless — this is about what THIS page puts in front of a person and a
 * crawler, not a security boundary.
 */
const PUBLIC_COLUMNS =
  "id, provider, program_name, host_institution, degree_levels, field_tags, funding_type, funding_covers, eligibility_nationalities, eligibility_prior_degree, eligibility_age, eligibility_other, application_deadline, deadline_note, cycle_year, official_url, source_name, moderation_status";

async function loadPublicScholarship(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scholarships")
    .select(PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPublicScholarship(id);
  if (!data) return { title: "Scholarship — Talentrah" };

  const title = `${data.program_name} — ${data.provider} — Talentrah`;

  /*
   * Built from the listing's own fields, not truncated prose — scholarships
   * carry no free-text description column the way a job posting does.
   * Deadline text mirrors the page's own display rule: the stored date, or
   * the deadline note verbatim, never a reconstruction.
   */
  const levels = data.degree_levels?.length
    ? data.degree_levels.map((l) => DEGREE_LEVEL_LABEL[l]).join("/")
    : null;
  const lead = [
    `${FUNDING_TYPE_LABEL[data.funding_type]} scholarship`,
    data.host_institution ? `at ${data.host_institution}` : null,
    levels ? `for ${levels} study` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const deadlineText = data.application_deadline
    ? `Apply by ${formatDeadline(data.application_deadline)}`
    : data.deadline_note;
  const description = [lead, deadlineText].filter(Boolean).join(". ").slice(0, 155);

  return pageMetadata({
    title,
    description: description || lead,
    path: `/scholarships/${id}`,
  });
}

/**
 * One scholarship listing, in full — public, the scholarship-side equivalent
 * of #152's /jobs/[id].
 *
 * WHY THIS PAGE DID NOT EXIST BEFORE. There was no detail route at all: every
 * listing lived only as a card on the authenticated /scholarships feed, so
 * "fully funded scholarships for Nigerians"-class queries had nothing of
 * Talentrah's to rank — the catalog was invisible to search by construction,
 * not by a deliberate privacy choice.
 *
 * READ THROUGH THE USER'S OWN CLIENT, never the service role, exactly like
 * the job detail page and for the same reason: RLS is what decides whether
 * this listing is visible (0084), and a page that fetched with elevated
 * credentials would be a way around a gate the rest of the product respects.
 * `notFound()` answers both "no such id" and "not verified" identically —
 * distinguishing them would itself leak which ids are real.
 */
export default async function ScholarshipDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getOptionalUser();
  const user = session?.user ?? null;
  const profile = session?.profile ?? null;
  // Only meaningful for a signed-in user — FarahActions never renders
  // without one (see the `!user` branch below), so there's nothing to skip
  // by computing it unconditionally here.
  const passCoverage = user ? await checkPassCoverage(user.id) : null;

  const [scholarship, saveResult] = await Promise.all([
    loadPublicScholarship(id),
    // Skipped entirely when signed out, matching the job page: the query is
    // owner-scoped by RLS and would return nothing anyway, so there is no
    // reason to spend a round trip on the page most likely to be hit by a
    // crawler.
    user
      ? (await createClient())
          .from("scholarship_saves")
          .select("id, status")
          .eq("user_id", user.id)
          .eq("scholarship_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!scholarship) notFound();

  // Backlink to whichever SEO landing pages (src/lib/seo/landing-pages.ts)
  // THIS scholarship actually belongs to, and only while each is currently
  // live — mirrors the same "explore more" pattern on /jobs/[id].
  const landingLinks = await relevantScholarshipLandingLinks(await createClient(), scholarship);

  const save = saveResult.data as { id: string; status: SaveStatus } | null;
  const left = daysUntil(scholarship.application_deadline);
  const urgent = left !== null && left >= 0 && left <= 14;

  const meta = [
    ...scholarship.degree_levels.map((l) => DEGREE_LEVEL_LABEL[l]),
    FUNDING_TYPE_LABEL[scholarship.funding_type],
  ];

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <Link
        href="/scholarships"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Back to scholarships
      </Link>

      <div>
        <EyebrowLabel size="sm">{scholarship.provider}</EyebrowLabel>
        <h1 className="mt-1 text-[28px] leading-[1.2]">{scholarship.program_name}</h1>
        {scholarship.host_institution && (
          <p className="mt-1 text-[15px] text-ink-soft">{scholarship.host_institution}</p>
        )}
      </div>

      {meta.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {meta.map((label) => (
            <span
              key={label}
              className="inline-flex min-h-7 items-center border border-line px-2 text-[12px] font-semibold text-ink-soft"
            >
              {label}
            </span>
          ))}
          {scholarship.funding_covers.length > 0 && (
            <span className="text-[12.5px] italic text-ink-soft">
              covers {scholarship.funding_covers.join(", ")}
            </span>
          )}
        </div>
      )}

      {/*
        THE OFFICIAL SOURCE, PROMINENT — §6.15 and the draft data-policy update
        in docs/scholarship-sources.md both make this non-negotiable, and this
        is the canonical page for the listing rather than a card in a feed, so
        it gets a bordered callout rather than a plain link at the bottom.
        Talentrah is a discovery layer; the official page is the authority on
        current terms, and that has to be legible before anything else on the
        page asks for an account.
      */}
      <BorderedCard className="flex flex-col gap-1 p-4">
        <span className="text-[12.5px] font-semibold text-ink-soft">
          {scholarship.source_name ? `Listed from ${scholarship.source_name}` : "Official source"}
        </span>
        <a
          href={scholarship.official_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 font-body text-[15px] font-semibold text-rust underline underline-offset-2 hover:text-rust-hover"
        >
          View the official listing
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M7 4h9v9M16 4L4 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <p className="text-[12.5px] italic text-ink-soft">
          Talentrah lists the facts of this programme with attribution. The official page above
          is always the authority on current terms and deadlines.
        </p>
      </BorderedCard>

      <div className="flex flex-col gap-1 border-y border-line py-3">
        <span className="text-[13.5px] text-ink-soft">
          <span className="font-semibold text-ink">Deadline: </span>
          {/*
            EXACTLY AS STORED, never a reconstruction — the same rule the
            ingestion pipeline enforces on the way in (§6.15: a wrong
            deadline is the worst error this feature can produce). A provider
            with no single deadline is a verified finding (deadline_note),
            not a gap, so it renders as the sourced sentence rather than a
            placeholder.
          */}
          <span className={urgent ? "font-semibold text-rust" : undefined}>
            {scholarship.application_deadline
              ? formatDeadline(scholarship.application_deadline)
              : (scholarship.deadline_note ?? "Not published yet")}
            {left !== null && left >= 0 && ` · ${left} ${left === 1 ? "day" : "days"} left`}
          </span>
        </span>
        {scholarship.field_tags.length > 0 && (
          <span className="text-[13px] text-ink-soft">{scholarship.field_tags.join(" · ")}</span>
        )}
      </div>

      {(scholarship.eligibility_nationalities.length > 0 ||
        scholarship.eligibility_prior_degree ||
        scholarship.eligibility_age ||
        scholarship.eligibility_other) && (
        <div className="flex flex-col gap-2">
          <EyebrowLabel size="sm">Eligibility</EyebrowLabel>
          <dl className="flex flex-col gap-1.5 text-[14px]">
            {scholarship.eligibility_nationalities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <dt className="font-semibold text-ink-soft">Open to:</dt>
                <dd className="text-ink-soft">
                  {scholarship.eligibility_nationalities.join(", ")}
                </dd>
              </div>
            )}
            {scholarship.eligibility_prior_degree && (
              <div className="flex flex-wrap gap-1.5">
                <dt className="font-semibold text-ink-soft">Prior degree:</dt>
                <dd className="text-ink-soft">{scholarship.eligibility_prior_degree}</dd>
              </div>
            )}
            {scholarship.eligibility_age && (
              <div className="flex flex-wrap gap-1.5">
                <dt className="font-semibold text-ink-soft">Age:</dt>
                <dd className="text-ink-soft">{scholarship.eligibility_age}</dd>
              </div>
            )}
            {scholarship.eligibility_other && (
              <p className="text-ink-soft">{scholarship.eligibility_other}</p>
            )}
          </dl>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!user ? (
          /*
            SIGNED OUT: read everything, act on nothing — the reading IS
            complete, which is what makes the page worth indexing.
            
            Names the two things an account actually unlocks rather than a
            vague "get more": saving is genuinely free and unlimited (per the
            list page's own copy), so the CTA claims exactly that. Farah's
            eligibility check is a further, credit-gated step and is named
            separately rather than folded into "free" — scoping a "free"
            claim to the point it is made is the content rule this follows.
          */
          <div className="flex flex-col gap-2">
            <Link
              href={`/signup?redirectTo=${encodeURIComponent(`/scholarships/${scholarship.id}`)}`}
              className={buttonClasses("primary", "sm", "no-underline")}
            >
              Create a free account to save this scholarship
            </Link>
            <p className="text-[12.5px] text-ink-soft">
              A free account also lets Farah check your eligibility and draft your personal
              statement, each for a small number of credits.
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center gap-3">
              <SaveToggle scholarshipId={scholarship.id} isSaved={!!save} />
              {save && (
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-ink-soft">
                    Your progress:
                  </span>
                  <SaveStatusSelect saveId={save.id} status={save.status} />
                </div>
              )}
            </div>
            <FarahActions
              scholarshipId={scholarship.id}
              creditsBalance={profile?.credits_balance ?? 0}
              passCovered={passCoverage?.covered ?? false}
            />
          </div>
        )}
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
