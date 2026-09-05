import { after } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { scoreJobs, persistMatchScores } from "@/lib/matching/compute-and-store";
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
import { searchJobs } from "@/lib/jobs/search";
import { parseMultiSelect } from "@/lib/jobs/multi-select";
import { buildSuggestionIndex } from "@/lib/jobs/search-suggestions";
import { getSiteOrigin } from "@/lib/referrals/url";
import {
  fetchPromotedJobs,
  recordPromotedImpressions,
  PROMOTED_SLOTS,
} from "@/lib/ads/promoted";
import { isJobDateFilter, jobDateFilterSinceISO, JOB_FRESHNESS_WINDOW_DAYS, type JobDateFilter } from "@/lib/jobs/freshness";
import {
  isTrackedCountry,
  defaultCountryForProfile,
  deriveCountry,
  COUNTRY_THIN_THRESHOLD,
  TRACKED_COUNTRIES,
  type TrackedCountry,
} from "@/lib/jobs/country";
import { recommendedRankingKey } from "@/lib/jobs/ranking";
import { logCountryDefaultEvent, type CountryState } from "@/lib/jobs/country-events";

export const metadata = { title: "Jobs — Talentrah" };

type SearchParams = Promise<{
  tab?: string;
  workType?: string;
  seniority?: string;
  q?: string;
  posted?: string;
  country?: string;
}>;

