-- 0060 — course recommendations (build-prompt §6.9 / §10 item 12), M1.
--
-- A curated catalog plus an outbound-click log. Two tables with deliberately
-- opposite access shapes, and the difference is the point:
--
--   course_recommendations        marketing content. Publicly readable, like
--                                 credit_packs, passes and resume_templates
--                                 already are. Nobody's data.
--   course_recommendation_clicks  behavioural telemetry about a person, and
--                                 half of it about a person with no account.
--                                 No client reads or writes it at all.
--
-- NOT CREDIT-GATED, and the table shape is where that gets fixed in place: the
-- catalog carries no price, no entitlement column and no user reference.
-- §8/§6.9 keep zero-AI-cost actions free, and showing a pre-curated link after
-- a gap analysis that was already paid for is exactly that. There is nothing
-- here to check a balance against, which is the cheapest way to keep it true.

-- ---------------------------------------------------------------------------
-- The catalog
-- ---------------------------------------------------------------------------
--
-- Hand-entered, and that is a decision rather than a stage. The scholarship
-- pipeline needed a legal review before it could rely on a scraped source
-- (§10 item 19); this needs none, because these are first-party affiliate
-- links from programmes we have joined — not third-party listings
-- redistributed. The cost is that adding a row is a SQL insert until the admin
-- dashboard grows a screen for it, which is the same gap resume_templates has
-- carried since the baseline schema.

create table public.course_recommendations (
  id uuid primary key default gen_random_uuid(),

  /*
   * Matches SKILL_VOCABULARY in src/lib/jobs/extract-jd.ts — the same 47 terms
   * the job feed's skill facet uses. Deliberately NOT a foreign key: that
   * vocabulary lives in TypeScript, and duplicating it here as an enum or a
   * lookup table would create a second copy to keep in step. The application
   * normalises a freeform gap-analysis keyword down to one of those terms
   * before it ever queries this table, so the join happens in one place.
   */
  skill_tag text not null,

  provider text not null,
  title text not null,

  /*
   * Placeholder URLs are expected here at M1 and are not a bug. §10 item 1 of
   * the plan: the affiliate accounts are a founder action, and the build must
   * not block on one — the same category as the free-tier Gemini key. The
   * check below is a shape check, not a promise the link earns anything.
   */
  affiliate_url text not null,

  /*
   * §6.9's "tiered by affordability". Ordered, not free text, because the
   * matcher breaks ties on it: when two courses teach the same skill the
   * cheaper one is offered first, which is the whole point of tiering them.
   */
  price_tier text not null check (price_tier in ('free', 'low', 'mid', 'high')),

  /** Soft-delete, so a dead affiliate link stops being served without losing
      the click history that references it. */
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint course_recommendations_url_is_http
    check (affiliate_url ~* '^https?://'),
  /*
   * One row per provider per skill per title. Stops a careless re-run of the
   * seed from serving the same course twice in one list — the matcher dedupes
   * by skill_tag, but only after the query, and two identical rows would make
   * its tie-break arbitrary.
   */
  constraint course_recommendations_unique_offer
    unique (provider, skill_tag, title)
);

create index course_recommendations_skill_idx
  on public.course_recommendations (skill_tag) where active;

alter table public.course_recommendations enable row level security;

create policy "course recommendations are publicly readable"
  on public.course_recommendations for select using (true);

/*
 * Read-only to every client, including signed-in ones. RLS alone would not do
 * it: Supabase grants ALL ON ALL TABLES to authenticated, and a row policy
 * restricts rows, never columns or verbs — the lesson 0026-0030 cost four
 * findings to learn. Writes are service-role only, which is what makes
 * "curated" true rather than aspirational.
 */
revoke insert, update, delete on public.course_recommendations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The click log
-- ---------------------------------------------------------------------------
--
-- Talentrah's own "did this drive engagement" signal. NOT a commission ledger:
-- money is counted on each provider's affiliate dashboard, and rebuilding that
-- here would be a second source of truth that disagrees with the one that pays.
--
-- `user_id` IS NULLABLE ON PURPOSE. Half the value of this feature is on the
-- pre-signup demo (§6.1), where there is no account to attribute to — the same
-- shape anonymous_demo_runs settled on. A null here means "anonymous visitor",
-- not "missing data", and the `source` column says which surface it came from
-- so the two are never silently pooled.

create table public.course_recommendation_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,

  /*
   * ON DELETE SET NULL, not CASCADE. Deleting an account must not rewrite the
   * history of how many people clicked a course — that is a fact about the
   * catalog, not about the person. Same reasoning that keeps job_postings NO
   * ACTION against organizations.
   */
  recommendation_id uuid references public.course_recommendations(id) on delete set null,

  /** Denormalised so the log survives the catalog row being deleted. */
  skill_tag text not null,

  source text not null check (source in ('tailoring', 'demo')),
  clicked_at timestamptz not null default now()
);

create index course_recommendation_clicks_recommendation_idx
  on public.course_recommendation_clicks (recommendation_id, clicked_at desc);

alter table public.course_recommendation_clicks enable row level security;

/*
 * No policies, and the privileges revoked as well — the distinction 0054 turns
 * on. An unpolicied table with a standing grant is not closed; it is closed
 * only because no policy happens to permit a row today. This is telemetry
 * about people, written server-side, read by nobody through the API.
 */
revoke all on public.course_recommendation_clicks from anon, authenticated;

comment on table public.course_recommendations is
  'Curated affiliate course catalog (§6.9). Publicly readable marketing content; service-role writes only until the admin dashboard grows a screen for it.';
comment on table public.course_recommendation_clicks is
  'Outbound-click log for course recommendations. user_id is null for pre-signup demo clicks. Not a commission ledger — providers count the money.';
