import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { computeAndStoreMatchScores } from "@/lib/matching/compute-and-store";
import { scanAndQueue } from "@/lib/auto-apply/queue";
import { AutoApplyToggle } from "@/components/jobs/auto-apply-toggle";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { EyebrowLabel } from "@/components/ui";
import { FeedTabs } from "@/components/jobs/feed-tabs";
import { FilterBar } from "@/components/jobs/filter-bar";
import { FixedFeedHeader } from "@/components/jobs/fixed-feed-header";
import { JobCard } from "@/components/jobs/job-card";
import { Constants, type Tables } from "@/lib/supabase/types";
import { hasVisibleName, visibleName } from "@/lib/profile/name";
import { computeSkillFacet, filterBySkill } from "@/lib/jobs/skill-facet";
import { searchJobs } from "@/lib/jobs/search";
import { getSiteOrigin } from "@/lib/referrals/url";
import {
  fetchPromotedJobs,
  recordPromotedImpressions,
  PROMOTED_SLOTS,
} from "@/lib/ads/promoted";

export const metadata = { title: "Jobs — Talentrah" };

type SearchParams = Promise<{
  tab?: string;
  workType?: string;
  seniority?: string;
  skill?: string;
  q?: string;
}>;

const VALID_WORK_TYPES: readonly string[] = Constants.public.Enums.work_type;
const VALID_SENIORITIES: readonly string[] = Constants.public.Enums.seniority_level;

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireUser();
  const params = await searchParams;
  const tab = params.tab ?? "recommended";
  type WorkType = NonNullable<Tables<"job_postings">["work_type"]>;
  type Seniority = NonNullable<Tables<"job_postings">["seniority"]>;
  const workType = VALID_WORK_TYPES.includes(params.workType ?? "")
    ? (params.workType as WorkType)
    : undefined;
  const seniority = VALID_SENIORITIES.includes(params.seniority ?? "")
    ? (params.seniority as Seniority)
    : undefined;
  /*
   * Not validated against a list, because there is no list — the facet is
   * whatever the postings mention. An unknown value simply matches nothing,
   * which is the correct answer for a skill no posting names.
   */
  const skill = params.skill?.trim().toLowerCase() || undefined;
  const q = params.q?.trim() || undefined;
  const supabase = await createClient();

  const [{ data: baseResume, error: baseResumeError }, { data: applications }] = await Promise.all([
    supabase
      .from("resumes")
      .select("structured_content")
      .eq("user_id", user.id)
      .eq("is_base", true)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("job_posting_id, stage")
      .eq("user_id", user.id),
  ]);

  // Only fall back to an empty resume when there genuinely isn't one yet
  // (a real, expected state for a new user). A query error is a different
  // situation — silently scoring against an empty resume there would look
  // identical to "no resume" but actually mean something is broken (this is
  // exactly how QA audit bug #1 went unnoticed: a duplicate is_base row
  // made this query error, and match scores quietly went wrong with no
  // visible sign anything was off). The DB now also structurally prevents
  // that specific duplicate (migration 0010), but this distinction stays
  // worth keeping regardless of cause.
  const hasBaseResume = !baseResumeError && !!baseResume;
  const resume = (baseResume?.structured_content as StructuredResume | null) ?? EMPTY_RESUME;
  const applicationByJobId = new Map(
    (applications ?? []).map((a) => [a.job_posting_id, a.stage]),
  );

  let query = supabase.from("job_postings").select("*").eq("status", "open");
  if (tab === "external") query = query.eq("source_type", "external");
  if (workType) query = query.eq("work_type", workType);
  if (seniority) query = query.eq("seniority", seniority);
  if (tab === "saved") {
    const savedIds = [...applicationByJobId.entries()]
      .filter(([id, stage]) => id !== null && stage === "saved")
      .map(([id]) => id as string);
    query = query.in("id", savedIds.length ? savedIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data: jobsRaw } = await query;
  const matchingFilters: Tables<"job_postings">[] = jobsRaw ?? [];

  /*
   * The facet is counted BEFORE the skill filter is applied, and then the
   * filter is applied in memory.
   *
   * Counting after would collapse every other skill to whatever co-occurs
   * with the selected one, so the facet would appear to empty out the moment
   * anyone used it. Work-type and seniority are already applied at this point,
   * which is the opposite choice on purpose: those counts should describe the
   * board actually on screen.
   *
   * In memory rather than in SQL because the feed already fetches the whole
   * result set — there is no pagination — so this is a filter over ~150 rows
   * already in hand, not a second round trip. That stops being true if the
   * board grows enough to need paging, and the filter moves into the query
   * then.
   */
  const skillFacet = computeSkillFacet(matchingFilters);
  /*
   * Search is applied AFTER the facet is counted, alongside the skill filter,
   * for the same reason: counting the facet against a searched board would
   * collapse every chip to whatever co-occurs with the search term, so the
   * facet would look broken the moment anyone typed.
   */
  const jobs: Tables<"job_postings">[] = searchJobs(
    filterBySkill(matchingFilters, skill),
    q,
  );
  if (tab === "recent") {
    jobs.sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime());
  }

  const scored = await computeAndStoreMatchScores(supabase, user.id, resume, jobs);

  /*
   * Applicant counts, for the ids on this page only.
   *
   * Through 0059's SECURITY DEFINER function, not a join: `applications` is
   * owner-only under RLS, so joining it here would return this user's own rows
   * and nothing else — "1 applicant" on every job they had applied to and "0"
   * everywhere else, which looks like data and is not.
   *
   * Failure is swallowed to a null map rather than throwing. A missing count
   * is a line that says so; it is not worth failing the whole feed over, and
   * the card distinguishes "no count available" from "zero applicants".
   */
  const internalIds = scored.filter((s) => s.job.source_type === "internal").map((s) => s.job.id);
  let applicantCounts: Map<string, number> | null = null;
  if (internalIds.length > 0) {
    const { data: counts, error: countsError } = await supabase.rpc("internal_applicant_counts", {
      p_job_ids: internalIds,
    });
    if (countsError) {
      console.error("[jobs] applicant counts unavailable:", countsError);
    } else {
      applicantCounts = new Map(
        (counts ?? []).map((row) => [row.job_posting_id, Number(row.applicant_count)]),
      );
    }
  }

  /*
   * Auto-Apply scans AFTER scoring, on purpose: the scan reads `match_scores`,
   * so running it first would queue against last visit's scores. It is also
   * why this lives on the feed rather than a cron — the scores it depends on
   * are recomputed here, and nowhere else.
   *
   * Failure is swallowed deliberately. Auto-Apply is an accessory to the feed;
   * a queueing error must not take the job board down with it.
   */
  const [{ data: autoApplySettings }, pendingQueue] = await Promise.all([
    supabase.from("auto_apply_settings").select("enabled").eq("user_id", user.id).maybeSingle(),
    (async () => {
      try {
        await scanAndQueue(user.id);
      } catch {
        /* non-fatal — see above */
      }
      return supabase
        .from("auto_apply_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending");
    })(),
  ]);
  if (tab !== "recent") {
    scored.sort((a, b) => b.score - a.score);
  }

  /*
   * Promoted slots — Recommended only (D4).
   *
   * External, Saved and Recent are user intents, not discovery surfaces: on
   * Saved the person is looking at a list they built, and inserting a paid card
   * into it would be a different product. Recommended is the only tab whose
   * ordering Talentrah chooses, so it is the only one where selling a position
   * in that ordering is coherent.
   *
   * AFTER scoring, necessarily: promoted_jobs joins match_scores, which the
   * call above has just written. Same ordering constraint as the Auto-Apply
   * scan, for the same reason.
   *
   * This REORDERS the feed rather than adding to it. A promoted job is an open
   * posting that already satisfies the tab's filters, so it is already in
   * `scored` — fetching it separately would risk showing a job the filters
   * excluded, which is precisely what D1 rules out.
   */
  let promotedIds: string[] = [];
  if (tab === "recommended") {
    const promoted = await fetchPromotedJobs(supabase, {
      workType,
      seniority,
      limit: PROMOTED_SLOTS,
    });
    const scoredIds = new Set(scored.map((s) => s.job.id));
    // Only ones actually on the page. A promoted job absent from `scored` was
    // filtered out upstream, and billing an impression for a card that never
    // rendered is the one thing this must not do.
    const visible = promoted.filter((p) => scoredIds.has(p.jobPostingId));
    promotedIds = visible.map((p) => p.jobPostingId);

    if (promotedIds.length > 0) {
      const rank = new Map(promotedIds.map((id, i) => [id, i]));
      scored.sort((a, b) => {
        const ra = rank.get(a.job.id);
        const rb = rank.get(b.job.id);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return 0; // everything else keeps the order it already had
      });
    }

    // Fire-and-forget against the render, not the viewport (D3). Awaited so it
    // cannot outlive the request, but never allowed to fail the page — the job
    // board must not go down because an ad event did not record.
    try {
      await recordPromotedImpressions(user.id, visible);
    } catch {
      /* non-fatal — see recordPromotedImpressions */
    }
  }
  const promotedSet = new Set(promotedIds);
  // Once per render, not once per card — every card shares the same origin.
  const origin = await getSiteOrigin();

  return (
    <div className="flex flex-col gap-5">
      {/*
        Everything a reader steers by — the tabs, the Auto-Apply switch and the
        filters — stays put; only the cards move under it.

        THE PADDING. (app)/layout.tsx wraps this in `py-8`, so without
        `-mt-8 pt-8` the header would scroll up through 32px of the layout's
        padding before locking, leaving a visible gap of paper above it at
        rest and a 32px jump as it catches. Pulling the block up by exactly
        that padding and re-adding it inside means it locks flush against the
        masthead. Done here rather than by removing the layout's padding,
        which every other page under it relies on.

        `bg-paper` is not decoration either: without an opaque background the
        cards scroll THROUGH the header, which is worse than no sticky at all.
      */}
      {/*
        z-10 puts this above the scrolling cards, which is the point. It also
        put it above the cards' own menus, which were z-5 — a Report or Ask
        Farah panel opened near the top of the list rendered UNDER this header:
        present in the DOM, unclickable on screen. The e2e suite caught it as
        `locator.click: Test timeout` on a label that had resolved fine, which
        is what an obscured element looks like from Playwright.

        Fixed by raising those three menus rather than lowering this, because
        an open disclosure should sit above the chrome it opens over.

        THE ORDER, in full, because two numbers are not enough to infer it:

            masthead (app)/layout.tsx        z-20    always on top
            card menus report/farah/share    z-[15]  above this header, under the nav
            this header                      z-10    above the scrolling cards

        The menus write it in brackets. Not because the bare form is broken —
        it was reported as a typo that compiles to nothing, and a clean
        production build says otherwise:

            .z-10{z-index:10}   .z-15{z-index:15}   .z-\[15\]{z-index:15}

        Tailwind v4 generates numeric z-index utilities on demand, so `z-15`
        works even though 15 is not in the 0/10/20/30/40/50 scale and this
        project defines no --z-* token. Both forms are correct today.

        Brackets anyway, for one reason worth the two characters: the bracket
        form is an arbitrary value and cannot stop resolving, whereas the bare
        form depends on a v4 feature that a future major could narrow. Also
        note Tailwind scans raw file text — the string `z-15` in a comment is
        enough to emit the rule — so "the class exists in the CSS" is not on
        its own evidence that some element is using it.

        The menus were briefly z-30, which fixed the bug and introduced a
        smaller one: opening upward from a card near the top, they painted over
        the masthead. z-[15] clears this header without outranking the app's
        primary navigation. Anything else layered over the feed stays below 20.

        The row below is `position: fixed` now rather than sticky, which does
        NOT change any of the above: both are positioned elements at z-10 in
        the root stacking context, so the same three-layer order holds. It is
        re-asserted in the browser rather than assumed — see
        e2e/fixed-tab-row.spec.ts.

        Read "this row" as the eyebrow and the tabs only. The Auto-Apply card
        and the filter bar scroll with the page and are not part of any layer
        here; when this comment was written they were inside the pinned block
        and it did describe all three.
      */}
      <FixedFeedHeader>
        <div>
          <EyebrowLabel>Today&apos;s board</EyebrowLabel>
          <div className="mt-2">
            <FeedTabs active={tab} />
          </div>
        </div>
      </FixedFeedHeader>

      {/*
        OUTSIDE the pinned block, deliberately.

        These two used to sit inside it, which made the fixed area 529px tall —
        the tabs, the whole Auto-Apply card, the search box, the filter chips
        and the skill cloud, all held on screen while only the job cards moved
        beneath them. As a single `sticky` block that read as one unit and the
        size was easy not to notice; pinning it made it impossible to ignore.

        What belongs on screen permanently is the thing you steer by — which
        board you are looking at. The filters and the Auto-Apply switch are
        things you set and then stop looking at, so they scroll.

        `gap-5` here replaces the gap they used to get from the pinned block's
        own flex container, so the 20px rhythm between them survives the move.
      */}
      <div className="flex flex-col gap-5">
        <AutoApplyToggle
          enabled={!!autoApplySettings?.enabled}
          pendingCount={pendingQueue.count ?? 0}
        />

        <FilterBar
          q={q}
          tab={tab}
          workType={workType}
          seniority={seniority}
          skill={skill}
          skillFacet={skillFacet}
        />
      </div>

      {baseResumeError && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          Couldn&apos;t load your resume, so match scores below aren&apos;t
          reliable right now. Try reloading — if this keeps happening,{" "}
          <a href="/resume-builder" className="underline">
            check your Resume Builder
          </a>
          .
        </p>
      )}
      {!baseResumeError && !hasBaseResume && (
        <p className="border-[1.5px] border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
          You don&apos;t have a resume yet, so match scores below are just a
          neutral placeholder.{" "}
          <a href="/resume-builder" className="underline">
            Add one in the Resume Builder
          </a>{" "}
          to get real ones.
        </p>
      )}

      {scored.length === 0 ? (
        <p className="py-12 text-center text-[14.5px] text-ink-soft">
          {tab === "saved"
            ? "No saved jobs yet — tap the heart icon on a job to save it here."
            : "No jobs match these filters right now — try clearing them."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {scored.map(({ job, score, explanation }) => (
            <JobCard
              key={job.id}
              job={job}
              score={score}
              isSaved={applicationByJobId.get(job.id) === "saved"}
              applicationStage={applicationByJobId.get(job.id) ?? null}
              isSponsored={promotedSet.has(job.id)}
              explanation={explanation}
            origin={origin}
            /*
              null vs 0 is the distinction the card renders. A posting with no
              row in the map has had nobody apply — that is 0, not unknown.
              Unknown is the whole map being null (the lookup failed) or the
              posting being external.
            */
            applicantCount={
              job.source_type === "internal" && applicantCounts
                ? (applicantCounts.get(job.id) ?? 0)
                : null
            }
            />
          ))}
        </div>
      )}

      {/*
        Same nullable-first_name trap as the onboarding headline: this
        rendered "— profile: ." for any user without a name. The whole
        clause is only meaningful when there IS a name, so it's dropped
        rather than left dangling.
      */}
      <p className="text-[12px] italic text-ink-soft">
        Match scores are calculated against your saved resume
        {hasVisibleName(profile.first_name) ? ` — profile: ${visibleName(profile.first_name)}` : ""}.
      </p>
    </div>
  );
}