const VALID_WORK_TYPES: readonly string[] = Constants.public.Enums.work_type;
const VALID_SENIORITIES: readonly string[] = Constants.public.Enums.seniority_level;

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, profile } = await requireUser();
  const params = await searchParams;
  const tab = params.tab ?? "recommended";
  type WorkType = NonNullable<Tables<"job_postings">["work_type"]>;
  type Seniority = NonNullable<Tables<"job_postings">["seniority"]>;
  /*
   * Multi-select: `?workType=remote,hybrid` — parsed, validated and deduped
   * by the shared helper (src/lib/jobs/multi-select.ts). An empty array means
   * "no filter", same contract every other filter here has; `postingsQuery`
   * below only calls `.in()` when the array is non-empty.
   */
  const workTypes = parseMultiSelect<WorkType>(params.workType, VALID_WORK_TYPES as WorkType[]);
  const seniorities = parseMultiSelect<Seniority>(params.seniority, VALID_SENIORITIES as Seniority[]);
  const q = params.q?.trim() || undefined;
  const posted: JobDateFilter | undefined = isJobDateFilter(params.posted) ? params.posted : undefined;

  /*
   * Country default (Stage 12). "all" is a real, explicit sentinel for
   * cleared — distinct from the param simply being ABSENT, which falls back
   * to the profile default instead. Every other filter on this page treats
   * absence as "no filter"; country can't, because absence here means
   * "apply the default", so clearing it needs its own state to win over that
   * default rather than just omitting the param and landing back on it.
   *
   * countryState is Stage 12's own instrumentation dimension (kept/cleared/
   * none — src/lib/jobs/country-events.ts), computed here once so the feed
   * view log, the FilterBar chip and every apply on this page agree on it.
   */
  let country: TrackedCountry | undefined;
  let countryState: CountryState;
  if (params.country === "all") {
    country = undefined;
    countryState = "cleared";
  } else if (isTrackedCountry(params.country)) {
    country = params.country;
    countryState = "kept";
  } else {
    country = defaultCountryForProfile(profile.country);
    countryState = country ? "kept" : "none";
  }

  const supabase = await createClient();

  /*
   * THE POSTINGS QUERY NO LONGER WAITS ON THE RESUME.
   *
   * These three were two awaits: the resume and the applications together,
   * and then the postings query after both. But the postings query needs
   * NEITHER for most tabs — it reads `applications` only on Saved, to turn
   * saved rows into an id filter, and it never reads the resume at all. So on
   * Recommended, External and Recent it was waiting on two round trips for
   * information it does not use.
   *
   * Now the resume is always in flight alongside; the postings query starts
   * immediately except on Saved, where it genuinely cannot be built until the
   * saved ids are known. That one tab keeps the dependency because it has a
   * real one.
   *
   * Each query is wrapped in an async IIFE rather than passed as a bare
   * builder. A Supabase builder is a thenable that fires on `then`, so a
   * builder awaited in two places would issue two requests — `applications`
   * is read here AND inside the Saved branch, which is exactly that shape.
   */
  const baseResumeQuery = (async () =>
    supabase
      .from("resumes")
      .select("structured_content")
      .eq("user_id", user.id)
      .eq("is_base", true)
      .maybeSingle())();

  const applicationsQuery = (async () =>
    supabase.from("applications").select("job_posting_id, stage").eq("user_id", user.id))();

  /*
   * Explicit column list, not `.select("*")` — this query has no row limit
   * (every open posting renders as a card, on every load) and `description`
   * alone averages ~5.4 KB of the ~7.3 KB a full row costs, to render a card
   * that only ever shows 280 characters of it (job-card.tsx). Aliased back
   * to `description` from the generated `description_preview` column
   * (migration 0086) so nothing downstream — JobCard, search, matching —
   * needs to know the difference; `/jobs/[id]` still fetches the real
   * column in full for the page that actually renders it.
   */
  // A single string literal, not `+`-concatenated pieces — Supabase's
  // `.select()` type inference reads the LITERAL TYPE of its argument, and
  // `+` between string literals widens to plain `string` even under
  // `as const` (confirmed: concatenation fell back to `GenericStringError`
  // here). One literal keeps the aliased `description` typechecking as
  // `Tables<"job_postings">`.
  const FEED_COLUMNS =
    "id, source_type, organization_id, title, company_name, company_logo_url, location, work_type, employment_type, seniority, years_experience_min, description:description_preview, structured_jd, external_url, external_source, status, posted_at, last_checked_at, dedup_fingerprint, created_at, expires_at, removed_at, removal_reason, removed_by, salary_min, salary_max, salary_currency, salary_unit";

  function postingsQuery(savedIds?: string[]) {
    let query = supabase
      .from("job_postings")
      .select(FEED_COLUMNS)
      .eq("status", "open")
      // The ambient 30-day floor always applies (src/lib/jobs/freshness.ts),
      // to every tab including Saved — this page is the discovery feed, and
      // a saved-but-aged-out posting disappearing from THIS tab does not
      // lose anything: /tracker shows every stage (including "saved")
      // through its own, entirely separate query with no freshness floor,
      // so a user's actual history is unaffected regardless of what this
      // feed hides. `posted` narrows the floor further when the reader
      // picked a shorter window.
      .gte("posted_at", jobDateFilterSinceISO(posted));
    if (tab === "external") query = query.eq("source_type", "external");
    // .in() with an empty array matches NOTHING, not everything — the empty
    // case is handled by never calling it, so "no filter" stays "no filter".
    if (workTypes.length) query = query.in("work_type", workTypes);
    if (seniorities.length) query = query.in("seniority", seniorities);
    if (savedIds) {
      query = query.in("id", savedIds.length ? savedIds : ["00000000-0000-0000-0000-000000000000"]);
    }
    return query;
  }

  const jobsQuery =
    tab === "saved"
      ? applicationsQuery.then(({ data }) =>
          postingsQuery(
            (data ?? [])
              .filter((a) => a.job_posting_id !== null && a.stage === "saved")
              .map((a) => a.job_posting_id as string),
          ),
        )
      : (async () => postingsQuery())();

  const [
    { data: baseResume, error: baseResumeError },
    { data: applications },
    { data: jobsRaw },
  ] = await Promise.all([baseResumeQuery, applicationsQuery, jobsQuery]);

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

  // Omit, not the full row — see FEED_COLUMNS above and job-card.tsx's
  // matching JobCardProps type: this query never fetches the raw
  // `description_preview` column, only the pre-truncated value aliased as
  // `description`.
  type FeedJobPosting = Omit<Tables<"job_postings">, "description_preview">;
  const matchingFilters: FeedJobPosting[] = jobsRaw ?? [];

  /*
   * Built from `matchingFilters` — the board before the search term — for the
   * same reason search-suggestions always was: suggestions counted against an
   * already-searched board would collapse to whatever co-occurs with the
   * partial term, so the list would look broken the moment anyone typed.
   */
  const searchIndex = buildSuggestionIndex(matchingFilters);
  let jobs: FeedJobPosting[] = searchJobs(matchingFilters, q);

  /*
   * Country default, applied in memory for the same reason the skill facet
   * and search are (see the block above) — this feed has no pagination, so
   * the whole matching set is already in hand.
   *
   * MATCHES THE COUNTRY *OR* IS REMOTE, not country alone. Country-only
   * excluded every location-independent Moniepoint/Wave remote posting —
   * for a Nigerian seeker, measured live, that meant 78 fresh remote roles
   * dropping to 56 total shown, cutting out exactly the inventory a remote
   * worker most wants. "Jobs available to me", not "jobs physically in my
   * country", is the actual product intent here.
   *
   * THE HONEST LIMIT, worth stating precisely because it is not fixed by
   * more code: `work_type = 'remote'` does not mean open to any country.
   * Moniepoint's own remote listings usually name ONE required country per
   * role ("Remote, Spain", "Remote, Poland" — real, current examples), and
   * this dataset gives no reliable way to tell "remote, restricted to
   * Ghana" apart from "remote, open anywhere" for a source that doesn't say
   * so structurally. Showing the ambiguous ones is still better than hiding
   * real opportunities, but nothing in this feature is allowed to claim a
   * remote role is open to everyone — see the caption below the filter bar
   * and the fallback notice's wording, both deliberately silent on
   * eligibility, only ever stating what the listing itself says.
   *
   * Below COUNTRY_THIN_THRESHOLD real matches, the filter does not narrow
   * `jobs` at all: the country's own matches were never excluded (they're
   * still somewhere in the full board), and `countryFallbackNotice` below
   * carries the honest count so the page can say why an unfiltered board is
   * showing rather than silently widening or rendering a near-empty page.
   */
  /*
   * The country MENU's own counts (Part 3) — computed here, against `jobs` as
   * it stands right now: work type, seniority, posted and search already
   * applied, country not yet. "Under whatever else is applied" is the whole
   * point — a menu that counted against the unfiltered board would offer a
   * number the next screen (which keeps every OTHER filter active) would not
   * actually show, which is exactly the kind of promise this control must
   * not make. Same country-OR-remote rule the filter itself uses below, so
   * the number beside "Nigeria" always equals what clicking it produces.
   */
  const countryMenuCounts: Record<TrackedCountry, number> = {
    Nigeria: 0,
    Ghana: 0,
    Kenya: 0,
    "South Africa": 0,
  };
  for (const c of TRACKED_COUNTRIES) {
    countryMenuCounts[c] = jobs.filter(
      (j) => deriveCountry(j) === c || j.work_type === "remote",
    ).length;
  }
  const everyCountryCount = jobs.length;

  let countryFallbackNotice: { country: TrackedCountry; matched: number } | undefined;
  if (country) {
    const countryMatches = jobs.filter((j) => deriveCountry(j) === country || j.work_type === "remote");
    if (countryMatches.length >= COUNTRY_THIN_THRESHOLD) {
      jobs = countryMatches;
    } else {
      countryFallbackNotice = { country, matched: countryMatches.length };
    }
  }

  if (tab === "recent") {
    jobs.sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime());
  }

  /*
   * SCORING IS SYNCHRONOUS AND THE PERSISTENCE IS NOT AWAITED — see the
   * `after()` block below.
   *
   * `scoreJobs` is pure arithmetic over rows already in memory: it is the
   * array this page renders, complete, with no database in it. The upsert
   * that used to run in the same call wrote ~196 rows (production, 30-day
   * window) that nothing on this page ever reads back. Awaiting it meant
   * every feed view — including a filter chip click, which re-renders the
   * whole page — held the response open for a write the reader was not
   * waiting for.
   */
  const scored = scoreJobs(resume, jobs);

  /*
   * FOUR INDEPENDENT ROUND TRIPS, RUN TOGETHER.
   *
   * Applicant counts, the two Auto-Apply reads and the promoted-slot fetch
   * are independent of each other, so they go out at once rather than in the
   * order they happened to be written in.
   *
   * THE SCAN IS NO LONGER ONE OF THEM. `scanAndQueue` used to run here, with
   * the pending-queue count sequenced behind it so the count included
   * anything this visit queued. Both the scan and the score-cache write it
   * depends on now happen in `after()`, so the count below reports the state
   * as of the PREVIOUS feed render. That is a real, visible change and it is
   * called out on the `after()` block; it is not a detail that got lost.
   *
   * `promoted_jobs` joins `match_scores` and so reads the previous visit's
   * scores for the same reason. Checked rather than assumed: the join is a
   * filter (`score >= 60`) over jobs already on this page, so a stale score
   * can only change WHICH of two eligible paid cards is promoted, and on a
   * brand-new account with no scores yet it promotes nothing on the first
   * render only. Impressions are deduped per user per campaign per day
   * (`record_ad_event`), so nothing is over- or under-billed by the shift.
   */
  const internalIds = scored.filter((s) => s.job.source_type === "internal").map((s) => s.job.id);

  const [, applicantCounts, { data: autoApplySettings }, pendingQueue, promoted] =
    await Promise.all([
      // Stage 12 instrumentation — independent of everything else in this
      // Promise.all, and swallows its own failures (logCountryDefaultEvent),
      // so it rides along for free rather than adding a fourth sequential
      // round trip.
      logCountryDefaultEvent({ userId: user.id, eventType: "feed_view", countryState, tab }),
      /*
       * Applicant counts, for the ids on this page only.
       *
       * Through 0059's SECURITY DEFINER function, not a join: `applications` is
       * owner-only under RLS, so joining it here would return this user's own
       * rows and nothing else — "1 applicant" on every job they had applied to
       * and "0" everywhere else, which looks like data and is not.
       *
       * Failure is swallowed to a null map rather than throwing. A missing
       * count is a line that says so; it is not worth failing the whole feed
       * over, and the card distinguishes "no count available" from "zero
       * applicants".
       */
      (async (): Promise<Map<string, number> | null> => {
        if (internalIds.length === 0) return null;
        const { data: counts, error: countsError } = await supabase.rpc(
          "internal_applicant_counts",
          { p_job_ids: internalIds },
        );
        if (countsError) {
          console.error("[jobs] applicant counts unavailable:", countsError);
          return null;
        }
        return new Map(
          (counts ?? []).map((row) => [row.job_posting_id, Number(row.applicant_count)]),
        );
      })(),

      // Whether the toggle renders as on. Read here rather than taken from
      // scanAndQueue's own copy of it, because the scan no longer runs on
      // this path at all.
      supabase.from("auto_apply_settings").select("enabled").eq("user_id", user.id).maybeSingle(),

      /*
       * The pending review count, as of the last completed scan.
       *
       * No longer sequenced behind `scanAndQueue` — it cannot be, now that
       * the scan happens after the response. So it is a plain sibling here,
       * which also means it stops adding its latency on top of the scan's.
       */
      supabase
        .from("auto_apply_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending"),

      /*
       * Promoted slots — Recommended only (D4).
       *
       * External, Saved and Recent are user intents, not discovery surfaces: on
       * Saved the person is looking at a list they built, and inserting a paid
       * card into it would be a different product. Recommended is the only tab
       * whose ordering Talentrah chooses, so it is the only one where selling a
       * position in that ordering is coherent.
       *
       * AFTER scoring, necessarily: promoted_jobs joins match_scores, which the
       * call above has just written. Same ordering constraint as the Auto-Apply
       * scan, for the same reason — and, as established above, no constraint
       * relative to the scan itself.
       */
      tab === "recommended"
        ? fetchPromotedJobs(supabase, { workTypes, seniorities, limit: PROMOTED_SLOTS })
        : Promise.resolve(null),
    ]);

  /*
   * Stage 12: Recommended gets a freshness-decayed ranking key, not the raw
   * score — a stale perfect match no longer automatically outranks a recent
   * good-enough one (src/lib/jobs/ranking.ts has the full rationale). Every
   * OTHER non-"recent" tab (External, Saved) keeps the plain score sort —
   * only Recommended is asked to answer "what's best right now", and Most
   * Recent's own date sort above is untouched either way.
   */
  if (tab === "recommended") {
    scored.sort(
      (a, b) =>
        recommendedRankingKey(b.score, b.job.posted_at, JOB_FRESHNESS_WINDOW_DAYS) -
        recommendedRankingKey(a.score, a.job.posted_at, JOB_FRESHNESS_WINDOW_DAYS),
    );
  } else if (tab !== "recent") {
    scored.sort((a, b) => b.score - a.score);
  }

  /*
   * The promoted REORDER, applied after the sort above.
   *
   * The fetch moved into the Promise.all — it needs only `match_scores` — but
   * this part must stay here, because it rewrites `scored` and has to run
   * after `scored.sort` or the sort would undo it. Fetch early, apply late.
   *
   * This REORDERS the feed rather than adding to it. A promoted job is an open
   * posting that already satisfies the tab's filters, so it is already in
   * `scored` — fetching it separately would risk showing a job the filters
   * excluded, which is precisely what D1 rules out.
   */
  let promotedIds: string[] = [];
  let visiblePromoted: typeof promoted = null;
  if (promoted) {
    const scoredIds = new Set(scored.map((s) => s.job.id));
    // Only ones actually on the page. A promoted job absent from `scored` was
    // filtered out upstream, and billing an impression for a card that never
    // rendered is the one thing this must not do.
    visiblePromoted = promoted.filter((p) => scoredIds.has(p.jobPostingId));
    promotedIds = visiblePromoted.map((p) => p.jobPostingId);

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
  }
  const promotedSet = new Set(promotedIds);
  // Once per render, not once per card — every card shares the same origin.
  const origin = await getSiteOrigin();

  /*
   * ══ EVERYTHING THIS PAGE WRITES, AFTER THE RESPONSE IS SENT ═════════════
   *
   * `after()` (next/server) runs its callback once the response has been
   * flushed, keeping the function alive to finish. All three writes below
   * used to be awaited before render, and none of their results appear on
   * the page: the reader was waiting on the database to record what they had
   * already been shown.
   *
   * ── THE ORDER IS PRESERVED, AND IT IS THE POINT ───────────────────────
   *
   * `persistMatchScores` then `scanAndQueue`, sequentially, exactly as
   * before. The scan applies Auto-Apply's threshold against `match_scores`
   * IN THE DATABASE (`.gte("score", AUTO_APPLY_MIN_SCORE)` on a table no
   * client can write, 0031) — that is the line making "conservative
   * threshold" a fact rather than a setting, and it only means anything if
   * the scores it reads are the ones this render just computed. Running the
   * two concurrently, or dropping the await between them, would let the scan
   * queue against the previous visit's scores. Deferring them TOGETHER
   * changes when they run, not what they see.
   *
   * The impression recording is independent of both, so it goes in parallel
   * with the pair rather than behind them.
   *
   * ── WHAT DEFERRING ACTUALLY COSTS ─────────────────────────────────────
   *
   * Two reads on THIS render now see the state as of the previous one: the
   * pending-queue count above, and `promoted_jobs`' score join. Both are
   * documented at their call sites. Nothing else in the codebase reads
   * `match_scores` inside a request that also writes it — checked, not
   * assumed: the other readers are `scanAndQueue` (sequenced here), the
   * `promoted_jobs` RPC, and /jobs/[id], which scores its single posting
   * itself.
   *
   * ── ERRORS ─────────────────────────────────────────────────────────────
   *
   * Each is caught. There is no response left to fail by this point, so an
   * escaping rejection would be an unhandled crash report in place of a
   * cache miss — but they are LOGGED, never silent. A scan that throws on
   * every feed load must not look identical to a scan that found nothing to
   * queue; that ambiguity is exactly what once hid Auto-Apply queueing
   * nothing while reporting itself enabled.
   */
  after(async () => {
    await Promise.all([
      (async () => {
        try {
          await persistMatchScores(user.id, scored);
          await scanAndQueue(user.id);
        } catch (err) {
          console.error("[jobs] deferred scoring/auto-apply scan failed:", err);
        }
      })(),
      (async () => {
        if (!visiblePromoted?.length) return;
        try {
          await recordPromotedImpressions(user.id, visiblePromoted);
        } catch (err) {
          console.error("[jobs] deferred impression recording failed:", err);
        }
      })(),
    ]);
  });

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
          workTypes={workTypes}
          seniorities={seniorities}
          posted={posted}
          country={country}
          countryApplicable={countryState !== "none"}
          countryCounts={countryMenuCounts}
          everyCountryCount={everyCountryCount}
          searchIndex={searchIndex}
        />
        {/*
          The honest limit of "country OR remote", stated every time the
          filter is actually active — not just in the rare fallback case
          above. "Remote" on a listing is a fact about work_type, not a claim
          about who is eligible; some of these roles name a single required
          country in their own description that this filter has no reliable
          way to read. Never claims a remote role is open to everyone —
          states only what the filter itself does.
        */}
        {country && (
          <p className="text-[12.5px] italic text-ink-soft">
            Showing roles in {country} plus every remote listing on the board. Remote doesn&apos;t
            always mean open to any country — some roles are restricted to a specific one in the
            listing itself.
          </p>
        )}
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

      {/*
        Stage 12's honest fallback: shown ONLY when the country filter is
        active but too thin to actually narrow the feed (see the
        countryFallbackNotice computation above) — "never produce an empty
        feed silently, show what exists and then the rest, with an honest
        line saying so" rather than a filter that quietly does nothing.
      */}
      {countryFallbackNotice && (
        <p className="border-[1.5px] border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
          {countryFallbackNotice.matched === 0
            ? `No jobs in ${countryFallbackNotice.country} or remote match these filters right now`
            : `${countryFallbackNotice.matched} job${countryFallbackNotice.matched === 1 ? "" : "s"} in ${countryFallbackNotice.country} or remote match${countryFallbackNotice.matched === 1 ? "es" : ""} these filters`}{" "}
          — showing roles from elsewhere below.
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
            countryState={countryState}
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
